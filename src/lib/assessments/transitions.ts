import { eq } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { updateLocked } from "@/lib/db/optimistic";
import { TransitionError } from "@/lib/db/errors";
import { type AssessmentState, type TargetState, assessmentTargets, assessments } from "@/lib/db/schema";
import { ASSESSMENT_MACHINE, TARGET_MACHINE, assertTransition, canTransition, isTerminal } from "@/lib/db/state-machines";
import { redact } from "@/lib/git/redact";
import type { Assessment, AssessmentTarget } from "./assessment-records";
import type { AcquisitionFailureCode } from "@/lib/acquisition/errors";

/**
 * The only writers of Assessment and target state. Each transition is
 * checked against the state machine, written only if the row is still in the
 * state the caller read, and refused once the record is terminal.
 */

export interface AssessmentChanges {
  failureReason?: string | null;
}

export function transitionAssessment(db: Executor, assessment: Assessment, to: AssessmentState, changes: AssessmentChanges = {}): Assessment {
  assertTransition(ASSESSMENT_MACHINE, assessment.state, to, `Assessment ${assessment.publicId}`);
  const now = new Date();
  return updateLocked(
    db,
    assessments,
    assessment,
    {
      state: to,
      ...(changes.failureReason !== undefined && { failureReason: changes.failureReason && redact(changes.failureReason) }),
      startedAt: assessment.startedAt ?? (to === "acquiring" ? now : null),
      finishedAt: isTerminal(ASSESSMENT_MACHINE, to) ? now : null,
      updatedAt: now,
    },
    `Assessment ${assessment.publicId} changed while moving to ${to}`,
    { guard: eq(assessments.state, assessment.state) },
  );
}

/**
 * Moves the aggregate state forward if the current state allows it, and
 * otherwise leaves it unchanged. Concurrent target jobs use this so the
 * aggregate never regresses.
 */
export function advanceAssessment(db: Executor, assessmentId: number, to: AssessmentState): Assessment {
  return immediate(db, (tx) => {
    const current = tx.select().from(assessments).where(eq(assessments.id, assessmentId)).get();
    if (!current) throw new TransitionError(`Assessment ${assessmentId} does not exist`);
    return canTransition(ASSESSMENT_MACHINE, current.state, to) ? transitionAssessment(tx, current, to) : current;
  });
}

/** Records a durable cancellation request. Repeating it has no further effect. */
export function requestCancellation(db: Executor, assessmentId: number): Assessment {
  return immediate(db, (tx) => {
    const current = tx.select().from(assessments).where(eq(assessments.id, assessmentId)).get();
    if (!current) throw new TransitionError(`Assessment ${assessmentId} does not exist`);
    if (isTerminal(ASSESSMENT_MACHINE, current.state)) throw new TransitionError(`Assessment ${current.publicId} is ${current.state} and cannot be canceled`);
    if (current.cancelRequestedAt) return current;

    const now = new Date();
    return updateLocked(tx, assessments, current, { cancelRequestedAt: now, updatedAt: now }, `Assessment ${current.publicId} changed while its cancellation was requested`);
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

export function transitionTarget(db: Executor, target: AssessmentTarget, to: TargetState, changes: TargetChanges = {}): AssessmentTarget {
  assertTransition(TARGET_MACHINE, target.state, to, `Target ${target.publicId}`);
  if (to === "failed" && !changes.failureCode) throw new TransitionError(`Target ${target.publicId} needs a failure code to fail`);

  const now = new Date();
  return updateLocked(
    db,
    assessmentTargets,
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
    { guard: eq(assessmentTargets.state, target.state) },
  );
}
