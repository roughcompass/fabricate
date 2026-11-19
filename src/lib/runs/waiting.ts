import { and, eq } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { runTargets } from "@/lib/db/schema";
import { RUN_MACHINE, TARGET_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { enqueue } from "@/lib/jobs/queue";
import type { Survey } from "@/lib/surveys/records";
import { type Run, type RunTarget, targetsOf } from "./run-records";
import { RUN_PRIORITY } from "./launcher";
import { runById } from "./lookups";
import { type TargetFailureCode, requestCancellation, transitionRun, transitionTarget } from "./transitions";

/*
 * How Runs wait on surveys (unify-surveys, design decisions 2 and 3). A
 * target that knows its commit links the commit's survey and waits on it in
 * `analyzing`. The survey wakes every waiting target in its own transaction
 * when it finishes, and asks each of their Runs to finalize. Cancelling a Run
 * stops its targets waiting; the surveys they waited on run on.
 */

export const FINALIZE_RUN = "assessment.finalize";

/** Moves the Assessment to finalizing and enqueues the finalizer, once every target is terminal. */
export function requestFinalization(db: Executor, runId: number): void {
  immediate(db, (tx) => {
    const run = runById(tx, runId);
    if (run.state === "finalizing" || isTerminal(RUN_MACHINE, run.state)) return;
    if (targetsOf(tx, runId).some((target) => !isTerminal(TARGET_MACHINE, target.state))) return;
    transitionRun(tx, run, "finalizing");
    enqueue(tx, { kind: FINALIZE_RUN, payload: { assessment: run.publicId }, idempotencyKey: `${FINALIZE_RUN}:${run.publicId}`, priority: RUN_PRIORITY });
  });
}

/** A target waiting on +survey+ completes when it succeeded and fails with its reason when it failed; otherwise it keeps waiting. */
export function settleTarget(db: Executor, target: RunTarget, survey: Survey): RunTarget {
  if (target.state !== "analyzing") return target;
  if (survey.state === "succeeded") return transitionTarget(db, target, "complete");
  if (survey.state === "failed") {
    return transitionTarget(db, target, "failed", { failureCode: (survey.failureCode ?? "analysis_failed") as TargetFailureCode, failureMessage: survey.failureMessage ?? "The survey failed" });
  }
  return target;
}

/** Continues every target waiting on +survey+, now finished, and asks each of their Runs to finalize. */
export function continueWaitingTargets(db: Executor, survey: Survey): void {
  if (survey.state !== "succeeded" && survey.state !== "failed") return;
  const waiting = db
    .select()
    .from(runTargets)
    .where(and(eq(runTargets.surveyId, survey.id), eq(runTargets.state, "analyzing")))
    .all();
  for (const target of waiting) settleTarget(db, target, survey);
  for (const runId of new Set(waiting.map((target) => target.runId))) requestFinalization(db, runId);
}

/**
 * Cancels a Run: its targets still resolving stop at their next check, and
 * those waiting on a survey are canceled now, since no job of theirs runs
 * again. A survey another request shares keeps running.
 */
export function requestRunCancellation(db: Executor, runId: number): Run {
  return immediate(db, (tx) => {
    const run = requestCancellation(tx, runId);
    for (const target of targetsOf(tx, runId)) if (target.state === "analyzing" && target.surveyId !== null) transitionTarget(tx, target, "canceled");
    requestFinalization(tx, runId);
    return run;
  });
}
