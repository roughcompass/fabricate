import { listSources } from "@/lib/catalog/source-records";
import type { FabricateConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { type Job, enqueue } from "@/lib/jobs/queue";
import { requestBackgroundSurvey } from "@/lib/surveys/background";
import { latestSurvey } from "@/lib/surveys/records";
import { settleAbandonedSurveys } from "@/lib/surveys/run";

/*
 * The scheduled check (docs/profiling.md). Time is cut into slots of the
 * configured length, and each slot's job has an idempotency key, so any
 * number of workers and restarts queue one check per slot. Each check queues
 * the next slot's before it starts, so a failed check never ends the
 * schedule.
 *
 * For every Repository whose newest survey isn't queued or running, it
 * requests a background survey: a job per Repository that reads its
 * reference and queues a survey when the commit or the recipe has none yet.
 * A reference that can't be read fails that job, whose error the Repository
 * page shows until a later check reads it.
 */

export const CHECK_PROFILES = "profiling.check";

function slotOf(config: FabricateConfig, time: Date, offset = 0): Date {
  const length = config.profiling.checkMinutes * 60_000;
  return new Date((Math.floor(time.getTime() / length) + offset) * length);
}

function enqueueSlot(db: Executor, slot: Date, runAfter: Date): Job {
  return enqueue(db, { kind: CHECK_PROFILES, payload: { slot: slot.toISOString() }, idempotencyKey: `${CHECK_PROFILES}:${slot.toISOString()}`, runAfter, maxAttempts: 1 });
}

/** Queues this slot's check to run now, unless it already ran, and the next slot's. Called when a worker starts, so a new Surveyor release is checked at once. */
export function scheduleProfileChecks(db: Executor, config: FabricateConfig, now = new Date()): Job[] {
  const next = slotOf(config, now, 1);
  return [enqueueSlot(db, slotOf(config, now), now), enqueueSlot(db, next, next)];
}

export interface CheckResult {
  readonly checked: number;
  /** Repositories whose survey request was queued. */
  readonly requested: number;
}

/** Requests a background survey of every Repository that has none queued or running, once per +slot+, after failing surveys whose jobs were lost. */
export function checkProfiles(db: Executor, slot: string): CheckResult {
  settleAbandonedSurveys(db);
  const sources = listSources(db);
  let requested = 0;
  for (const source of sources) {
    const latest = latestSurvey(db, source.id);
    if (latest && (latest.state === "queued" || latest.state === "running")) continue;
    requestBackgroundSurvey(db, source, "check", `check:${slot}`);
    requested += 1;
  }
  return { checked: sources.length, requested };
}

/** The job handler: queues the next slot, then checks. */
export function runScheduledProfileCheck(db: Executor, config: FabricateConfig, options: { slot?: string; now?: Date; log?: (message: string) => void } = {}): CheckResult {
  const now = options.now ?? new Date();
  const next = slotOf(config, now, 1);
  enqueueSlot(db, next, next);
  const result = checkProfiles(db, options.slot ?? slotOf(config, now).toISOString());
  options.log?.(`profiling check: ${result.checked} repositories, ${result.requested} survey requests queued`);
  return result;
}
