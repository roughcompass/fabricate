import { eq } from "drizzle-orm";
import type { JsonObject } from "@repo-facts/contract";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { type Repository, getRepository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { JOB_PRIORITIES, repositories } from "@/lib/db/schema";
import { readDocument } from "@/lib/documents/digested";
import { failureText } from "@/lib/git/redact";
import { GitRunner } from "@/lib/git/runner";
import type { FactDocument } from "@/lib/profiles/states";
import { profileOfSurvey } from "@/lib/profiles/profile-records";
import { type Survey, currentRecipe, recordConfiguredResolution, requestSurvey, surveyById } from "@/lib/surveys/records";
import { queueSurvey } from "@/lib/surveys/run";
import { SnapshotReader } from "@/lib/snapshot/reader";
import { assertEnrolled, isEnrolled } from "./access";
import { type ManifestRead, evaluateEligibility, installRootManifests, manifestPath, vitePackages } from "./eligibility";
import { type PageRead, readPage, viteConfig } from "./pages";
import { type PreviewPreparation, decidePreparation, failPreparation, findPreparation, linkPreparationSurvey, openPreparation, startPreview } from "./records";
import { type RefOptions, type RefRequest, pinCommit, previewPinRef } from "./refs";

/**
 * Prepares a pinned commit for previews before any build exists (design
 * decision 3). A request checks the feature switch and the Repository's
 * enrollment, pins the commit, and queues a `preview.prepare` job. The job
 * decides from the Profile of the commit's survey under the current recipe,
 * starting the survey when there's none and waiting for it, so a commit any
 * Run, check, or preview already surveyed isn't surveyed again. It then reads the install roots' committed manifests, and looks
 * for each Vite package's committed page, through the same reader, evaluates
 * every package, and, when exactly one qualifies, starts its preview.
 */

/** Pins +request+ for the Repository +sourcePublicId+ and returns its preparation, queued or as it stands. */
export async function requestPreparation(db: Executor, repositoryPublicId: string, request: RefRequest, options: RefOptions = {}): Promise<PreviewPreparation> {
  const config = options.config ?? getConfig();
  const repository = getRepository(db, repositoryPublicId);
  assertEnrolled(config, repository);
  const pinned = await pinCommit(db, repository, request, { ...options, config });
  // A request for the configured reference says which commit it names now (unify-surveys, design decision 4).
  if (request.kind === "ref" && request.name === repository.gitRef) recordConfiguredResolution(db, repository.id, pinned.commitSha, new Date());
  return openPreparation(db, repository, pinned).preparation;
}

export interface PreparationJob {
  preparation: string;
  /** When the preparation was requested, so a job for an earlier request changes nothing. */
  requested: number;
  /** Queued by its survey when it finished, rather than by the request. */
  afterSurvey?: boolean;
}

/**
 * Runs one `preview.prepare` job. Returns the preparation as decided or
 * failed, or null when it no longer awaits this job. A failure is recorded on
 * the preparation rather than retried, except when the job's lease was lost
 * or the worker is stopping.
 */
export async function runPreparation(db: Executor, job: PreparationJob, options: { config?: FrontendRegistryConfig; runner?: GitRunner; signal?: AbortSignal } = {}): Promise<PreviewPreparation | null> {
  const config = options.config ?? getConfig();
  const preparation = findPreparation(db, job.preparation);
  if (!preparation || preparation.state !== "profiling" || preparation.requestedAt.getTime() !== job.requested) return null;
  const repository = db.select().from(repositories).where(eq(repositories.id, preparation.repositoryId)).get()!;
  if (!config.previews.enabled) return failPreparation(db, job.preparation, job.requested, "Previews were turned off before the commit was prepared");
  if (!isEnrolled(config, repository)) return failPreparation(db, job.preparation, job.requested, `${repository.name} is not enrolled for previews`);

  try {
    const runner = options.runner ?? new GitRunner({ config });
    const gitDir = mirrorPath(config.repositoryStorage, repository.publicId);
    const open = () => SnapshotReader.open(runner, gitDir, previewPinRef(preparation.commitSha), preparation.commitSha, config.analysis);
    // Waking from a survey that failed fails the preparation; a new request tries the survey again.
    const linked = job.afterSurvey && preparation.surveyId !== null ? surveyById(db, preparation.surveyId) : undefined;
    const survey = linked?.state === "failed" ? linked : previewSurvey(db, repository, preparation, config);
    if (survey.state === "failed") return failPreparation(db, job.preparation, job.requested, `The commit couldn't be surveyed: ${survey.failureMessage ?? survey.failureCode}`);
    // The survey continues this preparation when it finishes.
    if (survey.state !== "succeeded") return null;
    const stored = profileOfSurvey(db, survey.id)!;
    const document = readDocument("repositoryProfile", stored, `Repository Profile ${stored.publicId}`);
    const profile = { surveyId: survey.id, digest: stored.digest };
    const facts = document.fact_document as unknown as FactDocument;
    const reader = await open();
    const manifests = await readManifests(reader, installRootManifests(facts));
    const pages = await readPages(reader, vitePackages(facts));
    const eligibility = evaluateEligibility({ document: facts, manifests, nodeVersions: Object.keys(config.previews.nodeVersions), pages });
    return immediate(db, (tx) => {
      const decided = decidePreparation(tx, job.preparation, job.requested, profile, eligibility);
      // With exactly one qualifying package there's nothing to choose.
      const qualifying = eligibility.packages.filter((verdict) => verdict.qualifies);
      if (decided?.state === "ready" && qualifying.length === 1) startPreview(tx, decided.publicId, qualifying[0]!.directory);
      return decided;
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return failPreparation(db, job.preparation, job.requested, failureText(error));
  }
}

/**
 * The survey to decide from (unify-surveys, design decision 6): the commit's
 * survey under the current recipe, started with the trigger `preview` when
 * there's none, at the priority of work a person waits on. It's among the
 * Repository's versions, and becomes current only when the commit came from
 * the configured reference.
 */
function previewSurvey(db: Executor, repository: Repository, preparation: PreviewPreparation, config: FrontendRegistryConfig): Survey {
  return immediate(db, (tx) => {
    const { survey } = requestSurvey(tx, {
      repositoryId: repository.id,
      commitSha: preparation.commitSha,
      reference: preparation.refName ?? preparation.commitSha,
      // Whatever ref the preview named, its survey becomes current only if its commit is the one the configured reference last named.
      fromConfiguredReference: repository.configuredCommit === preparation.commitSha,
      trigger: "preview",
      ...currentRecipe(config),
    });
    if (survey.state === "queued") queueSurvey(tx, survey, JOB_PRIORITIES.normal);
    linkPreparationSurvey(tx, preparation.id, survey.id);
    return survey;
  });
}

/** The committed package.json of each of +directories+, read through +reader+. */
async function readManifests(reader: SnapshotReader, directories: readonly string[]): Promise<Map<string, ManifestRead>> {
  const results = await reader.readMany(directories.map(manifestPath));
  return new Map(
    directories.map((directory): [string, ManifestRead] => {
      const result = results.get(manifestPath(directory));
      if (!result) return [directory, { state: "unreadable", reason: "it wasn't read" }];
      if (!result.ok) return [directory, result.skip.reason === "missing" ? { state: "missing" } : { state: "unreadable", reason: result.skip.reason }];
      try {
        const manifest: unknown = JSON.parse(result.content.text ?? "");
        if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) return [directory, { state: "read", manifest: manifest as JsonObject }];
        return [directory, { state: "unreadable", reason: "it isn't a JSON object" }];
      } catch {
        return [directory, { state: "unreadable", reason: "it isn't valid JSON" }];
      }
    }),
  );
}

/**
 * Each of +directories+' Vite page, through +reader+: whether index.html is
 * committed at the root its build reads, reading only the configuration that
 * may name that root.
 */
async function readPages(reader: SnapshotReader, directories: readonly string[]): Promise<Map<string, PageRead>> {
  const has = (file: string) => reader.entry(file) !== undefined;
  const configs = await reader.readMany(directories.flatMap((directory) => viteConfig(directory, { has }) ?? []));
  const text = (file: string) => {
    const result = configs.get(file);
    return result?.ok ? result.content.text : null;
  };
  return new Map(directories.map((directory) => [directory, readPage(directory, { has, text })]));
}
