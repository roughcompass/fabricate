import { and, eq } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { assessmentTargets } from "@/lib/db/schema";
import { ASSESSMENT_MACHINE, TARGET_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { enqueue } from "@/lib/jobs/queue";
import type { Survey } from "@/lib/surveys/records";
import { type Assessment, type AssessmentTarget, targetsOf } from "./assessment-records";
import { RUN_PRIORITY } from "./launcher";
import { assessmentById } from "./lookups";
import { type TargetFailureCode, requestCancellation, transitionAssessment, transitionTarget } from "./transitions";

/*
 * How Runs wait on surveys (unify-surveys, design decisions 2 and 3). A
 * target that knows its commit links the commit's survey and waits on it in
 * `analyzing`. The survey wakes every waiting target in its own transaction
 * when it finishes, and asks each of their Runs to finalize. Cancelling a Run
 * stops its targets waiting; the surveys they waited on run on.
 */

export const FINALIZE_ASSESSMENT = "assessment.finalize";

/** Moves the Assessment to finalizing and enqueues the finalizer, once every target is terminal. */
export function requestFinalization(db: Executor, assessmentId: number): void {
  immediate(db, (tx) => {
    const assessment = assessmentById(tx, assessmentId);
    if (assessment.state === "finalizing" || isTerminal(ASSESSMENT_MACHINE, assessment.state)) return;
    if (targetsOf(tx, assessmentId).some((target) => !isTerminal(TARGET_MACHINE, target.state))) return;
    transitionAssessment(tx, assessment, "finalizing");
    enqueue(tx, { kind: FINALIZE_ASSESSMENT, payload: { assessment: assessment.publicId }, idempotencyKey: `${FINALIZE_ASSESSMENT}:${assessment.publicId}`, priority: RUN_PRIORITY });
  });
}

/** A target waiting on +survey+ completes when it succeeded and fails with its reason when it failed; otherwise it keeps waiting. */
export function settleTarget(db: Executor, target: AssessmentTarget, survey: Survey): AssessmentTarget {
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
    .from(assessmentTargets)
    .where(and(eq(assessmentTargets.surveyId, survey.id), eq(assessmentTargets.state, "analyzing")))
    .all();
  for (const target of waiting) settleTarget(db, target, survey);
  for (const assessmentId of new Set(waiting.map((target) => target.assessmentId))) requestFinalization(db, assessmentId);
}

/**
 * Cancels a Run: its targets still resolving stop at their next check, and
 * those waiting on a survey are canceled now, since no job of theirs runs
 * again. A survey another request shares keeps running.
 */
export function cancelRun(db: Executor, assessmentId: number): Assessment {
  return immediate(db, (tx) => {
    const assessment = requestCancellation(tx, assessmentId);
    for (const target of targetsOf(tx, assessmentId)) if (target.state === "analyzing" && target.surveyId !== null) transitionTarget(tx, target, "canceled");
    requestFinalization(tx, assessmentId);
    return assessment;
  });
}
