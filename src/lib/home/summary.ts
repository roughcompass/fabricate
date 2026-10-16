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
  /** Applications registered through Create Application, and the Portals they belong to. */
  applications: { empty: boolean; applications: number; undetermined: number; productionPortals: number };
}

export function fleetSummary(db: Executor): FleetSummary {
  const repositories = repositoryCounts(db);
  const conclusions = latestConclusions(db, { systemOwned: false });
  // A Portal counts once it's onboarded, so a Portal named only in a claim doesn't hide the empty state.
  const applications = db.get<{ portals: number; production_portals: number; applications: number; undetermined: number }>(sql`
    select
      (select count(*) from portals p where exists (select 1 from onboarding_events e where e.portal_id = p.id)) as portals,
      (select count(*) from portals p where p.lifecycle = 'production' and exists (select 1 from onboarding_events e where e.portal_id = p.id)) as production_portals,
      (select count(*) from applications where repository_source_id is not null) as applications,
      (select count(*) from applications where repository_source_id is not null and rendering_mode = 'undetermined') as undetermined`)!;
  return {
    repositories: { ...repositories, empty: repositories.total === 0 },
    assessments: { empty: conclusions.size === 0, total: conclusions.size, byConclusion: conclusionCounts(conclusions) },
    applications: { empty: applications.portals + applications.applications === 0, applications: applications.applications, undetermined: applications.undetermined, productionPortals: applications.production_portals },
  };
}

/** The Claimed figure's share of enabled Repositories, as a whole percentage; null when none is enabled. */
export function claimedShare(repositories: Pick<RepositoryCounts, "enabled" | "claimed">): number | null {
  return repositories.enabled === 0 ? null : Math.round((repositories.claimed / repositories.enabled) * 100);
}
