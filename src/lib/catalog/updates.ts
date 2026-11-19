import { and, eq, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { jobs, repositories, surveys } from "@/lib/db/schema";
import { REQUEST_SURVEY, requestBackgroundSurvey } from "@/lib/surveys/background";
import { latestSurvey } from "@/lib/surveys/records";
import type { CurrentCatalog } from "./current";
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
