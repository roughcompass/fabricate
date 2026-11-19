import { eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { runs } from "@/lib/db/schema";
import type { Run } from "./run-records";

/** A Run by its internal id, for jobs that hold a target or Evaluation row. */
export function runById(db: Executor, id: number): Run {
  const run = db.select().from(runs).where(eq(runs.id, id)).get();
  if (!run) throw new NotFoundError(`Assessment ${id} does not exist`);
  return run;
}
