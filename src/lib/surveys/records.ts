import { detectorConfiguration } from "@repo-facts/bundle";
import { SURVEYOR_RELEASE } from "@/lib/surveys/surveyor-release";
import { and, desc, eq, max } from "drizzle-orm";
import type { FrontendRegistryConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type SurveyState, type SurveyTrigger, runTargets, repositories, surveys } from "@/lib/db/schema";
import { SURVEY_MACHINE, assertTransition } from "@/lib/db/state-machines";
import { CURRENT_VERSION } from "@/lib/documents/schemas";
import { catalogConfiguration } from "@/lib/catalog/configuration";
import { type CurrentCatalog, currentCatalog } from "@/lib/catalog/current";
import { catalogIsCurrent } from "@/lib/catalog/recipe";

/*
 * Surveys (unify-surveys, design decision 1): one Surveyor run per
 * Repository, commit, and recipe, which Runs, background surveying, and
 * previews share. Finding or creating one, retrying a failed one, and
 * numbering happen in one immediate transaction, so two requests for one key
 * never make two surveys.
 *
 * The recipe includes the Reference Catalog entries a survey was compared
 * against (establish-frontend-registry, design decision 6). Surveyor picks
 * them as it runs, so a successful survey matches a request only while its
 * entries are still the ones a survey would pick now; otherwise the commit
 * is surveyed again under a new key.
 */

export type Survey = typeof surveys.$inferSelect;

/** What a survey's Profile is made with, besides the Reference Catalog entries Surveyor picks as it runs. */
export interface Recipe {
  surveyorRelease: string;
  configurationDigest: string;
  profileSchemaVersion: number;
}

/** The recipe this worker surveys with. */
export function currentRecipe(config: FrontendRegistryConfig): Recipe {
  return { surveyorRelease: SURVEYOR_RELEASE, configurationDigest: detectorConfiguration(config.analysis).digest, profileSchemaVersion: CURRENT_VERSION.repositoryProfile };
}

export interface SurveyRequest extends Recipe {
  repositoryId: number;
  commitSha: string;
  /** The reference the commit was resolved from, or the commit itself. */
  reference: string;
  fromConfiguredReference: boolean;
  trigger: SurveyTrigger;
  requestedByRunId?: number | null;
  resolvedAt?: Date;
  /** The current Reference Catalog, which decides whether a successful survey's entries are still current; read from the database when not given. */
  catalog?: CurrentCatalog;
}

export interface Requested {
  survey: Survey;
  /** Whether this request queued it: a new survey, or a failed one retried. */
  queued: boolean;
}

/**
 * The survey of +request+'s key: an existing one, a failed one queued again
 * under the same key, or a new one with the Repository's next number.
 */
export function requestSurvey(db: Executor, request: SurveyRequest): Requested {
  return immediate(db, (tx) => {
    const existing = surveyOfKey(tx, request.repositoryId, request.commitSha, request, request.catalog ?? currentCatalog(tx, catalogConfiguration()));
    if (existing) {
      if (existing.state !== "failed") return { survey: existing, queued: false };
      return { survey: moveSurvey(tx, existing, "queued", {}), queued: true };
    }
    const number = (tx.select({ last: max(surveys.number) }).from(surveys).where(eq(surveys.repositoryId, request.repositoryId)).get()?.last ?? 0) + 1;
    const now = new Date();
    const survey = tx
      .insert(surveys)
      .values({
        publicId: generatePublicId("srv"),
        repositoryId: request.repositoryId,
        number,
        commitSha: request.commitSha,
        reference: request.reference,
        fromConfiguredReference: request.fromConfiguredReference,
        resolvedAt: request.resolvedAt ?? now,
        surveyorRelease: request.surveyorRelease,
        configurationDigest: request.configurationDigest,
        profileSchemaVersion: request.profileSchemaVersion,
        trigger: request.trigger,
        requestedByRunId: request.requestedByRunId ?? null,
        createdAt: now,
      })
      .returning()
      .get();
    return { survey, queued: true };
  });
}

/**
 * The survey of a commit under +recipe+ and the current Catalog +catalog+: a
 * successful one whose entries are still current, or else the one on its way
 * or failed, which compares against the current entries when it runs.
 */
export function surveyOfKey(db: Executor, repositoryId: number, commitSha: string, recipe: Recipe, catalog: CurrentCatalog): Survey | undefined {
  const candidates = db
    .select()
    .from(surveys)
    .where(
      and(
        eq(surveys.repositoryId, repositoryId),
        eq(surveys.commitSha, commitSha),
        eq(surveys.surveyorRelease, recipe.surveyorRelease),
        eq(surveys.configurationDigest, recipe.configurationDigest),
        eq(surveys.profileSchemaVersion, recipe.profileSchemaVersion),
      ),
    )
    .orderBy(desc(surveys.number))
    .all();
  return candidates.find((survey) => survey.state === "succeeded" && catalogIsCurrent(survey.catalog, catalog)) ?? candidates.find((survey) => survey.state !== "succeeded");
}

