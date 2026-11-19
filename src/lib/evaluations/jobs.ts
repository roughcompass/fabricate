import { type JsonObject, digestOf, dump } from "@repo-facts/contract";
import { targetsOf } from "@/lib/runs/run-records";
import { type Executor, immediate } from "@/lib/db/client";
import { EVALUATION_RELEASE_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { enqueue } from "@/lib/jobs/queue";
import { NonRetryableError } from "@/lib/jobs/worker";
import { releaseById, releaseDocument, standardById } from "@/lib/standards/standard-records";
import { evaluateReleaseControls } from "./controls";
import { type Evaluation, type EvaluationRelease, coverageGapsOf, evaluationReleasesOf, findingDocument, findingsOf, getEvaluation, insertFinding } from "./evaluation-records";
import { evaluationInputs } from "./start";
import { type SummaryFinding, summarize } from "./summary";
import { transitionEvaluation, transitionEvaluationRelease } from "./transitions";
import { failureText } from "@/lib/git/redact";

/**
 * The Evaluation pipeline: one idempotent job per pinned Release, and a
 * locked finalizer.
 *
 * A Release job reads only stored, digest-verified documents, computes its
 * Findings outside any transaction, then writes every Finding and completes
 * the pinned Release in one immediate transaction. A job that runs again after
 * an expired lease finds the Release complete and writes nothing. Releases
 * never share or suppress Findings, so overlapping Controls stay independent.
 *
 * The last Release to reach a terminal state moves the Evaluation to
 * finalizing and enqueues its finalizer in the same transaction. The finalizer
 * locks the Evaluation and completes it once with a summary and a canonical
 * digest of its normalized result; a repeated call changes nothing.
 */

export const FINALIZE_EVALUATION = "evaluation.finalize";

export async function runEvaluationRelease(db: Executor, payload: { evaluation: string; position: number }): Promise<Evaluation> {
  const evaluation = getEvaluation(db, payload.evaluation);
  const pinned = pinnedAt(db, evaluation, payload.position);
  if (!isTerminal(EVALUATION_RELEASE_MACHINE, pinned.state)) {
    let findings: JsonObject[];
    try {
      findings = evaluatePinned(db, evaluation, pinned);
    } catch (error) {
      failRelease(db, evaluation.publicId, payload.position, (error as Error).message);
      return getEvaluation(db, evaluation.publicId);
    }
    immediate(db, (tx) => {
      let current = getEvaluation(tx, evaluation.publicId);
      if (current.state === "queued") current = transitionEvaluation(tx, current, "evaluating");
      let release = pinnedAt(tx, current, payload.position);
      // Another run already wrote this Release's Findings, or the Evaluation ended.
      if (isTerminal(EVALUATION_RELEASE_MACHINE, release.state) || current.state !== "evaluating") return;
      if (release.state === "pending") release = transitionEvaluationRelease(tx, release, "evaluating");
      const targets = new Map(targetsOf(tx, current.runId).map((target) => [target.publicId, target]));
      findings.forEach((document, position) => {
        const subject = document.subject as JsonObject;
        const target = subject.type === "repository" ? targets.get(String(subject.target)) : undefined;
        insertFinding(tx, { evaluation: current, evaluationRelease: release, ...(target && { target }), position, document });
      });
      transitionEvaluationRelease(tx, release, "complete");
      requestEvaluationFinalization(tx, current.publicId);
    });
  }
  return getEvaluation(db, evaluation.publicId);
}

/** Moves the Evaluation to finalizing and enqueues its finalizer, once every pinned Release is terminal. */
function requestEvaluationFinalization(db: Executor, evaluationPublicId: string): void {
  let evaluation = getEvaluation(db, evaluationPublicId);
  if (evaluation.state === "finalizing" || evaluation.state === "complete" || evaluation.state === "failed") return;
  if (evaluationReleasesOf(db, evaluation.id).some((release) => !isTerminal(EVALUATION_RELEASE_MACHINE, release.state))) return;
  if (evaluation.state === "queued") evaluation = transitionEvaluation(db, evaluation, "evaluating");
  transitionEvaluation(db, evaluation, "finalizing");
  enqueue(db, { kind: FINALIZE_EVALUATION, payload: { evaluation: evaluation.publicId }, idempotencyKey: `${FINALIZE_EVALUATION}:${evaluation.publicId}` });
}

/** The Findings of one pinned Release, from the Release and the Assessment's stored results alone. */
function evaluatePinned(db: Executor, evaluation: Evaluation, pinned: EvaluationRelease): JsonObject[] {
  const release = releaseById(db, pinned.standardReleaseId);
  if (release.digest !== pinned.releaseDigest) throw new Error("The Release no longer matches the digest pinned when the Evaluation started");
  const standard = standardById(db, release.standardId);
  return evaluateReleaseControls(
    { public_id: release.publicId, digest: release.digest, version: release.version, standard: standard.name, document: releaseDocument(release) },
    evaluationInputs(db, evaluation.runId),
  );
}

export function finalizeEvaluation(db: Executor, evaluationPublicId: string): Evaluation {
  return immediate(db, (tx) => {
    let evaluation = getEvaluation(tx, evaluationPublicId);
    if (evaluation.state === "complete" || evaluation.state === "failed") return evaluation;
    const pinned = evaluationReleasesOf(tx, evaluation.id);
    if (pinned.some((release) => !isTerminal(EVALUATION_RELEASE_MACHINE, release.state))) return evaluation;

    const failed = pinned.filter((release) => release.state === "failed");
    if (failed.length) {
      return transitionEvaluation(tx, evaluation, "failed", { failureReason: `${failed.length} of ${pinned.length} Release(s) could not be evaluated: ${failed.map((release) => release.failureReason).join("; ")}` });
    }

    if (evaluation.state === "queued") evaluation = transitionEvaluation(tx, evaluation, "evaluating");
    if (evaluation.state === "evaluating") evaluation = transitionEvaluation(tx, evaluation, "finalizing");
    const findings = findingsOf(tx, evaluation.id);
    const positions = new Map(pinned.map((release) => [release.id, release.position]));
    const summary = summarize({
      releases: pinned.map((release) => {
        const standardRelease = releaseById(tx, release.standardReleaseId);
        return { position: release.position, public_id: standardRelease.publicId, standard: standardById(tx, standardRelease.standardId).name, version: standardRelease.version, digest: release.releaseDigest };
      }),
      findings: findings.map((finding): SummaryFinding => {
        const subject = findingDocument(finding).subject as JsonObject;
        return { releasePosition: positions.get(finding.evaluationReleaseId)!, outcome: finding.outcome, severity: finding.severity, subjectKey: finding.subjectKey, subjectName: String(subject.name), subjectType: finding.subjectType };
      }),
      coverageGaps: coverageGapsOf(evaluation).length,
    });
    // The normalized result: the summary and every Finding's digest, in Release, Control, and subject order.
    const resultDigest = digestOf({ summary, findings: findings.map((finding) => finding.digest) }).digest;
    return transitionEvaluation(tx, evaluation, "complete", { summary: dump(summary), resultDigest });
  });
}

function pinnedAt(db: Executor, evaluation: Evaluation, position: number): EvaluationRelease {
  const pinned = evaluationReleasesOf(db, evaluation.id).find((release) => release.position === position);
  if (!pinned) throw new NonRetryableError(`Evaluation ${evaluation.publicId} has no Release at position ${position}`);
  return pinned;
}

function failRelease(db: Executor, evaluationPublicId: string, position: number, reason: string): void {
  immediate(db, (tx) => {
    const evaluation = getEvaluation(tx, evaluationPublicId);
    const release = evaluationReleasesOf(tx, evaluation.id).find((item) => item.position === position);
    if (!release || isTerminal(EVALUATION_RELEASE_MACHINE, release.state)) return;
    transitionEvaluationRelease(tx, release, "failed", { failureReason: failureText(reason, 500) });
    requestEvaluationFinalization(tx, evaluationPublicId);
  });
}
