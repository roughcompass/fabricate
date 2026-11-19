import { and, asc, desc, eq, lt } from "drizzle-orm";
import { catalogConfiguration } from "@/lib/catalog/configuration";
import type { FrontendRegistryConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { type AdoptionSubject, adoptionSnapshots } from "@/lib/db/schema";
import { type Job, enqueue } from "@/lib/jobs/queue";
import { designSystemCoverage } from "./fleet";
import { designSystemAdoption, packageAdoption, tokenUse } from "./queries";
import { trackedDesignSystem } from "./tracked";

/*
 * Adoption snapshots (establish-frontend-registry, design decision 7; the
 * adoption-analytics requirement "Adoption is snapshotted and compared over
 * time"). The `adoption.snapshot` job runs once per `adoption.snapshotDays`
 * (weekly by default), and once when the worker starts if this period has
 * none. It records each design system the Reference Catalog describes, once
 * it has an entry, and each of its packages: their figures, and per
 * component or per version counts. Each figure's change is computed against
 * the previous snapshot of the same subject; the first shows none.
 */

export const TAKE_SNAPSHOTS = "adoption.snapshot";

export type AdoptionSnapshot = typeof adoptionSnapshots.$inferSelect;

const DAY_MS = 86_400_000;

function slotOf(config: FrontendRegistryConfig, time: Date, offset = 0): Date {
  const length = config.adoption.snapshotDays * DAY_MS;
  return new Date((Math.floor(time.getTime() / length) + offset) * length);
}

function enqueueSlot(db: Executor, slot: Date, runAfter: Date): Job {
  return enqueue(db, { kind: TAKE_SNAPSHOTS, payload: { slot: slot.toISOString() }, idempotencyKey: `${TAKE_SNAPSHOTS}:${slot.toISOString()}`, runAfter, maxAttempts: 1 });
}

/** Queues this period's snapshot to run now, unless it already ran, and the next period's. Called when a worker starts. */
export function scheduleAdoptionSnapshots(db: Executor, config: FrontendRegistryConfig, now = new Date()): Job[] {
  const next = slotOf(config, now, 1);
  return [enqueueSlot(db, slotOf(config, now), now), enqueueSlot(db, next, next)];
}

/** Takes a snapshot of every tracked design system and package for +slot+, once each. Returns the snapshots it took. */
export function takeSnapshots(db: Executor, config: FrontendRegistryConfig, slot: string, now = new Date()): AdoptionSnapshot[] {
  const coverage = designSystemCoverage(db);
  const values: (typeof adoptionSnapshots.$inferInsert)[] = [];
  for (const thing of catalogConfiguration(config).things) {
    const tracked = thing.kind === "design_system" ? trackedDesignSystem(db, config, thing.id) : undefined;
    if (tracked) {
      const adoption = designSystemAdoption(db, coverage, tracked, { rarelyUsedPercentile: config.adoption.rarelyUsedPercentile });
      const tokens = tokenUse(coverage, thing.id);
      values.push({
        kind: "design_system",
        subject: thing.id,
        slot,
        takenAt: now,
        figures: {
          registered: coverage.registered,
          covered: coverage.covered.length,
          repositories: adoption.repositories.length,
          components_tracked: adoption.componentsTracked,
          components_used: adoption.componentsUsed,
          components_rarely_used: adoption.rarelyUsed.length,
          components_unused: adoption.unused.length,
          usages: adoption.usages.app,
          usages_in_stories: adoption.usages.stories,
          usages_in_tests: adoption.usages.tests,
          tokenized_declarations: tokens.count,
          token_capable_declarations: tokens.of,
        },
        counts: Object.fromEntries(adoption.components.filter((component) => component.usages.app > 0).map((component) => [component.name, component.usages.app])),
        entryDigest: tracked.entry.digest,
        createdAt: now,
      });
    }
    for (const name of [...new Set([thing.package, thing.tokens, thing.icons].filter((item): item is string => item !== undefined))]) {
      const adoption = packageAdoption(db, name);
      values.push({
        kind: "package",
        subject: name,
        slot,
        takenAt: now,
        figures: { profiled: adoption.profiled, repositories: adoption.repositories.length, resolved: adoption.repositories.length - adoption.unresolved.length, unresolved: adoption.unresolved.length },
        counts: Object.fromEntries(adoption.versions.map((version) => [version.version, version.repositories])),
        entryDigest: null,
        createdAt: now,
      });
    }
  }
  if (values.length === 0) return [];
  return immediate(db, (tx) => tx.insert(adoptionSnapshots).values(values).onConflictDoNothing().returning().all());
}

/** The job handler: queues the next period's snapshot, then takes this one's. */
export function runSnapshots(db: Executor, config: FrontendRegistryConfig, options: { slot?: string; now?: Date; log?: (message: string) => void } = {}): AdoptionSnapshot[] {
  const now = options.now ?? new Date();
  const next = slotOf(config, now, 1);
  enqueueSlot(db, next, next);
  const taken = takeSnapshots(db, config, options.slot ?? slotOf(config, now).toISOString(), now);
  options.log?.(`adoption snapshot: ${taken.length} subjects recorded`);
  return taken;
}

/** Each figure of +later+ less the same figure of +earlier+, or null for a figure +earlier+ doesn't have. */
export type FigureChanges = Readonly<Record<string, number | null>>;

function changesBetween(earlier: Readonly<Record<string, number>> | null, later: Readonly<Record<string, number>>): FigureChanges {
  return Object.fromEntries(Object.entries(later).map(([name, value]) => [name, earlier && name in earlier ? value - earlier[name]! : null]));
}

export interface SnapshotComparison {
  readonly earlier: AdoptionSnapshot | null;
  readonly later: AdoptionSnapshot;
  /** Each figure's change since the earlier snapshot; null when there's no earlier one, so nothing to compare. */
  readonly figures: FigureChanges;
  /** Each component's or version's change. */
  readonly counts: FigureChanges;
}

function compare(earlier: AdoptionSnapshot | null, later: AdoptionSnapshot): SnapshotComparison {
  const counts = earlier ? Object.fromEntries([...new Set([...Object.keys(earlier.counts), ...Object.keys(later.counts)])].map((name) => [name, (later.counts[name] ?? 0) - (earlier.counts[name] ?? 0)])) : changesBetween(null, later.counts);
  return { earlier, later, figures: changesBetween(earlier?.figures ?? null, later.figures), counts };
}

/**
 * The newest snapshot of a subject, with each figure's change since the one before.
 * @public Adoption pages show each figure with its change through this.
 */
export function latestSnapshot(db: Executor, kind: AdoptionSubject, subject: string): SnapshotComparison | undefined {
  const [later, earlier] = db.select().from(adoptionSnapshots).where(and(eq(adoptionSnapshots.kind, kind), eq(adoptionSnapshots.subject, subject))).orderBy(desc(adoptionSnapshots.takenAt), desc(adoptionSnapshots.id)).limit(2).all();
  return later ? compare(earlier ?? null, later) : undefined;
}

/**
 * Two snapshots of one subject compared, by id: the later's figures and counts less the earlier's.
 * @public Adoption pages compare any two snapshots through this.
 */
export function compareSnapshots(db: Executor, firstId: number, secondId: number): SnapshotComparison {
  const [first, second] = [firstId, secondId].map((id) => {
    const snapshot = db.select().from(adoptionSnapshots).where(eq(adoptionSnapshots.id, id)).get();
    if (!snapshot) throw new NotFoundError(`Adoption snapshot ${id} does not exist`);
    return snapshot;
  }) as [AdoptionSnapshot, AdoptionSnapshot];
  if (first.kind !== second.kind || first.subject !== second.subject) throw new NotFoundError(`Adoption snapshots ${firstId} and ${secondId} aren't of one subject`);
  const [earlier, later] = first.takenAt <= second.takenAt ? [first, second] : [second, first];
  return compare(earlier, later);
}

/**
 * Every snapshot of a subject taken before +before+, or all of them, oldest first.
 * @public Adoption pages list the snapshots to compare through this.
 */
export function snapshotsOf(db: Executor, kind: AdoptionSubject, subject: string, before?: Date): AdoptionSnapshot[] {
  return db
    .select()
    .from(adoptionSnapshots)
    .where(and(eq(adoptionSnapshots.kind, kind), eq(adoptionSnapshots.subject, subject), before ? lt(adoptionSnapshots.takenAt, before) : undefined))
    .orderBy(asc(adoptionSnapshots.takenAt), asc(adoptionSnapshots.id))
    .all();
}
