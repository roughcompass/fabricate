import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { countLabel, formatNumber, percentOf } from "@/components/ui/count";
import { formatShortDate } from "@/components/ui/time";
import type { Coverage, FleetRepository } from "@/lib/adoption/fleet";
import type { Share } from "@/lib/adoption/queries";
import type { SnapshotComparison } from "@/lib/adoption/snapshots";
import { type TrackedDesignSystem, trackedDesignSystem } from "@/lib/adoption/tracked";
import { type DescribedThing, catalogConfiguration } from "@/lib/catalog/configuration";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { routes } from "@/lib/web/routes";
import styles from "./adoption.module.css";

/** How many Repositories an alert names before it counts the rest. */
const NAMED = 8;

/** Repositories as links to their pages: the first few, then how many more. */
export function RepositoryLinks({ repositories }: { repositories: readonly FleetRepository[] }) {
  const shown = repositories.slice(0, NAMED);
  return (
    <span className={styles.links}>
      {shown.map((repository, index) => (
        <span key={repository.publicId}>
          {index > 0 && ", "}
          <Link href={routes.repository(repository.publicId)}>{repository.name}</Link>
        </span>
      ))}
      {repositories.length > shown.length && `, and ${formatNumber(repositories.length - shown.length)} more`}
    </span>
  );
}

/**
 * Partial coverage (adoption-analytics spec, "Adoption reads each
 * repository's current Profile"): how many registered Repositories the
 * figures leave out, and which, so they're never read as not using what's
 * measured.
 */
export function CoverageAlert({ coverage }: { coverage: Coverage }) {
  if (coverage.notCovered.length === 0) return null;
  const unprofiled = coverage.notCovered.filter((repository) => repository.reason === "no_profile").length;
  return (
    <Alert tone="warning" title={`${formatNumber(coverage.notCovered.length)} of ${countLabel(coverage.registered, "Repository", "Repositories")} aren't covered`}>
      <p>
        {unprofiled === coverage.notCovered.length
          ? "They have no Profile yet, so these figures leave them out."
          : unprofiled > 0
            ? `${formatNumber(unprofiled)} have no Profile yet, and the rest have Profiles that don't describe design systems, so these figures leave them out.`
            : "Their Profiles don't describe design systems, so these figures leave them out."}
      </p>
      <p>
        <RepositoryLinks repositories={coverage.notCovered} />
      </p>
    </Alert>
  );
}

/** A share as a percentage, with the counts it divides (adoption-analytics spec: a share is always shown with its counts). */
export function shareLabel(share: Share): string {
  return share.of > 0 ? `${percentOf(share.count, share.of)}%` : "None";
}

export function shareCounts(share: Share, noun: string): string {
  return `${formatNumber(share.count)} of ${formatNumber(share.of)} ${noun}`;
}

/**
 * A figure's change between the two newest snapshots, as a key figure's hint,
 * such as "+14 since the Nov 12 snapshot"; nothing before there are two.
 */
export function changeSince(comparison: SnapshotComparison | undefined, figure: string): string | undefined {
  const change = comparison?.figures[figure];
  if (!comparison?.earlier || change === null || change === undefined) return undefined;
  const since = `since the ${formatShortDate(comparison.earlier.takenAt)} snapshot`;
  return change === 0 ? `No change ${since}` : `${change > 0 ? "+" : "−"}${formatNumber(Math.abs(change))} ${since}`;
}

/** Joins a figure's hint parts, leaving out the missing ones. */
export const hint = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ") || undefined;

/** The design systems the Reference Catalog describes, each with its tracked entry once it has one. */
export function describedDesignSystems(db: Executor, config: FrontendRegistryConfig): { thing: DescribedThing; tracked: TrackedDesignSystem | undefined }[] {
  return catalogConfiguration(config)
    .things.filter((thing) => thing.kind === "design_system")
    .map((thing) => ({ thing, tracked: trackedDesignSystem(db, config, thing.id) }));
}

/** The packages adoption tracks: each described thing's package, tokens, and icons. */
export function trackedPackages(config: FrontendRegistryConfig): string[] {
  return [...new Set(catalogConfiguration(config).things.flatMap((thing) => [thing.package, thing.tokens, thing.icons].filter((name): name is string => Boolean(name))))];
}

/** The date of a tracked entry's published data, which sections read from it show as "as of". */
export function publishedAsOf(tracked: TrackedDesignSystem): string | undefined {
  return tracked.sources.find((source) => source.snapshot_date)?.snapshot_date;
}

/** A design system's name before its entry is built: its id, capitalized. */
export const thingName = (thing: DescribedThing) => thing.id.charAt(0).toUpperCase() + thing.id.slice(1);
