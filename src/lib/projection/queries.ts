import { and, asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { runTargets } from "@/lib/db/schema";

/*
 * Questions answered from the projection and the Run's own records. None of
 * these reads a stored Profile or Relationship Map document, so each stays
 * cheap at 200 to 500 repositories.
 */

/** A target in scope that has no facts in the projection, and why. */
export interface MissingTarget {
  target: string;
  source: string;
  state: "failed" | "canceled";
  reason: string | null;
}

/**
 * Targets of the Assessment that failed or were canceled, which contribute
 * no Profile even when a survey they shared later succeeds, with their
 * failure codes, so no answer reads their absence as
 * "no". They're the gaps its Relationship Map records.
 */
export function missingTargets(db: Executor, runId: number): MissingTarget[] {
  return db
    .select({ target: runTargets.publicId, source: runTargets.repositoryName, state: runTargets.state, reason: runTargets.failureCode })
    .from(runTargets)
    .where(and(eq(runTargets.runId, runId), inArray(runTargets.state, ["failed", "canceled"])))
    .orderBy(asc(runTargets.position))
    .all() as MissingTarget[];
}
