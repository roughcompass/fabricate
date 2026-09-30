import { eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { assessments } from "@/lib/db/schema";
import type { Assessment } from "./assessment-records";

/** An Assessment by its internal id, for jobs that hold a target or Evaluation row. */
export function assessmentById(db: Executor, id: number): Assessment {
  const assessment = db.select().from(assessments).where(eq(assessments.id, id)).get();
  if (!assessment) throw new NotFoundError(`Assessment ${id} does not exist`);
  return assessment;
}
