import { cache } from "react";
import { type Assessment, assessmentNumber, findAssessment } from "@/lib/assessments/assessment-records";
import { type Executor, getDb } from "@/lib/db/client";
import { type Initiative, initiativeById } from "@/lib/initiatives/initiative-records";
import { type RunContext, runContext } from "@/lib/web/run-context";

export interface LoadedRun {
  db: Executor;
  assessment: Assessment;
  initiative: Initiative;
  number: number;
  context: RunContext;
}

/** A Run, its Assessment, its number, and where its pages sit, read once per request and shared by a page and its metadata. */
export const loadRun = cache((publicId: string): LoadedRun | undefined => {
  const db = getDb();
  const assessment = findAssessment(db, publicId);
  if (!assessment) return undefined;
  const initiative = initiativeById(db, assessment.initiativeId);
  const number = assessmentNumber(db, assessment);
  return { db, assessment, initiative, number, context: runContext(db, assessment, initiative, number) };
});
