"use server";

import { redirect } from "next/navigation";
import { findAssessment } from "@/lib/assessments/assessment-records";
import { cancelRun } from "@/lib/assessments/waiting";
import { getDb } from "@/lib/db/client";
import { NotFoundError, TransitionError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { routes } from "@/lib/web/routes";

/** Records a durable cancellation request: targets still resolving stop at their next check, and those waiting on a survey stop now; the surveys run on. */
export async function cancelAssessment(assessmentId: string): Promise<void> {
  const db = getDb();
  const assessment = isPublicId(assessmentId, "asm") ? findAssessment(db, assessmentId) : undefined;
  if (!assessment) throw new NotFoundError("Unknown assessment");
  try {
    cancelRun(db, assessment.id);
  } catch (error) {
    if (error instanceof TransitionError) redirect(routes.run(assessmentId, { notice: "already-finished" }));
    throw error;
  }
  redirect(routes.run(assessmentId, { notice: "cancel-requested" }));
}
