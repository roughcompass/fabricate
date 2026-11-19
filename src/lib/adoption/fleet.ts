import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type DesignSystemFigures, type RecognizedDesignSystem, designSystemProfiles, designSystemUsage, repositories, repositoryProfiles, surveys } from "@/lib/db/schema";

/*
 * The fleet Adoption Analytics counts (establish-frontend-registry, design
 * decision 7; the adoption-analytics requirement "Adoption reads each
 * repository's current Profile"): every registered Repository, with its
 * current Profile's design-system row from the projection. A Repository with
 * no current Profile, or whose design-system facts are unknown, is not
 * covered: it's listed, and never counted as not using what's measured.
 * Nothing here reads a Profile document.
 */

export interface FleetRepository {
  readonly id: number;
  readonly publicId: string;
  readonly name: string;
}

/** Why a registered Repository isn't counted: it has no Profile yet, or its design-system facts are unknown or weren't surveyed. */
export type NotCoveredReason = "no_profile" | "facts_unknown";

export interface CoveredRepository extends FleetRepository {
  readonly profileId: number;
  /** The design systems its current Profile recognizes, with their summary figures. */
  readonly recognized: readonly RecognizedDesignSystem[];
}

export interface Coverage {
  /** Registered Repositories. */
  readonly registered: number;
  readonly covered: readonly CoveredRepository[];
  readonly notCovered: readonly (FleetRepository & { readonly reason: NotCoveredReason })[];
}

/** A category state that says nothing about the repository. */
const UNKNOWN = new Set([null, "unknown"]);

/** Every registered Repository, as covered by its current Profile's design-system facts or not. One query. */
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
  const notCovered: Coverage["notCovered"][number][] = [];
  for (const row of rows) {
    const repository = { id: row.id, publicId: row.publicId, name: row.name };
    if (row.profileId === null) notCovered.push({ ...repository, reason: "no_profile" });
    else if (!row.summary || UNKNOWN.has(row.summary.designSystemsState) || UNKNOWN.has(row.summary.uiElementsState)) notCovered.push({ ...repository, reason: "facts_unknown" });
    else covered.push({ ...repository, profileId: row.profileId, recognized: row.summary.recognized });
  }
  return { registered: rows.length, covered, notCovered };
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
