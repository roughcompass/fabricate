import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type ConclusionFilter, conclusionCounts, latestConclusions } from "@/lib/evaluations/conclusions";
import { type RepositoryCounts, repositoryCounts } from "@/lib/ownership/coverage";

/**
 * Home's fleet summary (home spec): three groups of figures, each read with
 * a fixed number of queries whatever the size of the fleet. A group with no
 * records at all reports `empty`, so Home shows the action that fills it.
 */

export interface FleetSummary {
  repositories: RepositoryCounts & { empty: boolean };
  /** Assessments the operator created; those created for claims are left out. */
  assessments: { empty: boolean; total: number; byConclusion: Record<ConclusionFilter, number> };
  /** Web Applications never become active themselves; they go live when a Portal approves a placement, which activates its route. */
  onboarding: { empty: boolean; activePortals: number; placedApplications: number };
}

export function fleetSummary(db: Executor): FleetSummary {
  const repositories = repositoryCounts(db);
  const conclusions = latestConclusions(db, { systemOwned: false });
  const onboarding = db.get<{ portals: number; active_portals: number; applications: number; placed_applications: number }>(sql`
    select
      (select count(*) from portals) as portals,
      (select count(*) from portals where lifecycle = 'active') as active_portals,
      (select count(*) from applications) as applications,
      (select count(distinct application_id) from placement_routes where active = 1) as placed_applications`)!;
  return {
    repositories: { ...repositories, empty: repositories.total === 0 },
    assessments: { empty: conclusions.size === 0, total: conclusions.size, byConclusion: conclusionCounts(conclusions) },
    onboarding: { empty: onboarding.portals + onboarding.applications === 0, activePortals: onboarding.active_portals, placedApplications: onboarding.placed_applications },
  };
}

/** The Claimed figure's share of enabled Repositories, as a whole percentage; null when none is enabled. */
export function claimedShare(repositories: Pick<RepositoryCounts, "enabled" | "claimed">): number | null {
  return repositories.enabled === 0 ? null : Math.round((repositories.claimed / repositories.enabled) * 100);
}
