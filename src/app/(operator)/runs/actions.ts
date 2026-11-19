"use server";

import { redirect } from "next/navigation";
import { findRun } from "@/lib/runs/run-records";
import { requestRunCancellation } from "@/lib/runs/waiting";
import { getDb } from "@/lib/db/client";
import { NotFoundError, TransitionError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { routes } from "@/lib/web/routes";

/** Records a durable cancellation request: targets still resolving stop at their next check, and those waiting on a survey stop now; the surveys run on. */
export async function cancelRun(runId: string): Promise<void> {
  const db = getDb();
  const run = isPublicId(runId, "asm") ? findRun(db, runId) : undefined;
  if (!run) throw new NotFoundError("Unknown Run");
  try {
    requestRunCancellation(db, run.id);
  } catch (error) {
    if (error instanceof TransitionError) redirect(routes.run(runId, { notice: "already-finished" }));
    throw error;
  }
  redirect(routes.run(runId, { notice: "cancel-requested" }));
}
