import type { Resolution } from "@/lib/acquisition/mirror";
import { resolveTarget } from "@/lib/acquisition/acquire";
import { sourceById } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { ASSESSMENT_MACHINE, TARGET_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { failureText } from "@/lib/git/redact";
import type { GitRunner } from "@/lib/git/runner";
import { enqueue } from "@/lib/jobs/queue";
import { NonRetryableError } from "@/lib/jobs/worker";
import { profilesOf } from "@/lib/profiles/profile-records";
import { finalizeRelationshipMap } from "@/lib/relationships/finalize";
import { recordConfiguredResolution, requestSurvey, surveyById } from "@/lib/surveys/records";
import { queueSurvey } from "@/lib/surveys/run";
import { type Assessment, type AssessmentTarget, getAssessment, getTarget, linkSurvey, targetsOf } from "./assessment-records";
import { COORDINATE_ASSESSMENT, RUN_PRIORITY } from "./launcher";
import { assessmentById } from "./lookups";
import { advanceAssessment, transitionAssessment, transitionTarget } from "./transitions";
import { FINALIZE_ASSESSMENT, requestFinalization, settleTarget } from "./waiting";

/**
 * Assessment orchestration: a coordinator, one job per target, and a
 * finalizer job (unify-surveys, design decision 2).
 *
 * A target's job resolves its reference to the commit the remote advertises,
 * then joins that commit's survey under the Run's recipe and waits on it. A
 * survey that already succeeded completes the target at once; otherwise the
 * survey continues every waiting target when it finishes. A failure before
 * the commit is known is the target's own and starts no survey. The last
 * target to finish moves the Assessment to finalizing and enqueues the
 * finalizer in the same transaction, so finalization survives a worker
 * restart. The finalizer writes the Relationship Map once and derives the
 * outcome: complete, complete with issues, failed, or canceled.
 *
 * Cancellation is a durable request that targets check before resolving and
 * before joining; cancelling a Run cancels the targets already waiting, and
 * leaves the surveys running. Every handler is idempotent, because an expired
 * lease lets another worker run the same job.
 */

export const PROCESS_TARGET = "assessment.target";

export { COORDINATE_ASSESSMENT, FINALIZE_ASSESSMENT };

class Canceled extends Error {
  override name = "Canceled";
}

export function coordinateAssessment(db: Executor, assessmentPublicId: string): void {
  immediate(db, (tx) => {
    const assessment = getAssessment(tx, assessmentPublicId);
    if (isTerminal(ASSESSMENT_MACHINE, assessment.state)) return;
    const targets = targetsOf(tx, assessment.id);
    if (assessment.cancelRequestedAt) {
      // Canceled before any work started: no target is resolved.
      for (const target of targets) if (!isTerminal(TARGET_MACHINE, target.state)) transitionTarget(tx, target, "canceled");
    } else {
      for (const target of targets) enqueue(tx, { kind: PROCESS_TARGET, payload: { target: target.publicId }, idempotencyKey: `${PROCESS_TARGET}:${target.publicId}`, priority: RUN_PRIORITY });
    }
    requestFinalization(tx, assessment.id);
  });
}

export interface ProcessOptions {
  config?: FabricateConfig;
  runner?: GitRunner;
  signal?: AbortSignal;
}

export async function processTarget(db: Executor, targetPublicId: string, options: ProcessOptions = {}): Promise<AssessmentTarget> {
  const config = options.config ?? getConfig();
  let target = getTarget(db, targetPublicId);
  try {
    if (isTerminal(TARGET_MACHINE, target.state)) return target;
    checkCancellation(db, target.assessmentId);

    // A retry after the target joined its survey only looks at the survey again.
    if (target.surveyId === null) {
      if (target.state === "pending") target = transitionTarget(db, target, "acquiring");
      advanceAssessment(db, target.assessmentId, "acquiring");
      const outcome = await resolveTarget(db, target, { config, ...(options.runner && { runner: options.runner }), ...(options.signal && { signal: options.signal }) });
      if (!outcome.ok) return outcome.target;
      checkCancellation(db, target.assessmentId);
      target = joinSurvey(db, getTarget(db, targetPublicId), outcome.resolution);
    }
    advanceAssessment(db, target.assessmentId, "analyzing");
    return settleTarget(db, target, surveyById(db, target.surveyId!));
  } catch (error) {
    const current = getTarget(db, targetPublicId);
    if (isTerminal(TARGET_MACHINE, current.state)) return current;
    if (error instanceof Canceled || options.signal?.aborted) return transitionTarget(db, current, "canceled");
    // Normalized per source: a stable code and a redacted message, with no effect on other targets.
    return transitionTarget(db, current, "failed", { failureCode: current.state === "analyzing" ? "analysis_failed" : "acquisition_failed", failureMessage: failureText(error, 500) });
  } finally {
    requestFinalization(db, target.assessmentId);
  }
}

/**
 * Records how the target's reference resolved, finds or starts the survey of
 * its commit under the Run's recipe, raises a queued survey to the Run's
 * priority, and waits on it: one transaction.
 */
function joinSurvey(db: Executor, target: AssessmentTarget, resolution: Resolution): AssessmentTarget {
  return immediate(db, (tx) => {
    const assessment = assessmentById(tx, target.assessmentId);
    const configured = target.gitRef === sourceById(tx, target.repositorySourceId).gitRef;
    const { survey } = requestSurvey(tx, {
      repositorySourceId: target.repositorySourceId,
      commitSha: resolution.commitSha,
      reference: resolution.name,
      fromConfiguredReference: configured,
      trigger: "run",
      requestedByAssessmentId: assessment.id,
      surveyorRelease: assessment.detectorRelease,
      configurationDigest: assessment.configurationDigest,
      profileSchemaVersion: assessment.profileSchemaVersion,
    });
    if (survey.state === "queued") queueSurvey(tx, survey, RUN_PRIORITY);
    // A Run of the configured reference says which commit it names now.
    if (configured) recordConfiguredResolution(tx, target.repositorySourceId, resolution.commitSha, new Date());
    return linkSurvey(tx, target, { refKind: resolution.kind, resolvedRef: resolution.name, surveyId: survey.id });
  });
}

function checkCancellation(db: Executor, assessmentId: number): void {
  if (assessmentById(db, assessmentId).cancelRequestedAt) throw new Canceled("The Run was canceled");
}

type AggregateOutcome = "complete" | "complete_with_issues" | "failed" | "canceled";

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
