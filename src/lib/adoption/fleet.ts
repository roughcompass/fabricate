import { type ReferenceCatalogEntry, selectEntry } from "@repo-facts/contract";
import { and, eq, inArray, isNull } from "drizzle-orm";
import semver from "semver";
import { storedEntries } from "@/lib/catalog/entries";
import { PRODUCT } from "@/lib/product";
import type { Executor } from "@/lib/db/client";
import { type DesignSystemFigures, type RecognizedDesignSystem, designSystemProfiles, designSystemUsage, repositories, repositoryProfiles, surveys } from "@/lib/db/schema";

/*
 * The fleet Adoption Analytics counts (establish-frontend-registry, design
 * decision 7; the adoption-analytics requirement "Adoption reads each
 * repository's current Profile"): every registered Repository, with its
 * current Profile's design-system row from the projection. A Repository with
 * no current Profile, or whose design-system facts are unknown, is not
 * covered: it's listed, and never counted as not using what's measured. Nor
 * is one that uses a design system at a version no Reference Catalog entry
 * covered when it was surveyed, since none of its components could be
 * recognized: it waits for that version's entry, then for its next survey.
 * Nothing here reads a Profile document.
 */

export interface FleetRepository {
  readonly id: number;
  readonly publicId: string;
  readonly name: string;
}

/** Why a registered Repository isn't counted: it has no Profile yet, its design-system facts are unknown or weren't surveyed, or no entry covered its design system's version. */
export type NotCoveredReason = "no_profile" | "facts_unknown" | "no_entry";

export interface NotCoveredRepository extends FleetRepository {
  readonly reason: NotCoveredReason;
  /**
   * For `no_entry`: the design system, the version the Repository wants, and
   * the version of the entry built for it since, which its next survey will
   * use, or null while there is none.
   */
  readonly missing?: { readonly designSystem: string; readonly name: string; readonly version: string | null; readonly built: string | null };
}

export interface CoveredRepository extends FleetRepository {
  readonly profileId: number;
  /** The design systems its current Profile recognizes, with their summary figures. */
  readonly recognized: readonly RecognizedDesignSystem[];
}

export interface Coverage {
  /** Registered Repositories. */
  readonly registered: number;
  readonly covered: readonly CoveredRepository[];
  readonly notCovered: readonly NotCoveredRepository[];
}

/** A category state that says nothing about the repository. */
const UNKNOWN = new Set([null, "unknown"]);

/** Every registered Repository, as covered by its current Profile's design-system facts or not. One query, and the stored entries' versions. */
export function designSystemCoverage(db: Executor): Coverage {
  const rows = db
    .select({ id: repositories.id, publicId: repositories.publicId, name: repositories.name, profileId: repositoryProfiles.id, summary: designSystemProfiles })
    .from(repositories)
    .leftJoin(surveys, eq(surveys.id, repositories.currentSurveyId))
    .leftJoin(repositoryProfiles, eq(repositoryProfiles.surveyId, surveys.id))
    .leftJoin(designSystemProfiles, eq(designSystemProfiles.profileId, repositoryProfiles.id))
    .where(isNull(repositories.deletedAt))
    .orderBy(repositories.name)
    .all();
  const covered: CoveredRepository[] = [];
  const notCovered: NotCoveredRepository[] = [];
  let entries: ReferenceCatalogEntry[] | undefined;
  for (const row of rows) {
    const repository = { id: row.id, publicId: row.publicId, name: row.name };
    if (row.profileId === null) notCovered.push({ ...repository, reason: "no_profile" });
    else if (!row.summary || UNKNOWN.has(row.summary.designSystemsState) || UNKNOWN.has(row.summary.uiElementsState)) notCovered.push({ ...repository, reason: "facts_unknown" });
    else {
      // From fact document version 3, a recognized design system names the entry it was compared against, or null for none.
      const uncompared = row.summary.recognized.find((system) => system.entry === null);
      if (!uncompared) covered.push({ ...repository, profileId: row.profileId, recognized: row.summary.recognized });
      else {
        entries ??= catalogEntries(db);
        const wanted = uncompared.wanted ?? { package: undefined, version: null };
        const built = selectEntry(entries, { kind: "design_system", id: uncompared.id, ...(wanted.package && { package: wanted.package }), version: wanted.version });
        notCovered.push({ ...repository, reason: "no_entry", missing: { designSystem: uncompared.id, name: uncompared.name, version: wanted.version, built: built?.version ?? null } });
      }
    }
  }
  return { registered: rows.length, covered, notCovered };
}

