import { CatalogBuildError, fetchPackument, newestVersion } from "@repo-facts/catalog-builder";
import { and, eq, isNull } from "drizzle-orm";
import semver from "semver";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { dependencyFacts, repositories, repositoryProfiles, surveys } from "@/lib/db/schema";
import { type Job, enqueue } from "@/lib/jobs/queue";
import { type BuildReason, queueBuild } from "./build";
import { type CatalogConfiguration, type DescribedThing, catalogConfiguration } from "./configuration";
import { type CurrentCatalog, entriesByVersion, rulesVersionOf } from "./current";
import type { CatalogRecipe } from "@/lib/db/schema";
import { storedEntries } from "./entries";

/*
 * The Catalog check (establish-frontend-registry, design decision 5; the
 * reference-catalog requirement "Entries are built for every version in
 * use"). Once a day, and after each profiling check, it queues a
 * `catalog.build` for each version of a described thing that has no entry:
 * - every version a Repository's current Profile resolves, or declares
 *   exactly, from the projection's dependency facts;
 * - for a declared range, the highest published version it allows;
 * - the thing's newest published version.
 * A survey that wanted a version with no entry queues a check at once.
 * It also rebuilds each version whose entries all predate the team's rules
 * as they stand. Versions in use are queued before the registry is read, so
 * an unreachable registry delays only the versions that need it; the check
 * then fails with the registry's error.
 */

export const CHECK_CATALOG = "catalog.check";

const DAY_MS = 86_400_000;

/** The start of the UTC day +offset+ days from +time+'s. */
function dayOf(time: Date, offset = 0): Date {
  return new Date((Math.floor(time.getTime() / DAY_MS) + offset) * DAY_MS);
}

function enqueueDay(db: Executor, day: Date, runAfter: Date): Job {
  return enqueue(db, { kind: CHECK_CATALOG, payload: { slot: day.toISOString() }, idempotencyKey: `${CHECK_CATALOG}:${day.toISOString()}`, runAfter, maxAttempts: 1 });
}

/** Queues today's check to run now, unless it already ran, and tomorrow's. Called when a worker starts, before the profiling check, so entries are built before surveys need them. */
export function scheduleCatalogChecks(db: Executor, now = new Date()): Job[] {
  const tomorrow = dayOf(now, 1);
  return [enqueueDay(db, dayOf(now), now), enqueueDay(db, tomorrow, tomorrow)];
}

/** Queues a check right after the profiling check of +profilingSlot+. */
export function queueCatalogCheckAfter(db: Executor, profilingSlot: string, now = new Date()): Job {
  return enqueue(db, { kind: CHECK_CATALOG, payload: { after: profilingSlot }, idempotencyKey: `${CHECK_CATALOG}:after:${profilingSlot}`, runAfter: now, maxAttempts: 1 });
}

/**
 * Queues a check right away for each version +recipe+'s survey wanted that
 * no entry in +catalog+, the entries it was given, was built for: a version
 * no entry is at or before, or one between entries, compared against the
 * nearest earlier. The check builds it within minutes, rather than after the
 * next profiling check, and the Repository is surveyed again once it's
 * stored. One check is queued per thing, wanted version, and day, and builds
 * once per thing, version, rules, and day, so a registry that can't be read,
 * or a version it doesn't have, is tried again the next day, never in a loop.
 */
export function queueChecksForMissingEntries(db: Executor, recipe: CatalogRecipe, catalog: CurrentCatalog, now = new Date()): Job[] {
  const day = now.toISOString().slice(0, 10);
  return recipe.entries.flatMap((entry) => {
    const version = entry.wanted.version === null ? null : semver.valid(entry.wanted.version);
    if (!version) return [];
    const exact = catalog.entries.some((candidate) => candidate.kind === entry.kind && candidate.id === entry.id && candidate.packages.some((item) => item.name === entry.wanted.package && semver.valid(item.version) === version));
    if (exact) return [];
    const missing = `${entry.kind}:${entry.id}:${entry.wanted.package}@${version}`;
    return [enqueue(db, { kind: CHECK_CATALOG, payload: { missing }, idempotencyKey: `${CHECK_CATALOG}:missing:${missing}:${day}`, runAfter: now, maxAttempts: 1 })];
  });
}

/** What the current Profiles of registered Repositories say about one package: the exact versions in use, and the ranges declared without a resolved version. */
export interface PackageUse {
  readonly versions: ReadonlySet<string>;
  readonly ranges: ReadonlySet<string>;
}

