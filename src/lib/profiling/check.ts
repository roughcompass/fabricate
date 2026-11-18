import { DETECTOR_RELEASE } from "@repo-facts/bundle";
import { remoteHead } from "@/lib/acquisition/remote-head";
import { type RepositorySource, listSources } from "@/lib/catalog/source-records";
import type { FabricateConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import type { ProfileTrigger } from "@/lib/db/schema";
import { CURRENT_VERSION } from "@/lib/documents/schemas";
import { type Job, enqueue } from "@/lib/jobs/queue";
import { type CheckState, ACTIVE_STATES, latestVersions, queueProfile } from "./versions";

/*
 * The scheduled profiling check (docs/profiling.md). Time is cut into slots
 * of the configured length, and each slot's job has an idempotency key, so
 * any number of workers and restarts queue one check per slot. Each check
 * queues the next slot's before it starts, so a failed check never ends the
 * schedule.
 *
 * For every enabled repository with no version queued or running, it queues
 * a version when the repository has none yet, when the detector release or
 * the profile schema changed since its newest version, or when its reference
 * names a different commit than that version profiled. Only the last needs
 * the network: one ls-remote per repository, a few at a time.
 */

export const CHECK_PROFILES = "profiling.check";

/** How many repositories' references are read at once. */
const PARALLEL_READS = 4;

function slotOf(config: FabricateConfig, time: Date, offset = 0): Date {
  const length = config.profiling.checkMinutes * 60_000;
  return new Date((Math.floor(time.getTime() / length) + offset) * length);
}

function enqueueSlot(db: Executor, slot: Date, runAfter: Date): Job {
  return enqueue(db, { kind: CHECK_PROFILES, payload: { slot: slot.toISOString() }, idempotencyKey: `${CHECK_PROFILES}:${slot.toISOString()}`, runAfter, maxAttempts: 1 });
}

/** Queues this slot's check to run now, unless it already ran, and the next slot's. Called when a worker starts. */
export function scheduleProfileChecks(db: Executor, config: FabricateConfig, now = new Date()): Job[] {
  const next = slotOf(config, now, 1);
  return [enqueueSlot(db, slotOf(config, now), now), enqueueSlot(db, next, next)];
}

/** What the detector writes now, which a version's Run recorded when it was launched. */
export const CURRENT_DETECTOR = { detectorRelease: DETECTOR_RELEASE, profileSchemaVersion: CURRENT_VERSION.repositoryProfile } as const;

export type CheckDecision = { readonly queue: ProfileTrigger; readonly headCommit?: string } | { readonly skip: "active" } | { readonly needsHead: true };

/**
 * What the check does for a repository whose newest version is +latest+,
 * before reading its reference: queue a first version, queue one for a new
 * detector, skip one in progress, or read the reference to compare commits.
 */
export function decideWithoutHead(latest: CheckState | undefined, detector: typeof CURRENT_DETECTOR = CURRENT_DETECTOR): CheckDecision {
  if (!latest) return { queue: "initial" };
  if ((ACTIVE_STATES as readonly string[]).includes(latest.state)) return { skip: "active" };
  if (latest.detectorRelease !== detector.detectorRelease || latest.profileSchemaVersion !== detector.profileSchemaVersion) return { queue: "detector" };
  return { needsHead: true };
}

/**
 * Whether the reference's commit +head+ calls for a new version: it differs
 * from the commit the newest version profiled. A version that failed before
 * its commit was known is retried once, recording +head+, so a repository
 * that keeps failing on the same commit isn't queued again every check.
 */
export function decideWithHead(latest: CheckState, head: string): CheckDecision | null {
  return latest.knownCommit === head ? null : { queue: "commit", headCommit: head };
}

export interface CheckResult {
  readonly checked: number;
  readonly queued: Partial<Record<ProfileTrigger, number>>;
  /** Repositories whose reference couldn't be read, by public ID, with why. */
  readonly unreachable: readonly { readonly source: string; readonly message: string }[];
}

export interface CheckOptions {
  readonly signal?: AbortSignal;
  /** Reads a repository's reference; ls-remote unless a test supplies another. */
  readonly head?: (source: RepositorySource, signal?: AbortSignal) => Promise<string>;
}

/** Checks every enabled repository once, queueing the versions that are due. */
export async function checkProfiles(db: Executor, config: FabricateConfig, options: CheckOptions = {}): Promise<CheckResult> {
  const head = options.head ?? ((source, signal) => remoteHead(source, { config, signal }));
  const sources = listSources(db, { enabled: true });
  const latest = latestVersions(db);
  const queued: Partial<Record<ProfileTrigger, number>> = {};
  const unreachable: { source: string; message: string }[] = [];
  const queue = (source: RepositorySource, trigger: ProfileTrigger, headCommit?: string) => {
    if (queueProfile(db, source, trigger, { headCommit, config }).status === "queued") queued[trigger] = (queued[trigger] ?? 0) + 1;
  };

  const pending: { source: RepositorySource; state: CheckState }[] = [];
  for (const source of sources) {
    const state = latest.get(source.id);
    const decision = decideWithoutHead(state);
    if ("queue" in decision) queue(source, decision.queue);
    else if ("needsHead" in decision) pending.push({ source, state: state! });
  }

  let next = 0;
  const reader = async () => {
    while (next < pending.length) {
      options.signal?.throwIfAborted();
      const { source, state } = pending[next++]!;
      try {
        const decision = decideWithHead(state, await head(source, options.signal));
        if (decision && "queue" in decision) queue(source, decision.queue, decision.headCommit);
      } catch (error) {
        unreachable.push({ source: source.publicId, message: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_READS, pending.length) }, reader));
  return { checked: sources.length, queued, unreachable };
}

/** The job handler: queues the next slot, then checks. */
export async function runScheduledProfileCheck(db: Executor, config: FabricateConfig, options: { signal?: AbortSignal; now?: Date; log?: (message: string) => void } = {}): Promise<CheckResult> {
  const next = slotOf(config, options.now ?? new Date(), 1);
  enqueueSlot(db, next, next);
  const result = await checkProfiles(db, config, { signal: options.signal });
  const queued = Object.entries(result.queued).map(([trigger, count]) => `${count} ${trigger}`);
  options.log?.(`profiling check: ${result.checked} repositories, queued ${queued.length ? queued.join(", ") : "none"}, ${result.unreachable.length} unreachable`);
  return result;
}
