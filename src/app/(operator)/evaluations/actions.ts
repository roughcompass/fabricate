"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { EvaluationStartError, startEvaluation } from "@/lib/evaluations/start";
import { text } from "@/lib/web/form-data";
import type { LaunchState } from "../assessments/form-state";

/** Evaluates an existing Assessment against the Releases the Initiative selects now; resubmitting returns the same Evaluation. */
export async function startEvaluationAction(initiativePublicId: string, assessmentPublicId: string, _previous: LaunchState, formData: FormData): Promise<LaunchState> {
  if (!isPublicId(initiativePublicId, "ini") || !isPublicId(assessmentPublicId, "asm")) throw new NotFoundError("Unknown initiative or assessment");
  let location: string;
  try {
    const result = startEvaluation(getDb(), initiativePublicId, assessmentPublicId, text(formData, "launchToken", 40));
    location = `/evaluations/${result.evaluation.publicId}?notice=${result.duplicate ? "already-started" : "started"}`;
  } catch (error) {
    if (error instanceof EvaluationStartError) return { problems: error.problems };
    throw error;
  }
  redirect(location);
}
