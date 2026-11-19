import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { resolveReference } from "@/lib/acquisition/acquire";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { JOB_PRIORITIES, type SurveyTrigger, jobs } from "@/lib/db/schema";
import type { GitRunner } from "@/lib/git/runner";
import { type Job, enqueue } from "@/lib/jobs/queue";
import { type Recipe, type Survey, currentRecipe, recordConfiguredResolution, requestSurvey, sameRecipe, surveyById } from "./records";
import { queueSurvey } from "./run";

/*
 * Background surveying (unify-surveys, design decision 5): a Repository's
 * configured reference is surveyed when the Repository is added or edited,
 * when the reference has a new commit, when the recipe changes, and when an
 * operator asks. It's a function, not a Run: it resolves the reference, then
 * queues a survey unless one with the current key already succeeded or is
 * on its way. Adding, editing, and the scheduled check request it through a
 * job of its own per Repository, whose last error says why a reference
 * couldn't be read.
 */

export const REQUEST_SURVEY = "survey.request";

/** Why a background survey is requested; `check` lets the outcome name the reason: a first survey, a new commit, or a new recipe. */
export type BackgroundTrigger = Exclude<SurveyTrigger, "run" | "preview"> | "check";

export type BackgroundResult =
  /** A survey of the reference's commit was queued, or a failed one queued again. */
  | { readonly status: "queued"; readonly survey: Survey }
  /** One with the current key is queued or running. */
  | { readonly status: "active"; readonly survey: Survey }
  /** One with the current key already succeeded: the Profile is up to date. */
  | { readonly status: "current"; readonly survey: Survey };

export interface SurveyRepositoryOptions {
  config?: FrontendRegistryConfig;
  runner?: GitRunner;
  signal?: AbortSignal;
}

/** Resolves +repository+'s configured reference and requests its survey under the current recipe, at background priority. */
export async function surveyRepository(db: Executor, repository: Repository, trigger: BackgroundTrigger, options: SurveyRepositoryOptions = {}): Promise<BackgroundResult> {
  const config = options.config ?? getConfig();
  const resolution = await resolveReference({ repositoryPublicId: repository.publicId, cloneUrl: repository.cloneUrl, gitRef: repository.gitRef }, { config, ...(options.runner && { runner: options.runner }), ...(options.signal && { signal: options.signal }) });
  const recipe = currentRecipe(config);
  return immediate(db, (tx) => {
    const { survey, queued } = requestSurvey(tx, {
      repositoryId: repository.id,
      commitSha: resolution.commitSha,
      reference: resolution.name,
      fromConfiguredReference: true,
      trigger: trigger === "check" ? checkTrigger(tx, repository, resolution.commitSha, recipe) : trigger,
      ...recipe,
    });
    recordConfiguredResolution(tx, repository.id, resolution.commitSha, new Date());
    if (queued) {
      queueSurvey(tx, survey, JOB_PRIORITIES.background);
      return { status: "queued", survey };
    }
    return { status: survey.state === "succeeded" ? "current" : "active", survey };
  });
}

/**
 * Why the scheduled check surveys a commit: the Repository's first survey, a
 * new commit of its reference, the same commit under a new Surveyor release
 * or configuration, or the same commit and recipe when a Reference Catalog
 * entry its current survey used has changed.
 */
function checkTrigger(db: Executor, repository: Repository, commitSha: string, recipe: Recipe): SurveyTrigger {
  if (repository.currentSurveyId === null) return "added";
  const current = surveyById(db, repository.currentSurveyId);
  if (current.commitSha !== commitSha) return "commit";
  return sameRecipe(current, recipe) ? "catalog" : "recipe";
}

/**
 * Why +repository+'s reference couldn't be read when it was last asked for,
 * unless a survey was requested since: the error of its newest survey
 * request, which failed before a commit was known.
 */
export function surveyRequestFailure(db: Executor, repository: Pick<Repository, "publicId">, latest: Pick<Survey, "createdAt"> | undefined): { message: string; at: Date } | null {
  const job = db
    .select({ state: jobs.state, lastError: jobs.lastError, finishedAt: jobs.finishedAt })
    .from(jobs)
    .where(and(eq(jobs.kind, REQUEST_SURVEY), eq(sql`json_extract(${jobs.payload}, '$.repository')`, repository.publicId)))
    .orderBy(desc(jobs.id))
    .limit(1)
    .get();
  if (!job || job.state !== "failed" || !job.finishedAt || (latest && latest.createdAt > job.finishedAt)) return null;
  return { message: job.lastError ?? "The reference couldn't be read.", at: job.finishedAt };
}

/** Queues a job that surveys +repository+ in the background, so adding or editing one doesn't wait on its remote. */
export function requestBackgroundSurvey(db: Executor, repository: Pick<Repository, "publicId">, trigger: BackgroundTrigger, key: string = crypto.randomUUID()): Job {
  return enqueue(db, { kind: REQUEST_SURVEY, payload: { repository: repository.publicId, trigger }, idempotencyKey: `${REQUEST_SURVEY}:${repository.publicId}:${key}`, priority: JOB_PRIORITIES.background, maxAttempts: 1 });
}
