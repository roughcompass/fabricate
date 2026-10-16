import crypto from "node:crypto";
import type { Executor } from "@/lib/db/client";
import type { Evaluation } from "@/lib/evaluations/evaluation-records";
import { EvaluationStartError, startEvaluation } from "@/lib/evaluations/start";
import { initiativeById, selectedReleases } from "@/lib/initiatives/initiative-records";
import { type Assessment, evaluationReleasesOf } from "./assessment-records";

/*
 * The Evaluation a finished Salt Patterns Run gets (converge-templates-and-
 * prototypes, design decision 2). It's apart from the launcher so the worker,
 * which finalizes Runs, never imports the Prototypes modules.
 */

/** The one launch token a Run's automatic Evaluation uses, so starting it again finds the first. */
export function templateEvaluationToken(assessment: Pick<Assessment, "publicId">): string {
  const hex = crypto.createHash("sha256").update(`template-evaluation:${assessment.publicId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Evaluates a finished Salt Patterns Run against the Releases it names, or
 * else the initiative's selected Releases, once. Other Runs, unfinished ones, and a Salt Patterns initiative
 * with no Release selected start nothing: templates then show Not evaluated.
 * A Release the Run can't be evaluated against (a digest or schema mismatch)
 * also starts nothing; the acceptance step reports why from the same checks.
 */
export function evaluateTemplateRun(db: Executor, assessment: Assessment): Evaluation | null {
  if (assessment.state !== "complete" && assessment.state !== "complete_with_issues") return null;
  const initiative = initiativeById(db, assessment.initiativeId);
  if (!initiative.systemOwned) return null;
  // A re-check's Run names the Releases its acceptance used; any other Run uses the initiative's selection.
  const pinned = evaluationReleasesOf(assessment);
  if (pinned === null && selectedReleases(db, initiative.id).length === 0) return null;
  try {
    return startEvaluation(db, initiative.publicId, assessment.publicId, templateEvaluationToken(assessment), pinned ? { releaseIds: pinned } : {}).evaluation;
  } catch (error) {
    if (error instanceof EvaluationStartError) return null;
    throw error;
  }
}
