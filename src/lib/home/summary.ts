import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type ConclusionFilter, conclusionCounts, latestConclusions } from "@/lib/evaluations/conclusions";
import { type RepositoryCounts, repositoryCounts } from "@/lib/ownership/coverage";

/**
 * Home's fleet summary (home spec): two groups of figures, each read with
 * a fixed number of queries whatever the size of the fleet. A group with no
 * records at all reports `empty`, so Home shows the action that fills it.
 */

export interface FleetSummary {
  /** `profiled` counts Repositories with at least one finished profile version. */
  repositories: RepositoryCounts & { empty: boolean; profiled: number };
  /** Assessments the operator created; those created for claims are left out. */
  assessments: { empty: boolean; total: number; byConclusion: Record<ConclusionFilter, number> };
}

export function fleetSummary(db: Executor): FleetSummary {
  const repositories = repositoryCounts(db);
  const conclusions = latestConclusions(db, { systemOwned: false });
  return {
    repositories: { ...repositories, empty: repositories.total === 0, profiled: profiledCount(db) },
    assessments: { empty: conclusions.size === 0, total: conclusions.size, byConclusion: conclusionCounts(conclusions) },
  };
}

/** The Claimed figure's share of all Repositories, as a whole percentage; null when there are none. */
export function claimedShare(repositories: Pick<RepositoryCounts, "total" | "claimed">): number | null {
  return repositories.total === 0 ? null : Math.round((repositories.claimed / repositories.total) * 100);
}

/** Repositories in the catalog with at least one finished profile version, in one query. */
function profiledCount(db: Executor): number {
  const row = db.get<{ profiled: number }>(sql`
    select count(distinct v.repository_source_id) as profiled
    from profile_versions v
    join assessments a on a.id = v.assessment_id
    join repository_sources s on s.id = v.repository_source_id
    where s.deleted_at is null and a.state in ('complete', 'complete_with_issues')`);
  return row?.profiled ?? 0;
}
