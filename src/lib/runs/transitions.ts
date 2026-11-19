import { eq } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { updateLocked } from "@/lib/db/optimistic";
import { TransitionError } from "@/lib/db/errors";
import { type RunState, type TargetState, runTargets, runs } from "@/lib/db/schema";
import { RUN_MACHINE, TARGET_MACHINE, assertTransition, canTransition, isTerminal } from "@/lib/db/state-machines";
import { redact } from "@/lib/git/redact";
import type { Run, RunTarget } from "./run-records";
import type { AcquisitionFailureCode } from "@/lib/acquisition/errors";

/**
 * The only writers of Run and target state. Each transition is
 * checked against the state machine, written only if the row is still in the
 * state the caller read, and refused once the record is terminal.
 */

export interface RunChanges {
  failureReason?: string | null;
}

export function transitionRun(db: Executor, run: Run, to: RunState, changes: RunChanges = {}): Run {
  assertTransition(RUN_MACHINE, run.state, to, `Assessment ${run.publicId}`);
  const now = new Date();
  return updateLocked(
    db,
    runs,
    run,
    {
      state: to,
      ...(changes.failureReason !== undefined && { failureReason: changes.failureReason && redact(changes.failureReason) }),
      startedAt: run.startedAt ?? (to === "acquiring" ? now : null),
      finishedAt: isTerminal(RUN_MACHINE, to) ? now : null,
      updatedAt: now,
    },
    `Assessment ${run.publicId} changed while moving to ${to}`,
    { guard: eq(runs.state, run.state) },
  );
}

/**
 * Moves the aggregate state forward if the current state allows it, and
 * otherwise leaves it unchanged. Concurrent target jobs use this so the
 * aggregate never regresses.
 */
export function advanceRun(db: Executor, runId: number, to: RunState): Run {
  return immediate(db, (tx) => {
    const current = tx.select().from(runs).where(eq(runs.id, runId)).get();
    if (!current) throw new TransitionError(`Assessment ${runId} does not exist`);
    return canTransition(RUN_MACHINE, current.state, to) ? transitionRun(tx, current, to) : current;
  });
}

/** Records a durable cancellation request. Repeating it has no further effect. */
export function requestCancellation(db: Executor, runId: number): Run {
  return immediate(db, (tx) => {
    const current = tx.select().from(runs).where(eq(runs.id, runId)).get();
    if (!current) throw new TransitionError(`Assessment ${runId} does not exist`);
    if (isTerminal(RUN_MACHINE, current.state)) throw new TransitionError(`Assessment ${current.publicId} is ${current.state} and cannot be canceled`);
    if (current.cancelRequestedAt) return current;

    const now = new Date();
    return updateLocked(tx, runs, current, { cancelRequestedAt: now, updatedAt: now }, `Assessment ${current.publicId} changed while its cancellation was requested`);
  });
}

/** Why a target failed: how its acquisition failed, or that acquisition or analysis stopped unexpectedly. */
export type TargetFailureCode = AcquisitionFailureCode | "acquisition_failed" | "analysis_failed";

export interface TargetChanges {
  /** Required when moving to failed; a stable, machine-readable code. */
  failureCode?: TargetFailureCode;
  /** Human-readable cause. Redacted before it is stored. */
  failureMessage?: string;
}

export function transitionTarget(db: Executor, target: RunTarget, to: TargetState, changes: TargetChanges = {}): RunTarget {
  assertTransition(TARGET_MACHINE, target.state, to, `Target ${target.publicId}`);
  if (to === "failed" && !changes.failureCode) throw new TransitionError(`Target ${target.publicId} needs a failure code to fail`);

  const now = new Date();
  return updateLocked(
    db,
    runTargets,
    target,
    {
      state: to,
      failureCode: to === "failed" ? changes.failureCode : null,
      failureMessage: to === "failed" ? redact(changes.failureMessage ?? changes.failureCode ?? "") : null,
      startedAt: target.startedAt ?? (to === "acquiring" ? now : null),
      finishedAt: isTerminal(TARGET_MACHINE, to) ? now : null,
      updatedAt: now,
    },
    `Target ${target.publicId} changed while moving to ${to}`,
    { guard: eq(runTargets.state, target.state) },
  );
}