/** The versions of +packageName+ registered Repositories' current Profiles resolve or declare. */
export function packageUse(db: Executor, packageName: string): PackageUse {
  const rows = db
    .select({ specifier: dependencyFacts.specifier, resolved: dependencyFacts.resolvedVersion })
    .from(repositories)
    .innerJoin(surveys, eq(surveys.id, repositories.currentSurveyId))
    .innerJoin(repositoryProfiles, eq(repositoryProfiles.surveyId, surveys.id))
    .innerJoin(dependencyFacts, eq(dependencyFacts.profileId, repositoryProfiles.id))
    .where(and(isNull(repositories.deletedAt), eq(dependencyFacts.kind, "dependency"), eq(dependencyFacts.packageName, packageName)))
    .all();
  const versions = new Set<string>();
  const ranges = new Set<string>();
  for (const row of rows) {
    const resolved = row.resolved === null ? null : semver.valid(row.resolved);
    const exact = row.specifier === null ? null : semver.valid(row.specifier);
    if (resolved) versions.add(resolved);
    else if (exact) versions.add(exact);
    else if (row.specifier !== null && semver.validRange(row.specifier) !== null) ranges.add(row.specifier);
  }
  return { versions, ranges };
}

export interface QueuedBuild {
  readonly thing: string;
  readonly version: string;
  readonly reason: BuildReason;
}

export interface CatalogCheckResult {
  readonly queued: readonly QueuedBuild[];
  /** Why the registry couldn't be read, for each thing it couldn't be read for. */
  readonly unreachable: readonly string[];
}

export interface CatalogCheckOptions {
  catalog?: CatalogConfiguration;
  /** The fetch the registry is read with; the global one by default. */
  fetch?: typeof fetch;
  now?: Date;
}

/** Checks every described thing and queues the builds it needs. */
export async function checkCatalog(db: Executor, config: FrontendRegistryConfig, options: CatalogCheckOptions = {}): Promise<CatalogCheckResult> {
  const catalog = options.catalog ?? catalogConfiguration(config);
  const now = options.now ?? new Date();
  const stored = storedEntries(db);
  const queued: QueuedBuild[] = [];
  const pending: { thing: DescribedThing; built: Set<string>; ranges: ReadonlySet<string> }[] = [];

  // Without the registry: versions in use, and versions built before the rules changed.
  for (const thing of catalog.things) {
    const byVersion = entriesByVersion(stored, thing);
    const built = new Set(byVersion.keys());
    const queue = (version: string, reason: BuildReason) => {
      queueBuild(db, thing, version, reason, now);
      built.add(version);
      queued.push({ thing: thing.key, version, reason });
    };
    const use = packageUse(db, thing.package);
    for (const version of [...use.versions].sort(semver.compare)) if (!built.has(version)) queue(version, "in_use");
    for (const [version, entries] of byVersion) if (!entries.some((entry) => rulesVersionOf(entry) === thing.rules.version)) queue(version, "rules");
    pending.push({ thing, built, ranges: use.ranges });
  }

  // From the registry: the newest published version, and the highest each declared range allows.
  const unreachable: string[] = [];
  for (const { thing, built, ranges } of pending) {
    let published: string[];
    let newest: string;
    try {
      const packument = await fetchPackument(thing.package, { registry: config.catalog.registry, ...(options.fetch && { fetch: options.fetch }) });
      published = [...packument.versions.keys()];
      newest = packument.distTags.latest && packument.versions.has(packument.distTags.latest) ? packument.distTags.latest : newestVersion(packument);
    } catch (error) {
      if (!(error instanceof CatalogBuildError)) throw error;
      unreachable.push(`${thing.id}: ${error.reason}: ${error.message}`);
      continue;
    }
    const wanted: [string, BuildReason][] = [...[...ranges].flatMap((range): [string, BuildReason][] => {
      const version = semver.maxSatisfying(published, range);
      return version ? [[version, "in_use"]] : [];
    }), [newest, "published"]];
    for (const [version, reason] of wanted) {
      if (built.has(version)) continue;
      queueBuild(db, thing, version, reason, now);
      built.add(version);
      queued.push({ thing: thing.key, version, reason });
    }
  }
  return { queued, unreachable };
}

/** The job handler: queues tomorrow's check when this is a daily one, then checks. Fails, after queueing what it could, when the registry couldn't be read. */
export async function runCatalogCheck(db: Executor, config: FrontendRegistryConfig, payload: { slot?: string; after?: string }, options: CatalogCheckOptions & { log?: (message: string) => void } = {}): Promise<CatalogCheckResult> {
  const now = options.now ?? new Date();
  if (payload.slot) {
    const tomorrow = dayOf(new Date(payload.slot), 1);
    enqueueDay(db, tomorrow, tomorrow);
  }
  const result = await checkCatalog(db, config, { ...options, now });
  options.log?.(`catalog check: ${result.queued.length} builds queued${result.queued.length ? ` (${result.queued.map((build) => `${build.thing} ${build.version}`).join(", ")})` : ""}`);
  if (result.unreachable.length) throw new Error(`The registry couldn't be read for ${result.unreachable.join("; ")}`);
  return result;
}