/** The stored entries, as `selectEntry` reads them: without their content. */
function catalogEntries(db: Executor): ReferenceCatalogEntry[] {
  return storedEntries(db).map((entry) => ({ kind: entry.kind, id: entry.entryId, version: entry.version, format_version: entry.formatVersion, digest: entry.digest, built_at: entry.builtAt.toISOString(), packages: entry.packages }) as unknown as ReferenceCatalogEntry);
}

export type UsageRow = typeof designSystemUsage.$inferSelect;

/** The usage rows of +designSystem+ of +kind+ in the covered Repositories' current Profiles, with each row's Repository. */
export function usageOf(db: Executor, coverage: Coverage, designSystem: string, kind: UsageRow["kind"], name?: string): { repository: CoveredRepository; row: UsageRow }[] {
  if (coverage.covered.length === 0) return [];
  const byProfile = new Map(coverage.covered.map((repository) => [repository.profileId, repository]));
  // Profiles are matched in chunks well under SQLite's bound-parameter limit.
  const profileIds = [...byProfile.keys()];
  const rows: UsageRow[] = [];
  for (let start = 0; start < profileIds.length; start += 500) {
    rows.push(
      ...db
        .select()
        .from(designSystemUsage)
        .where(and(eq(designSystemUsage.designSystem, designSystem), eq(designSystemUsage.kind, kind), name === undefined ? undefined : eq(designSystemUsage.name, name), inArray(designSystemUsage.profileId, profileIds.slice(start, start + 500))))
        .all(),
    );
  }
  return rows.map((row) => ({ repository: byProfile.get(row.profileId)!, row }));
}

/** The covered Repositories whose current Profile recognizes +designSystem+, with its summary. */
export function recognizing(coverage: Coverage, designSystem: string): { repository: CoveredRepository; system: RecognizedDesignSystem }[] {
  return coverage.covered.flatMap((repository) => repository.recognized.filter((system) => system.id === designSystem).map((system) => ({ repository, system })));
}

/** The sum of +figures+ in one scope. */
export function totalFigures(figures: readonly DesignSystemFigures[]): DesignSystemFigures {
  return figures.reduce((sum, item) => ({ designSystem: sum.designSystem + item.designSystem, elements: sum.elements + item.elements, tokenized: sum.tokenized + item.tokenized, tokenCapable: sum.tokenCapable + item.tokenCapable }), { designSystem: 0, elements: 0, tokenized: 0, tokenCapable: 0 });
}

/**
 * Why Repositories aren't covered, in words, each reason with the
 * Repositories it holds back; a design system's missing versions oldest first.
 * @public The coverage alert lists them through this.
 */
export function notCoveredGroups(notCovered: readonly NotCoveredRepository[]): { reason: string; repositories: NotCoveredRepository[] }[] {
  const reasonOf = ({ reason, missing }: NotCoveredRepository) => {
    if (reason === "no_profile") return "No Profile yet";
    if (reason === "facts_unknown" || !missing) return "A Profile that doesn't describe design systems";
    const version = missing.version ? `${missing.name} ${missing.version}` : missing.name;
    return missing.built ? `Waiting to be surveyed against the ${missing.name} ${missing.built} entry` : `No ${PRODUCT.referenceCatalog} entry for ${version} yet`;
  };
  const order = (repository: NotCoveredRepository) => [["no_profile", "facts_unknown", "no_entry"].indexOf(repository.reason), repository.missing?.version ?? ""] as const;
  const sorted = [...notCovered].sort((a, b) => order(a)[0] - order(b)[0] || compareVersions(order(a)[1], order(b)[1]));
  return [...Map.groupBy(sorted, reasonOf)].map(([reason, repositories]) => ({ reason, repositories }));
}

/** Versions in semantic-version order, anything else after them. */
function compareVersions(a: string, b: string): number {
  const [left, right] = [semver.valid(a), semver.valid(b)];
  return left && right ? semver.compare(left, right) : left ? -1 : right ? 1 : a.localeCompare(b);
}
