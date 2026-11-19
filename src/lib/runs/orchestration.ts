import type { Resolution } from "@/lib/acquisition/mirror";
import { resolveTarget } from "@/lib/acquisition/acquire";
import { sourceById } from "@/lib/catalog/source-records";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { RUN_MACHINE, TARGET_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { failureText } from "@/lib/git/redact";
import type { GitRunner } from "@/lib/git/runner";
import { enqueue } from "@/lib/jobs/queue";
import { NonRetryableError } from "@/lib/jobs/worker";
import { profilesOf } from "@/lib/profiles/profile-records";
import { finalizeRelationshipMap } from "@/lib/relationships/finalize";
import { recordConfiguredResolution, requestSurvey, surveyById } from "@/lib/surveys/records";
import { queueSurvey } from "@/lib/surveys/run";
import { type Run, type RunTarget, getRun, getTarget, linkSurvey, targetsOf } from "./run-records";
import { COORDINATE_RUN, RUN_PRIORITY } from "./launcher";
import { runById } from "./lookups";
import { advanceRun, transitionRun, transitionTarget } from "./transitions";
import { FINALIZE_RUN, requestFinalization, settleTarget } from "./waiting";

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

export { COORDINATE_RUN, FINALIZE_RUN };

class Canceled extends Error {
  override name = "Canceled";
}

export function coordinateRun(db: Executor, runPublicId: string): void {
  immediate(db, (tx) => {
    const run = getRun(tx, runPublicId);
    if (isTerminal(RUN_MACHINE, run.state)) return;
    const targets = targetsOf(tx, run.id);
    if (run.cancelRequestedAt) {
      // Canceled before any work started: no target is resolved.
      for (const target of targets) if (!isTerminal(TARGET_MACHINE, target.state)) transitionTarget(tx, target, "canceled");
    } else {
      for (const target of targets) enqueue(tx, { kind: PROCESS_TARGET, payload: { target: target.publicId }, idempotencyKey: `${PROCESS_TARGET}:${target.publicId}`, priority: RUN_PRIORITY });
    }
    requestFinalization(tx, run.id);
  });
}

export interface ProcessOptions {
  config?: FrontendRegistryConfig;
  runner?: GitRunner;
  signal?: AbortSignal;
}

export async function processTarget(db: Executor, targetPublicId: string, options: ProcessOptions = {}): Promise<RunTarget> {
  const config = options.config ?? getConfig();
  let target = getTarget(db, targetPublicId);
  try {
    if (isTerminal(TARGET_MACHINE, target.state)) return target;
    checkCancellation(db, target.runId);

    // A retry after the target joined its survey only looks at the survey again.
    if (target.surveyId === null) {
      if (target.state === "pending") target = transitionTarget(db, target, "acquiring");
      advanceRun(db, target.runId, "acquiring");
      const outcome = await resolveTarget(db, target, { config, ...(options.runner && { runner: options.runner }), ...(options.signal && { signal: options.signal }) });
      if (!outcome.ok) return outcome.target;
      checkCancellation(db, target.runId);
      target = joinSurvey(db, getTarget(db, targetPublicId), outcome.resolution);
    }
    advanceRun(db, target.runId, "analyzing");
    return settleTarget(db, target, surveyById(db, target.surveyId!));
  } catch (error) {
    const current = getTarget(db, targetPublicId);
    if (isTerminal(TARGET_MACHINE, current.state)) return current;
    if (error instanceof Canceled || options.signal?.aborted) return transitionTarget(db, current, "canceled");
    // Normalized per source: a stable code and a redacted message, with no effect on other targets.
    return transitionTarget(db, current, "failed", { failureCode: current.state === "analyzing" ? "analysis_failed" : "acquisition_failed", failureMessage: failureText(error, 500) });
  } finally {
    requestFinalization(db, target.runId);
  }
}

/**
 * Records how the target's reference resolved, finds or starts the survey of
 * its commit under the Run's recipe, raises a queued survey to the Run's
 * priority, and waits on it: one transaction.
 */
function joinSurvey(db: Executor, target: RunTarget, resolution: Resolution): RunTarget {
  return immediate(db, (tx) => {
    const run = runById(tx, target.runId);
    const configured = target.gitRef === sourceById(tx, target.repositorySourceId).gitRef;
    const { survey } = requestSurvey(tx, {
      repositorySourceId: target.repositorySourceId,
      commitSha: resolution.commitSha,
      reference: resolution.name,
      fromConfiguredReference: configured,
      trigger: "run",
      requestedByRunId: run.id,
      surveyorRelease: run.surveyorRelease,
      configurationDigest: run.configurationDigest,
      profileSchemaVersion: run.profileSchemaVersion,
    });
    if (survey.state === "queued") queueSurvey(tx, survey, RUN_PRIORITY);
    // A Run of the configured reference says which commit it names now.
    if (configured) recordConfiguredResolution(tx, target.repositorySourceId, resolution.commitSha, new Date());
    return linkSurvey(tx, target, { refKind: resolution.kind, resolvedRef: resolution.name, surveyId: survey.id });
  });
}

function checkCancellation(db: Executor, runId: number): void {
  if (runById(db, runId).cancelRequestedAt) throw new Canceled("The Run was canceled");
}

type AggregateOutcome = "complete" | "complete_with_issues" | "failed" | "canceled";

/** Writes the Relationship Map once and records the aggregate outcome. Repeated calls change nothing. */
export function finalizeRun(db: Executor, runPublicId: string): Run {
  return immediate(db, (tx) => {
    const run = getRun(tx, runPublicId);
    if (isTerminal(RUN_MACHINE, run.state)) return run;
    if (run.state !== "finalizing") throw new NonRetryableError(`Assessment ${run.publicId} is ${run.state}, not finalizing`);

    const targets = targetsOf(tx, run.id);
    const profiles = profilesOf(tx, run.id).length;
    // Completed Profiles stay reviewable in the map even when the Assessment was canceled.
    finalizeRelationshipMap(tx, run);
    const outcome: AggregateOutcome = run.cancelRequestedAt ? "canceled" : profiles === targets.length ? "complete" : profiles > 0 ? "complete_with_issues" : "failed";
    const failures = targets.filter((target) => target.state === "failed").map((target) => `${target.sourceName}: ${target.failureCode}`);
    return transitionRun(tx, run, outcome, outcome === "failed" ? { failureReason: failures.length ? `No repository could be assessed (${failures.join("; ")})` : "No repository could be assessed" } : {});
  });
}
