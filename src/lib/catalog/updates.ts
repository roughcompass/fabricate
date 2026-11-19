import { and, eq, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { jobs, repositories, surveys } from "@/lib/db/schema";
import { REQUEST_SURVEY, requestBackgroundSurvey } from "@/lib/surveys/background";
import { type Recipe, currentRecipe, latestSurvey, sameRecipe } from "@/lib/surveys/records";
import { catalogConfiguration } from "./configuration";
import { type CurrentCatalog, currentCatalog } from "./current";
import { catalogIsCurrent } from "./recipe";

/*
 * Re-surveys after an entry changes (establish-frontend-registry, the
 * repository-surveys scenario "Salt entry rebuilt"): when a build stores a
 * new entry, each registered Repository whose current survey's entries a
 * survey would no longer pick gets a background survey requested, which
 * runs with the trigger `catalog`. Other Repositories get none. The
 * scheduled profiling check finds the same Repositories; this only saves
 * them the wait.
 */

/** Requests a background survey of each registered Repository whose current survey's Catalog entries aren't current, unless one is already on its way. Returns how many were requested. */
export function requestCatalogUpdates(db: Executor, catalog: CurrentCatalog, key: string): number {
  const current = db
    .select({ repository: repositories, survey: surveys })
    .from(repositories)
    .innerJoin(surveys, eq(surveys.id, repositories.currentSurveyId))
    .where(isNull(repositories.deletedAt))
    .all()
    .filter(({ survey }) => !catalogIsCurrent(survey.catalog, catalog));
  if (current.length === 0) return 0;
  const waiting = new Set(requestedRepositories(db));
  let requested = 0;
  for (const { repository } of current) {
    const latest = latestSurvey(db, repository.id);
    if (waiting.has(repository.publicId) || latest?.state === "queued" || latest?.state === "running") continue;
    requestBackgroundSurvey(db, repository, "check", key);
    requested += 1;
  }
  return requested;
}

/** Repositories with a survey request waiting to run. */
function requestedRepositories(db: Executor): string[] {
  return db
    .select({ repository: sql<string>`json_extract(${jobs.payload}, '$.repository')` })
    .from(jobs)
    .where(and(eq(jobs.kind, REQUEST_SURVEY), eq(jobs.state, "queued")))
    .all()
    .map((row) => row.repository);
}

/** How a registered Repository's newest version stands against the current recipe: made with it, waiting to be surveyed under it, or failed. */
export const RECIPE_STATES = ["current", "waiting", "failed"] as const;
export type RecipeState = (typeof RECIPE_STATES)[number];

/**
 * Each registered Repository's recipe state, by Repository id. Its newest
 * version is current when it succeeded with the current Surveyor release,
 * configuration, and Profile version, and with Catalog entries a survey
 * would still pick; waiting when it's queued or running, when it's made with
 * an older recipe, or when there is none yet; and failed when it failed.
 * @public The system status page counts re-survey progress, and the Repositories list filters by recipe, through this.
 */
export function recipeStates(db: Executor, config: FrontendRegistryConfig, recipe: Recipe = currentRecipe(config)): Map<number, RecipeState> {
  const registered = db.select({ id: repositories.id }).from(repositories).where(isNull(repositories.deletedAt)).all();
  const states = new Map<number, RecipeState>(registered.map((repository) => [repository.id, "waiting"]));
  const catalog = currentCatalog(db, catalogConfiguration(config));
  for (const survey of newestSurveys(db)) {
    if (survey.state === "failed") states.set(survey.repositoryId, "failed");
    else if (survey.state === "succeeded" && sameRecipe(survey, recipe) && catalogIsCurrent(survey.catalog, catalog)) states.set(survey.repositoryId, "current");
  }
  return states;
}

/**
 * The newest survey of each registered Repository, and no other: one row per
 * Repository whatever its history, found through the survey number index.
 * @public The recipe states read only these, and a test checks it.
 */
export function newestSurveys(db: Executor): (typeof surveys.$inferSelect)[] {
  const newest = alias(surveys, "newest");
  return db
    .select({ survey: surveys })
    .from(repositories)
    .innerJoin(surveys, eq(surveys.repositoryId, repositories.id))
    .where(and(isNull(repositories.deletedAt), eq(surveys.number, db.select({ number: max(newest.number) }).from(newest).where(eq(newest.repositoryId, repositories.id)))))
    .all()
    .map((row) => row.survey);
}

/**
 * How many registered Repositories are in each recipe state.
 * @public The system status page shows re-survey progress through this.
 */
export function recipeProgress(db: Executor, config: FrontendRegistryConfig): Record<RecipeState, number> {
  const counts: Record<RecipeState, number> = { current: 0, waiting: 0, failed: 0 };
  for (const state of recipeStates(db, config).values()) counts[state] += 1;
  return counts;
}
