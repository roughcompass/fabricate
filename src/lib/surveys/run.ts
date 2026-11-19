import { withRepositoryLock } from "@/lib/acquisition/repository-lease";
import { gitSource, normalizeAcquisitionError } from "@/lib/acquisition/acquire";
import { Mirror, surveyRefFor } from "@/lib/acquisition/mirror";
import { continueWaitingTargets } from "@/lib/runs/waiting";
import { continuePreparations } from "@/lib/previews/records";
import { type Repository, repositoryById } from "@/lib/repositories/repository-records";
import { SourceBoundary } from "@/lib/repositories/source-boundary";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { JOB_PRIORITIES, jobs, surveys } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { JsonObject } from "@repo-facts/contract";
import { failureText } from "@/lib/git/redact";
import { GitRunner } from "@/lib/git/runner";
import { type Job, enqueue } from "@/lib/jobs/queue";
import { surveyDocument } from "@/lib/profiles/analyze";
import { insertProfile } from "@/lib/profiles/profile-records";
import { profileProblems } from "@/lib/profiles/schema";
import { queueChecksForMissingEntries } from "@/lib/catalog/check";
import type { CurrentCatalog } from "@/lib/catalog/current";
import { catalogRecipe, recipeDigest } from "@/lib/catalog/recipe";
import { suppliedEntries } from "@/lib/catalog/supply";
import { type Survey, getSurvey, moveSurvey, pinSurvey, surveyById, updateCurrentSurvey } from "./records";

/*
 * The survey job (unify-surveys, design decisions 1 to 4): pin the survey's
 * commit in the Repository's mirror, fetching only when the mirror lacks it,
 * run Surveyor on it with every current Reference Catalog entry, and store
 * the Profile. Finishing is one transaction: the Profile and its projection,
 * the survey's state and the Catalog part of its recipe, the Repository's
 * current survey, a Catalog check for any version it wanted without an entry,
 * and every Run target and preview preparation waiting on it.
 */

export const RUN_SURVEY = "survey.run";

/** Queues the job for +survey+'s next attempt, raising one already queued to +priority+, as a Run joining a background survey does. */
export function queueSurvey(db: Executor, survey: Survey, priority: number = JOB_PRIORITIES.background): Job {
  return enqueue(db, { kind: RUN_SURVEY, payload: { survey: survey.publicId }, idempotencyKey: `${RUN_SURVEY}:${survey.publicId}:${survey.attempts + 1}`, priority, raisePriority: true });
}

export interface RunSurveyOptions {
  config?: FrontendRegistryConfig;
  runner?: GitRunner;
  boundary?: SourceBoundary;
  signal?: AbortSignal;
}

/** Runs a queued survey to success or failure. A survey already finished stays as it is. */
export async function runSurvey(db: Executor, publicId: string, options: RunSurveyOptions = {}): Promise<Survey> {
  const config = options.config ?? getConfig();
  const runner = options.runner ?? new GitRunner({ config });
  let survey = getSurvey(db, publicId);
  if (survey.state !== "queued" && survey.state !== "running") return survey;
  // A job rerun after its lease expired resumes a running survey.
  if (survey.state === "queued") survey = moveSurvey(db, survey, "running", { attempts: survey.attempts + 1 });
  const repository = repositoryById(db, survey.repositoryId);
  let phase: "pin" | "analysis" = "pin";
  try {
    survey = await pinSurveyCommit(db, survey, repository, { config, runner, boundary: options.boundary ?? new SourceBoundary(config), ...(options.signal && { signal: options.signal }) });
    phase = "analysis";
    const supplied = suppliedEntries(db, config);
    const document = await surveyDocument({ survey, repository, config, runner, entries: supplied.entries, ...(options.signal && { signal: options.signal }) });
    return finishSurvey(db, survey, { document, catalog: supplied.catalog });
  } catch (error) {
    // A stopping worker leaves the survey running; its job runs again.
    if (options.signal?.aborted) throw error;
    const failure = phase === "pin" ? normalizeAcquisitionError(error) : { code: "analysis_failed", message: failureText(error, 500) };
    return finishSurvey(db, survey, { failure: { code: failure.code, message: failure.message } });
  }
}

