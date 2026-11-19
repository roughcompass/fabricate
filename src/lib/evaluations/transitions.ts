import { eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { TransitionError } from "@/lib/db/errors";
import { type EvaluationReleaseState, type EvaluationState, evaluationReleases, evaluations } from "@/lib/db/schema";
import { EVALUATION_MACHINE, EVALUATION_RELEASE_MACHINE, assertTransition, isTerminal } from "@/lib/db/state-machines";
import { redact } from "@/lib/git/redact";
import type { Evaluation, EvaluationRelease } from "./evaluation-records";
import { updateLocked } from "@/lib/db/optimistic";

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
  return updateLocked(
    db,
    evaluations,
    evaluation,
    {
      state: to,
      ...(to === "complete" && { summary: changes.summary, resultDigest: changes.resultDigest }),
      ...(to === "failed" && { failureReason: redact(changes.failureReason ?? "Evaluation failed") }),
      startedAt: evaluation.startedAt ?? (to === "evaluating" ? now : null),
      finishedAt: isTerminal(EVALUATION_MACHINE, to) ? now : null,
      updatedAt: now,
    },
    `Evaluation ${evaluation.publicId} changed while moving to ${to}`,
    { guard: eq(evaluations.state, evaluation.state) },
  );
}

export function transitionEvaluationRelease(db: Executor, release: EvaluationRelease, to: EvaluationReleaseState, changes: { failureReason?: string } = {}): EvaluationRelease {
  assertTransition(EVALUATION_RELEASE_MACHINE, release.state, to, `Evaluation Release ${release.id}`);

  const now = new Date();
  return updateLocked(
    db,
    evaluationReleases,
    release,
    {
      state: to,
      ...(to === "failed" && { failureReason: redact(changes.failureReason ?? "Evaluation of this Release failed") }),
      startedAt: release.startedAt ?? (to === "evaluating" ? now : null),
      finishedAt: isTerminal(EVALUATION_RELEASE_MACHINE, to) ? now : null,
      updatedAt: now,
    },
    `Evaluation Release ${release.id} changed while moving to ${to}`,
    { guard: eq(evaluationReleases.state, release.state) },
  );
}
