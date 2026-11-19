import { and, eq, isNull } from "drizzle-orm";
import semver from "semver";
import type { Executor } from "@/lib/db/client";
import { dependencyFacts, repositories, repositoryProfiles, surveys } from "@/lib/db/schema";
import { type Coverage, type CoveredRepository, type FleetRepository, recognizing, totalFigures, usageOf } from "./fleet";
import type { TrackedDesignSystem } from "./tracked";

/*
 * Adoption Analytics' figures (establish-frontend-registry, design decision
 * 7; the adoption-analytics spec): fleet-wide adoption of a design system's
 * components, of the raw HTML its components replace, and of its tokens, and
 * of any package's versions, from each registered Repository's current
 * Profile through the projection. Counts lead with the app scope and set
 * stories and tests apart, and every share comes with the counts it divides.
 */

/** A part of a whole, with both counts. */
export interface Share {
  readonly count: number;
  readonly of: number;
}

export interface ScopeCounts {
  readonly app: number;
  readonly stories: number;
  readonly tests: number;
}

export interface ComponentUse {
  readonly name: string;
  readonly package: string | null;
  /** Whether the tracked entry lists it; a component only an older entry lists is counted but not tracked. */
  readonly tracked: boolean;
  /** Usages, per scope. */
  readonly usages: ScopeCounts;
  /** Repositories that use it in the app. */
  readonly repositories: number;
  /** App usages styled beyond what it offers. */
  readonly customized: Share;
}

export interface DesignSystemAdoption {
  readonly coverage: Coverage;
  /** Covered Repositories whose current Profile recognizes the design system. */
  readonly repositories: readonly CoveredRepository[];
  readonly componentsTracked: number;
  /** Tracked components used in the app by any covered Repository. */
  readonly componentsUsed: number;
  /** Usages of its components, per scope. */
  readonly usages: ScopeCounts;
  /** Every component tracked or used, most used in the app first. */
  readonly components: readonly ComponentUse[];
  /** The ten most used in the app. */
  readonly mostUsed: readonly ComponentUse[];
  /** Used components in the bottom percentile by app usages, fewest first, each with at least one. */
  readonly rarelyUsed: readonly ComponentUse[];
  /** Tracked components no covered Repository uses in the app, with their use in stories and tests. */
  readonly unused: readonly ComponentUse[];
}

const ZERO: ScopeCounts = { app: 0, stories: 0, tests: 0 };
const add = (a: ScopeCounts, b: ScopeCounts): ScopeCounts => ({ app: a.app + b.app, stories: a.stories + b.stories, tests: a.tests + b.tests });

/**
 * A design system's component adoption across the covered fleet.
 * "Rarely used" is the bottom +rarelyUsedPercentile+ of used components by
 * app usages: those with at most the count at that percentile, by nearest rank.
 */
