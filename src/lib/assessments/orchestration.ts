import os from "node:os";
import { acquireTarget } from "@/lib/acquisition/acquire";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { ASSESSMENT_MACHINE, TARGET_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { redact } from "@/lib/git/redact";
import { enqueue } from "@/lib/jobs/queue";
import { NonRetryableError } from "@/lib/jobs/worker";
import { analyzeSnapshot } from "@/lib/profiles/analyze";
import { profilesOf } from "@/lib/profiles/profile-records";
import { finalizeRelationshipMap } from "@/lib/relationships/finalize";
import { type Assessment, type AssessmentTarget, getAssessment, getTarget, snapshotOf, targetsOf } from "./assessment-records";
import { COORDINATE_ASSESSMENT } from "./launcher";
import { assessmentById } from "./lookups";
import { advanceAssessment, transitionAssessment, transitionTarget } from "./transitions";

/**
 * Assessment orchestration: a coordinator, one acquire-and-analyze job per
 * target, and a finalizer job.
 *
 * Each target job catches and normalizes its own failures, so one source never
 * blocks another or erases a completed Profile. The last target to reach a
 * terminal state moves the Assessment to finalizing and enqueues the finalizer
 * in the same transaction, so finalization survives a worker restart. The
 * finalizer writes the Relationship Map once and derives the outcome:
 * complete, complete with issues, failed, or canceled.
 *
 * Cancellation is a durable request. Jobs check it before acquisition, before
 * analysis, and between detector stages. Completed Profiles are kept, and a
 * canceled Assessment is never finalized as complete. Every handler is
 * idempotent, because an expired lease lets another worker run the same job.
 */

export const PROCESS_TARGET = "assessment.target";
export const FINALIZE_ASSESSMENT = "assessment.finalize";

export { COORDINATE_ASSESSMENT };

class Canceled extends Error {
  override name = "Canceled";
}

export function coordinateAssessment(db: Executor, assessmentPublicId: string): void {
  immediate(db, (tx) => {
    const assessment = getAssessment(tx, assessmentPublicId);
    if (isTerminal(ASSESSMENT_MACHINE, assessment.state)) return;
    const targets = targetsOf(tx, assessment.id);
    if (assessment.cancelRequestedAt) {
      // Canceled before any work started: no target is acquired.
      for (const target of targets) if (!isTerminal(TARGET_MACHINE, target.state)) transitionTarget(tx, target, "canceled");
    } else {
      for (const target of targets) enqueue(tx, { kind: PROCESS_TARGET, payload: { target: target.publicId }, idempotencyKey: `${PROCESS_TARGET}:${target.publicId}` });
    }
    requestFinalization(tx, assessment.id);
  });
}

export interface ProcessOptions {
  config?: FabricateConfig;
  signal?: AbortSignal;
  holder?: string;
}

export async function processTarget(db: Executor, targetPublicId: string, options: ProcessOptions = {}): Promise<AssessmentTarget> {
  const config = options.config ?? getConfig();
  let target = getTarget(db, targetPublicId);
  try {
    if (isTerminal(TARGET_MACHINE, target.state)) return target;
    checkCancellation(db, target.assessmentId);

    // A retry resumes after the commit was pinned; it never reacquires a moved reference.
    let snapshot = snapshotOf(db, target.id);
    if (!snapshot) {
      if (target.state === "pending") target = transitionTarget(db, target, "acquiring");
      advanceAssessment(db, target.assessmentId, "acquiring");
      const outcome = await acquireTarget(db, target, { config, ...(options.signal && { signal: options.signal }), holder: options.holder ?? `${os.hostname()}:${process.pid}:${target.publicId}` });
      if (!outcome.ok) return outcome.target;
      snapshot = outcome.snapshot;
      target = getTarget(db, targetPublicId);
    }

    checkCancellation(db, target.assessmentId);
    if (target.state === "acquiring") target = transitionTarget(db, target, "analyzing");
    advanceAssessment(db, target.assessmentId, "analyzing");
    await analyzeSnapshot(db, {
      assessment: assessmentById(db, target.assessmentId),
      target,
      snapshot,
      config,
      ...(options.signal && { signal: options.signal }),
      checkpoint: () => checkCancellation(db, target.assessmentId),
    });
    target = transitionTarget(db, getTarget(db, targetPublicId), "complete");
    return target;
  } catch (error) {
    const current = getTarget(db, targetPublicId);
    if (isTerminal(TARGET_MACHINE, current.state)) return current;
    if (error instanceof Canceled || options.signal?.aborted) return transitionTarget(db, current, "canceled");
    // Normalized per source: a stable code and a redacted message, with no effect on other targets.
    return transitionTarget(db, current, "failed", { failureCode: current.state === "analyzing" ? "analysis_failed" : "acquisition_failed", failureMessage: redact((error as Error).message ?? String(error)).slice(0, 500) });
  } finally {
    requestFinalization(db, target.assessmentId);
  }
}

function checkCancellation(db: Executor, assessmentId: number): void {
  if (assessmentById(db, assessmentId).cancelRequestedAt) throw new Canceled("The Run was canceled");
}

/** Moves the Assessment to finalizing and enqueues the finalizer, once every target is terminal. */
export function requestFinalization(db: Executor, assessmentId: number): void {
  immediate(db, (tx) => {
    const assessment = assessmentById(tx, assessmentId);
    if (assessment.state === "finalizing" || isTerminal(ASSESSMENT_MACHINE, assessment.state)) return;
    if (targetsOf(tx, assessmentId).some((target) => !isTerminal(TARGET_MACHINE, target.state))) return;
    transitionAssessment(tx, assessment, "finalizing");
    enqueue(tx, { kind: FINALIZE_ASSESSMENT, payload: { assessment: assessment.publicId }, idempotencyKey: `${FINALIZE_ASSESSMENT}:${assessment.publicId}` });
  });
}

export type AggregateOutcome = "complete" | "complete_with_issues" | "failed" | "canceled";

/** Writes the Relationship Map once and records the aggregate outcome. Repeated calls change nothing. */
export function finalizeAssessment(db: Executor, assessmentPublicId: string): Assessment {
  return immediate(db, (tx) => {
    const assessment = getAssessment(tx, assessmentPublicId);
    if (isTerminal(ASSESSMENT_MACHINE, assessment.state)) return assessment;
    if (assessment.state !== "finalizing") throw new NonRetryableError(`Assessment ${assessment.publicId} is ${assessment.state}, not finalizing`);

    const targets = targetsOf(tx, assessment.id);
    const profiles = profilesOf(tx, assessment.id).length;
    // Completed Profiles stay reviewable in the map even when the Assessment was canceled.
    finalizeRelationshipMap(tx, assessment);
    const outcome: AggregateOutcome = assessment.cancelRequestedAt ? "canceled" : profiles === targets.length ? "complete" : profiles > 0 ? "complete_with_issues" : "failed";
    const failures = targets.filter((target) => target.state === "failed").map((target) => `${target.sourceName}: ${target.failureCode}`);
    return transitionAssessment(tx, assessment, outcome, outcome === "failed" ? { failureReason: failures.length ? `No repository could be assessed (${failures.join("; ")})` : "No repository could be assessed" } : {});
  });
}
