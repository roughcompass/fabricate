import { and, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { StaleRecordError, TransitionError } from "@/lib/db/errors";
import { type EvaluationReleaseState, type EvaluationState, evaluationReleases, evaluations } from "@/lib/db/schema";
import { EVALUATION_MACHINE, EVALUATION_RELEASE_MACHINE, assertTransition, isTerminal } from "@/lib/db/state-machines";
import { redact } from "@/lib/git/redact";
import type { Evaluation, EvaluationRelease } from "./evaluation-records";

/** The only writers of Evaluation and pinned-Release state. */

export interface EvaluationChanges {
  /** Canonical summary text; required to complete. */
  summary?: string;
  /** SHA-256 of the normalized result; required to complete. */
  resultDigest?: string;
  failureReason?: string;
}

export function transitionEvaluation(db: Executor, evaluation: Evaluation, to: EvaluationState, changes: EvaluationChanges = {}): Evaluation {
  assertTransition(EVALUATION_MACHINE, evaluation.state, to, `Evaluation ${evaluation.publicId}`);
  if (to === "complete" && (!changes.summary || !changes.resultDigest)) {
    throw new TransitionError(`Evaluation ${evaluation.publicId} needs a summary and result digest to complete`);
  }

  const now = new Date();
  const updated = db
    .update(evaluations)
    .set({
      state: to,
      ...(to === "complete" && { summary: changes.summary, resultDigest: changes.resultDigest }),
      ...(to === "failed" && { failureReason: redact(changes.failureReason ?? "Evaluation failed") }),
      startedAt: evaluation.startedAt ?? (to === "evaluating" ? now : null),
      finishedAt: isTerminal(EVALUATION_MACHINE, to) ? now : null,
      lockVersion: evaluation.lockVersion + 1,
      updatedAt: now,
    })
    .where(and(eq(evaluations.id, evaluation.id), eq(evaluations.state, evaluation.state), eq(evaluations.lockVersion, evaluation.lockVersion)))
    .returning()
    .get();
  if (!updated) throw new StaleRecordError(`Evaluation ${evaluation.publicId} changed while moving to ${to}`);
  return updated;
}

export function transitionEvaluationRelease(db: Executor, release: EvaluationRelease, to: EvaluationReleaseState, changes: { failureReason?: string } = {}): EvaluationRelease {
  assertTransition(EVALUATION_RELEASE_MACHINE, release.state, to, `Evaluation Release ${release.id}`);

  const now = new Date();
  const updated = db
    .update(evaluationReleases)
    .set({
      state: to,
      ...(to === "failed" && { failureReason: redact(changes.failureReason ?? "Evaluation of this Release failed") }),
      startedAt: release.startedAt ?? (to === "evaluating" ? now : null),
      finishedAt: isTerminal(EVALUATION_RELEASE_MACHINE, to) ? now : null,
      lockVersion: release.lockVersion + 1,
      updatedAt: now,
    })
    .where(and(eq(evaluationReleases.id, release.id), eq(evaluationReleases.state, release.state), eq(evaluationReleases.lockVersion, release.lockVersion)))
    .returning()
    .get();
  if (!updated) throw new StaleRecordError(`Evaluation Release ${release.id} changed while moving to ${to}`);
  return updated;
}
