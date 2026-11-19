import { cache } from "react";
import { type Run, runNumber, findRun } from "@/lib/runs/run-records";
import { type Executor, getDb } from "@/lib/db/client";
import { type Initiative, initiativeById } from "@/lib/initiatives/initiative-records";
import { type RunContext, runContext } from "@/lib/web/run-context";

export interface LoadedRun {
  db: Executor;
  run: Run;
  initiative: Initiative;
  number: number;
  context: RunContext;
}

/** A Run, its Assessment, its number, and where its pages sit, read once per request and shared by a page and its metadata. */
export const loadRun = cache((publicId: string): LoadedRun | undefined => {
  const db = getDb();
  const run = findRun(db, publicId);
  if (!run) return undefined;
  const initiative = initiativeById(db, run.initiativeId);
  const number = runNumber(db, run);
  return { db, run, initiative, number, context: runContext(initiative, number) };
});
