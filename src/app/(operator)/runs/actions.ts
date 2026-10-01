"use server";

import { redirect } from "next/navigation";
import { findAssessment } from "@/lib/assessments/assessment-records";
import { requestCancellation } from "@/lib/assessments/transitions";
import { getDb } from "@/lib/db/client";
import { NotFoundError, TransitionError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";

/** Records a durable cancellation request; running jobs stop at their next check. */
export async function cancelAssessment(assessmentId: string): Promise<void> {
  const db = getDb();
  const assessment = isPublicId(assessmentId, "asm") ? findAssessment(db, assessmentId) : undefined;
  if (!assessment) throw new NotFoundError("Unknown assessment");
  try {
    requestCancellation(db, assessment.id);
  } catch (error) {
    if (error instanceof TransitionError) redirect(`/runs/${assessmentId}?notice=already-finished`);
    throw error;
  }
  redirect(`/runs/${assessmentId}?notice=cancel-requested`);
}
