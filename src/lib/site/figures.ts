import { entriesInUse } from "@/lib/catalog/current";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { fleetSummary } from "@/lib/home/summary";

/*
 * The marketing page's live figures (product-site spec, "The marketing page
 * claims only what the running release does"): read from the Frontend
 * Registry when the page is served, with Home's queries, each in a fixed
 * number of queries whatever the size of the fleet, and with the time they
 * were read. The page hides a figure whose count is zero.
 */

export interface SiteFigures {
  readonly repositories: number;
  readonly profiled: number;
  /** Salt versions with a current Reference Catalog entry. */
  readonly saltVersions: number;
  readonly readAt: Date;
}

export function siteFigures(db: Executor, config: FrontendRegistryConfig, now = new Date()): SiteFigures {
  const { repositories } = fleetSummary(db);
  const saltVersions = new Set(entriesInUse(db, config).filter((entry) => entry.kind === "design_system" && entry.entryId === "salt").map((entry) => entry.version)).size;
  return { repositories: repositories.total, profiled: repositories.profiled, saltVersions, readAt: now };
}
