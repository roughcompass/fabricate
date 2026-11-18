import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import type { RepositoryOwnership } from "./read";

/**
 * Whether Repositories are claimed (home spec, fleet summary; page-patterns
 * spec, list filters). A Repository is claimed when it has an effective SEAL
 * application: at least one application assertion about it that nothing has
 * superseded, whatever its source and even while candidates conflict. That is
 * exactly when `effectiveValue` returns a value, so Home's SQL count and the
 * Repositories list, which classifies rows through `repositoryOwnership`,
 * always agree.
 */

const OWNERSHIP_FILTERS = ["claimed", "unclaimed"] as const;
export type OwnershipFilter = (typeof OWNERSHIP_FILTERS)[number];

export function isOwnershipFilter(value: unknown): value is OwnershipFilter {
  return typeof value === "string" && (OWNERSHIP_FILTERS as readonly string[]).includes(value);
}

/** The ownership filter a Repository's resolved ownership falls under. */
export function ownershipFilterOf(ownership: Pick<RepositoryOwnership, "application"> | undefined): OwnershipFilter {
  return ownership?.application.value ? "claimed" : "unclaimed";
}

export interface RepositoryCounts {
  /** Every Repository. */
  total: number;
  /** Repositories with an effective SEAL application. */
  claimed: number;
  /** Repositories without one. */
  unclaimed: number;
}

/** Counts the catalog's Repositories and the claimed ones, in one query. */
export function repositoryCounts(db: Executor): RepositoryCounts {
  const row = db.get<{ total: number; claimed: number | null }>(sql`
    select count(*) as total,
      sum(case when exists (
        select 1 from ownership_assertions a
        where a.subject_repository_source_id = s.id and a.attribute = 'application'
          and not exists (select 1 from ownership_supersessions x where x.superseded_id = a.id)
      ) then 1 else 0 end) as claimed
    from repository_sources s
    where s.deleted_at is null`);
  const total = row?.total ?? 0;
  const claimed = row?.claimed ?? 0;
  return { total, claimed, unclaimed: total - claimed };
}
