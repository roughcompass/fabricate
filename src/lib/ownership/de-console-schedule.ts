import type { FabricateConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { type Job, enqueue } from "@/lib/jobs/queue";
import { NonRetryableError } from "@/lib/jobs/worker";
import { refreshDeConsole } from "./de-console";

/*
 * The scheduled DE Console read. Time is cut into slots of the configured
 * length, and each slot's job has an idempotency key, so any number of
 * workers and restarts queue one read per slot. Each read queues the next
 * slot's read before it starts, so a failed read never ends the schedule.
 */

export const READ_DE_CONSOLE = "de-console.read";

function slotOf(config: FabricateConfig, time: Date, offset = 0): Date {
  const length = config.deConsole.refreshMinutes * 60_000;
  return new Date((Math.floor(time.getTime() / length) + offset) * length);
}

function enqueueSlot(db: Executor, slot: Date, runAfter: Date): Job {
  return enqueue(db, { kind: READ_DE_CONSOLE, payload: { slot: slot.toISOString() }, idempotencyKey: `${READ_DE_CONSOLE}:${slot.toISOString()}`, runAfter, maxAttempts: 1 });
}

/** Queues this slot's read to run now, unless it already ran, and the next slot's. Called when a worker starts. */
export function scheduleDeConsoleReads(db: Executor, config: FabricateConfig, now = new Date()): Job[] {
  if (!config.deConsole.source) return [];
  const next = slotOf(config, now, 1);
  return [enqueueSlot(db, slotOf(config, now), now), enqueueSlot(db, next, next)];
}

/** The job handler: queues the next slot, then reads. A failed read is logged and fails the job. */
export async function runScheduledDeConsoleRead(db: Executor, config: FabricateConfig, options: { signal?: AbortSignal; now?: Date } = {}): Promise<void> {
  if (!config.deConsole.source) return;
  const next = slotOf(config, options.now ?? new Date(), 1);
  enqueueSlot(db, next, next);
  const result = await refreshDeConsole(db, config, "schedule", { signal: options.signal });
  if (result.status === "failed") throw new NonRetryableError(result.read.error!);
}
