"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { requirePublicId } from "@/lib/db/ids";
import { EvaluationStartError, startEvaluation } from "@/lib/evaluations/start";
import { text } from "@/lib/web/form-data";
import type { LaunchState } from "../assessments/form-state";
import { routes } from "@/lib/web/routes";

/** Evaluates an existing Run against the Releases its Assessment selects now; resubmitting returns the same Evaluation. */
export async function startEvaluationAction(assessmentPublicId: string, runPublicId: string, _previous: LaunchState, formData: FormData): Promise<LaunchState> {
  requirePublicId(assessmentPublicId, "ini", "Assessment");
  requirePublicId(runPublicId, "asm", "Run");
  let location: string;
  try {
    const result = startEvaluation(getDb(), assessmentPublicId, runPublicId, text(formData, "launchToken", 40));
    location = routes.evaluation(result.evaluation.publicId, { notice: result.duplicate ? "already-started" : "started" });
  } catch (error) {
    if (error instanceof EvaluationStartError) return { problems: error.problems };
    throw error;
  }
  redirect(location);
}
