import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type ConclusionFilter, conclusionCounts, latestConclusions } from "@/lib/evaluations/conclusions";

/**
 * Home's fleet summary (home spec): two groups of figures, each read with
 * a fixed number of queries whatever the size of the fleet. A group with no
 * records at all reports `empty`, so Home shows the action that fills it.
 */

export interface FleetSummary {
  /** `profiled` counts Repositories with a current Profile. */
  repositories: { empty: boolean; total: number; profiled: number };
  /** Assessments the operator created. */
  assessments: { empty: boolean; total: number; byConclusion: Record<ConclusionFilter, number> };
}

export function fleetSummary(db: Executor): FleetSummary {
  const total = repositoryCount(db);
  const conclusions = latestConclusions(db);
  return {
    repositories: { empty: total === 0, total, profiled: profiledCount(db) },
    assessments: { empty: conclusions.size === 0, total: conclusions.size, byConclusion: conclusionCounts(conclusions) },
  };
}

/** The Repositories in the catalog, or with +at+, those in it then, in one query. */
export function repositoryCount(db: Executor, options: { at?: Date } = {}): number {
  const at = options.at?.getTime();
  const inCatalog = at === undefined ? sql`deleted_at is null` : sql`created_at <= ${at} and (deleted_at is null or deleted_at > ${at})`;
  return db.get<{ total: number }>(sql`select count(*) as total from repository_sources where ${inCatalog}`)?.total ?? 0;
}

/** Repositories in the catalog with a current Profile, written by any Run, in one query. */
function profiledCount(db: Executor): number {
  const row = db.get<{ profiled: number }>(sql`
    select count(distinct t.repository_source_id) as profiled
    from repository_profiles p
    join assessment_targets t on t.id = p.assessment_target_id
    join repository_sources s on s.id = t.repository_source_id
    where s.deleted_at is null`);
  return row?.profiled ?? 0;
}