/** Pins the survey's commit under its own ref, fetching it unless the mirror has it, and records the pin. */
export async function pinSurveyCommit(db: Executor, survey: Survey, repository: Repository, options: { config: FrontendRegistryConfig; runner: GitRunner; boundary: SourceBoundary; signal?: AbortSignal }): Promise<Survey> {
  const { config, runner, signal } = options;
  return withRepositoryLock(repository.id, { waitMs: config.gitLockTimeoutSeconds * 1_000, ...(signal && { signal }) }, async () => {
    const mirror = new Mirror(runner, repository.publicId);
    await mirror.ensure();
    if (survey.internalRef && (await mirror.hasCommit(survey.commitSha))) return survey;
    if (!(await mirror.hasCommit(survey.commitSha))) {
      const { url, protocol } = gitSource(repository, options.boundary);
      await mirror.clearIncoming(survey.publicId);
      try {
        await mirror.fetch(url, protocol, { kind: "commit", name: survey.commitSha }, survey.publicId, signal);
      } finally {
        await mirror.clearIncoming(survey.publicId);
      }
    }
    const internalRef = surveyRefFor(survey.publicId);
    if ((await runner.revParse(mirror.gitDir, `${internalRef}^{commit}`).catch(() => null)) !== survey.commitSha) await mirror.pin(internalRef, survey.commitSha);
    return pinSurvey(db, survey, { treeSha: await mirror.treeOf(survey.commitSha), internalRef });
  });
}

/**
 * Fails every survey queued or running whose job for its current attempt
 * can no longer run it: missing, failed, or out of attempts after its worker
 * stopped. Its waiting Runs and previews continue, and a later request
 * retries it under the same key. The scheduled check calls this first.
 */
export function settleAbandonedSurveys(db: Executor, now = new Date()): Survey[] {
  const active = db.select().from(surveys).where(inArray(surveys.state, ["queued", "running"])).all();
  return active.flatMap((survey) => {
    const key = `${RUN_SURVEY}:${survey.publicId}:${survey.state === "queued" ? survey.attempts + 1 : survey.attempts}`;
    const job = db.select().from(jobs).where(eq(jobs.idempotencyKey, key)).get();
    const exhausted = job?.state === "running" && job.leaseExpiresAt !== null && job.leaseExpiresAt <= now && job.attempts >= job.maxAttempts;
    if (job && job.state !== "failed" && !exhausted) return [];
    const message = job ? `The survey stopped before it finished: the worker running it stopped or lost the job.${job.lastError ? ` Last error: ${job.lastError}` : ""}` : "The survey's job no longer exists, so it can't finish.";
    return [immediate(db, (tx) => {
      const current = surveyById(tx, survey.id);
      if (current.state !== "queued" && current.state !== "running") return current;
      const failed = moveSurvey(tx, current, "failed", { failureCode: "analysis_failed", failureMessage: message });
      continueWaitingTargets(tx, failed);
      continuePreparations(tx, failed);
      return failed;
    })];
  });
}

type Outcome =
  /**
   * Its Profile, and the Catalog it was given: its described things and their
   * entries. Without it, the things its fact document names entries of are
   * taken as given, and no entry it lacked is looked for.
   */
  | { document: JsonObject; catalog?: CurrentCatalog }
  | { failure: { code: string; message: string } };

/** Finishes a running survey in one transaction: its Profile, state, the current pointer, and everything waiting on it. */
export function finishSurvey(db: Executor, survey: Survey, outcome: Outcome): Survey {
  return immediate(db, (tx) => {
    const current = surveyById(tx, survey.id);
    if (current.state !== "running") return current;
    let finished: Survey;
    if ("document" in outcome) {
      insertProfile(tx, { survey: current, document: outcome.document, validate: profileProblems });
      const catalog = catalogRecipe(outcome.document.fact_document, outcome.catalog?.things);
      finished = moveSurvey(tx, current, "succeeded", { failureCode: null, failureMessage: null, catalog, catalogDigest: recipeDigest(catalog) });
      updateCurrentSurvey(tx, finished);
      // A version it wanted that no entry was built for is built now, not after the next profiling check.
      if (outcome.catalog) queueChecksForMissingEntries(tx, catalog, outcome.catalog);
    } else {
      finished = moveSurvey(tx, current, "failed", { failureCode: outcome.failure.code, failureMessage: outcome.failure.message });
    }
    continueWaitingTargets(tx, finished);
    continuePreparations(tx, finished);
    return finished;
  });
}