export function designSystemAdoption(db: Executor, coverage: Coverage, tracked: TrackedDesignSystem, options: { rarelyUsedPercentile: number; mostUsed?: number }): DesignSystemAdoption {
  const byName = new Map<string, { package: string | null; tracked: boolean; usages: ScopeCounts; repositories: Set<number>; customized: number }>();
  for (const component of tracked.components) byName.set(component.name, { package: component.package, tracked: true, usages: ZERO, repositories: new Set(), customized: 0 });
  for (const { repository, row } of usageOf(db, coverage, tracked.id, "component")) {
    const entry = byName.get(row.name) ?? { package: row.counterpart, tracked: false, usages: ZERO, repositories: new Set<number>(), customized: 0 };
    entry.usages = add(entry.usages, { app: row.appSites, stories: row.storiesSites, tests: row.testsSites });
    entry.customized += row.appCustomized;
    if (row.appSites > 0) entry.repositories.add(repository.id);
    byName.set(row.name, entry);
  }
  const components = [...byName]
    .map(([name, entry]): ComponentUse => ({ name, package: entry.package, tracked: entry.tracked, usages: entry.usages, repositories: entry.repositories.size, customized: { count: entry.customized, of: entry.usages.app } }))
    .sort((a, b) => b.usages.app - a.usages.app || b.usages.stories + b.usages.tests - (a.usages.stories + a.usages.tests) || a.name.localeCompare(b.name));
  const used = components.filter((component) => component.usages.app > 0);
  const ascending = used.toReversed();
  const threshold = ascending.length ? ascending[Math.max(0, Math.ceil((options.rarelyUsedPercentile / 100) * ascending.length) - 1)]!.usages.app : 0;
  return {
    coverage,
    repositories: recognizing(coverage, tracked.id).map(({ repository }) => repository),
    componentsTracked: tracked.components.length,
    componentsUsed: used.filter((component) => component.tracked).length,
    usages: components.reduce((sum, component) => add(sum, component.usages), ZERO),
    components,
    mostUsed: used.slice(0, options.mostUsed ?? 10),
    rarelyUsed: ascending.filter((component) => component.usages.app <= threshold),
    unused: components.filter((component) => component.tracked && component.usages.app === 0).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export interface PropUse {
  readonly name: string;
  /** App usages that pass it. */
  readonly usages: number;
  /** For a prop whose entry lists a finite set of values, the app usages passing each value. */
  readonly values: Readonly<Record<string, number>>;
}

export interface ComponentAdoption {
  readonly coverage: Coverage;
  readonly name: string;
  readonly package: string | null;
  /** Each covered Repository that uses it in any scope, with its usages per scope, most app usages first. */
  readonly repositories: readonly { readonly repository: CoveredRepository; readonly usages: ScopeCounts; readonly customized: number }[];
  readonly usages: ScopeCounts;
  /** Props passed in the app, most passed first. */
  readonly props: readonly PropUse[];
  /** App usages whose props can't be read, such as those spreading props. */
  readonly unknownProps: number;
  /** Props the entry lists that no usage, in any scope, passes. */
  readonly unusedProps: readonly string[];
  /** App usages styled beyond what the component offers. */
  readonly customized: Share;
  /** Repositories with stories that use it. */
  readonly stories: readonly CoveredRepository[];
}

/**
 * Where and how one component of a design system is used across the covered fleet.
 * @public A component's adoption page shows this.
 */
export function componentAdoption(db: Executor, coverage: Coverage, tracked: TrackedDesignSystem, name: string): ComponentAdoption {
  const entry = tracked.components.find((component) => component.name === name);
  const rows = usageOf(db, coverage, tracked.id, "component", name);
  const props = new Map<string, { usages: number; values: Record<string, number> }>();
  const passed = new Set<string>();
  let unknownProps = 0;
  for (const { row } of rows) {
    unknownProps += row.props?.app.unknown ?? 0;
    for (const scope of ["app", "stories", "tests"] as const) for (const prop of Object.keys(row.props?.[scope].names ?? {})) passed.add(prop);
    for (const [prop, use] of Object.entries(row.props?.app.names ?? {})) {
      const total = props.get(prop) ?? { usages: 0, values: {} };
      total.usages += use.count;
      for (const [value, times] of Object.entries(use.values ?? {})) total.values[value] = (total.values[value] ?? 0) + times;
      props.set(prop, total);
    }
  }
  const usages = rows.reduce((sum, { row }) => add(sum, { app: row.appSites, stories: row.storiesSites, tests: row.testsSites }), ZERO);
  const customized = rows.reduce((sum, { row }) => sum + row.appCustomized, 0);
  return {
    coverage,
    name,
    package: entry?.package ?? rows[0]?.row.counterpart ?? null,
    repositories: rows
      .map(({ repository, row }) => ({ repository, usages: { app: row.appSites, stories: row.storiesSites, tests: row.testsSites }, customized: row.appCustomized }))
      .filter((item) => item.usages.app + item.usages.stories + item.usages.tests > 0)
      .sort((a, b) => b.usages.app - a.usages.app || a.repository.name.localeCompare(b.repository.name)),
    usages,
    props: [...props].map(([prop, use]) => ({ name: prop, usages: use.usages, values: use.values })).sort((a, b) => b.usages - a.usages || a.name.localeCompare(b.name)),
    unknownProps,
    unusedProps: (entry?.props ?? []).map((prop) => prop.name).filter((prop) => !passed.has(prop)).sort(),
    customized: { count: customized, of: usages.app },
    stories: rows.filter(({ row }) => row.storiesSites > 0).map(({ repository }) => repository),
  };
}

export interface ReplaceableElement {
  /** The raw element's tag, such as button. */
  readonly tag: string;
  /** The design-system component that replaces it. */
  readonly replacement: string;
  /** Usages in the app. */
  readonly usages: number;
  /** Repositories that write it in the app. */
  readonly repositories: readonly FleetRepository[];
}

/**
 * The raw HTML elements a design system's components replace, as the covered fleet writes them in the app, most written first.
 * @public A design system's adoption page shows this.
 */
export function replaceableHtml(db: Executor, coverage: Coverage, designSystem: string): ReplaceableElement[] {
  const byTag = new Map<string, { replacement: string; usages: number; repositories: Map<number, FleetRepository> }>();
  for (const { repository, row } of usageOf(db, coverage, designSystem, "element")) {
    if (row.appSites === 0) continue;
    const entry = byTag.get(row.name) ?? { replacement: row.counterpart ?? "", usages: 0, repositories: new Map() };
    entry.usages += row.appSites;
    entry.repositories.set(repository.id, { id: repository.id, publicId: repository.publicId, name: repository.name });
    byTag.set(row.name, entry);
  }
  return [...byTag]
    .map(([tag, entry]) => ({ tag, replacement: entry.replacement, usages: entry.usages, repositories: [...entry.repositories.values()].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.usages - a.usages || a.tag.localeCompare(b.tag));
}

/** The share of token-capable style declarations, in the app, that use a design system's tokens, across the Repositories that recognize it. */
export function tokenUse(coverage: Coverage, designSystem: string): Share {
  const app = totalFigures(recognizing(coverage, designSystem).map(({ system }) => system.app));
  return { count: app.tokenized, of: app.tokenCapable };
}

export interface PackageVersion {
  readonly version: string;
  /** Repositories whose lockfile resolves it. */
  readonly repositories: number;
  /** Whether it's the newest version any Repository resolves. */
  readonly newest: boolean;
}

export interface PackageAdoption {
  readonly name: string;
  /** Registered Repositories with a current Profile. */
  readonly profiled: number;
  /** Each Repository that declares or resolves it, with its declared ranges and resolved versions. */
  readonly repositories: readonly { readonly repository: FleetRepository; readonly ranges: readonly string[]; readonly resolved: readonly string[] }[];
  /** Resolved versions, newest first, with how many Repositories are on each. */
  readonly versions: readonly PackageVersion[];
  /** Repositories that declare it without a lockfile resolving it. */
  readonly unresolved: readonly FleetRepository[];
}

/** A package's declared ranges and resolved versions across the registered Repositories' current Profiles. */
export function packageAdoption(db: Executor, name: string): PackageAdoption {
  const profiled = db
    .select({ id: repositories.id })
    .from(repositories)
    .innerJoin(surveys, eq(surveys.id, repositories.currentSurveyId))
    .where(isNull(repositories.deletedAt))
    .all().length;
  const rows = db
    .select({ id: repositories.id, publicId: repositories.publicId, repositoryName: repositories.name, specifier: dependencyFacts.specifier, resolved: dependencyFacts.resolvedVersion })
    .from(repositories)
    .innerJoin(surveys, eq(surveys.id, repositories.currentSurveyId))
    .innerJoin(repositoryProfiles, eq(repositoryProfiles.surveyId, surveys.id))
    .innerJoin(dependencyFacts, eq(dependencyFacts.profileId, repositoryProfiles.id))
    .where(and(isNull(repositories.deletedAt), eq(dependencyFacts.kind, "dependency"), eq(dependencyFacts.packageName, name)))
    .all();
  const byRepository = new Map<number, { repository: FleetRepository; ranges: Set<string>; resolved: Set<string> }>();
  for (const row of rows) {
    const entry = byRepository.get(row.id) ?? { repository: { id: row.id, publicId: row.publicId, name: row.repositoryName }, ranges: new Set<string>(), resolved: new Set<string>() };
    if (row.specifier) entry.ranges.add(row.specifier);
    if (row.resolved) entry.resolved.add(row.resolved);
    byRepository.set(row.id, entry);
  }
  const listed = [...byRepository.values()].sort((a, b) => a.repository.name.localeCompare(b.repository.name));
  const counts = new Map<string, number>();
  for (const entry of listed) for (const version of entry.resolved) counts.set(version, (counts.get(version) ?? 0) + 1);
  const ordered = [...counts.keys()].sort((a, b) => (semver.valid(a) && semver.valid(b) ? semver.rcompare(a, b) : b.localeCompare(a)));
  return {
    name,
    profiled,
    repositories: listed.map((entry) => ({ repository: entry.repository, ranges: [...entry.ranges].sort(), resolved: [...entry.resolved].sort() })),
    versions: ordered.map((version, index) => ({ version, repositories: counts.get(version)!, newest: index === 0 })),
    unresolved: listed.filter((entry) => entry.resolved.size === 0).map((entry) => entry.repository),
  };
}