/** Whether +survey+ was made with +recipe+'s Surveyor release, configuration, and Profile version. */
export function sameRecipe(survey: Pick<Survey, keyof Recipe>, recipe: Recipe): boolean {
  return survey.surveyorRelease === recipe.surveyorRelease && survey.configurationDigest === recipe.configurationDigest && survey.profileSchemaVersion === recipe.profileSchemaVersion;
}

/** Moves +survey+ to +state+ with +changes+, checking the state machine. */
export function moveSurvey(db: Executor, survey: Survey, state: SurveyState, changes: Partial<Pick<Survey, "attempts" | "failureCode" | "failureMessage" | "treeSha" | "internalRef" | "catalog" | "catalogDigest">>): Survey {
  if (state !== survey.state) assertTransition(SURVEY_MACHINE, survey.state, state, `Survey ${survey.publicId}`);
  const finishedAt = state === "succeeded" || state === "failed" ? new Date() : null;
  return db.update(surveys).set({ ...changes, state, finishedAt }).where(eq(surveys.id, survey.id)).returning().get();
}

/** Records where its commit is pinned, once. */
export function pinSurvey(db: Executor, survey: Survey, pin: { treeSha: string | null; internalRef: string }): Survey {
  if (survey.internalRef) return survey;
  return db.update(surveys).set(pin).where(eq(surveys.id, survey.id)).returning().get();
}

/**
 * Records that the Repository's configured reference named +commitSha+ at
 * +at+ (design decision 4), unless it was since resolved later, and makes
 * that commit's newest successful survey current when there is one. While the
 * commit has none, the survey current before stays current.
 */
export function recordConfiguredResolution(db: Executor, repositoryId: number, commitSha: string, at: Date): void {
  const repository = db.select({ deletedAt: repositories.deletedAt, resolvedAt: repositories.configuredResolvedAt }).from(repositories).where(eq(repositories.id, repositoryId)).get();
  if (!repository || repository.deletedAt || (repository.resolvedAt && repository.resolvedAt > at)) return;
  db.update(repositories).set({ configuredCommit: commitSha, configuredResolvedAt: at }).where(eq(repositories.id, repositoryId)).run();
  const succeeded = db
    .select()
    .from(surveys)
    .where(and(eq(surveys.repositoryId, repositoryId), eq(surveys.commitSha, commitSha), eq(surveys.state, "succeeded")))
    .orderBy(desc(surveys.number))
    .limit(1)
    .get();
  if (succeeded) db.update(repositories).set({ currentSurveyId: succeeded.id }).where(eq(repositories.id, repositoryId)).run();
}

/**
 * Makes +survey+, which just succeeded, its Repository's current one when
 * its commit is the one the configured reference last named, whichever
 * request started it: a Run, a check, or a preview (design decision 4).
 */
export function updateCurrentSurvey(db: Executor, survey: Survey): void {
  if (survey.state !== "succeeded") return;
  const repository = db.select({ configuredCommit: repositories.configuredCommit, deletedAt: repositories.deletedAt }).from(repositories).where(eq(repositories.id, survey.repositoryId)).get();
  if (!repository || repository.deletedAt || repository.configuredCommit !== survey.commitSha) return;
  db.update(repositories).set({ currentSurveyId: survey.id }).where(eq(repositories.id, survey.repositoryId)).run();
}

export function surveyById(db: Executor, id: number): Survey {
  const survey = db.select().from(surveys).where(eq(surveys.id, id)).get();
  if (!survey) throw new NotFoundError(`Survey ${id} does not exist`);
  return survey;
}

export function getSurvey(db: Executor, publicId: string): Survey {
  const survey = db.select().from(surveys).where(eq(surveys.publicId, publicId)).get();
  if (!survey) throw new NotFoundError(`Survey ${publicId} does not exist`);
  return survey;
}

/** The commit each target of Run +assessmentId+ resolved to, once it joined its survey, by target id. */
export function targetCommits(db: Executor, runId: number): Map<number, string> {
  const rows = db.select({ targetId: runTargets.id, commit: surveys.commitSha }).from(runTargets).innerJoin(surveys, eq(surveys.id, runTargets.surveyId)).where(eq(runTargets.runId, runId)).all();
  return new Map(rows.map((row) => [row.targetId, row.commit]));
}

/** A Repository's newest survey, whatever its state. */
export function latestSurvey(db: Executor, repositoryId: number): Survey | undefined {
  return db.select().from(surveys).where(eq(surveys.repositoryId, repositoryId)).orderBy(desc(surveys.number)).limit(1).get();
}
