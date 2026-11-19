import crypto from "node:crypto";
import type { Run } from "@/lib/runs/run-records";
import { transitionRun, transitionTarget } from "@/lib/runs/transitions";
import { targetsOf } from "@/lib/runs/run-records";
import type { Executor } from "@/lib/db/client";
import { RUN_MACHINE, EVALUATION_MACHINE, pathsFromInitial } from "@/lib/db/state-machines";
import type { RunState, EvaluationState } from "@/lib/db/schema";
import { type Evaluation, createEvaluation } from "@/lib/evaluations/evaluation-records";
import { transitionEvaluation } from "@/lib/evaluations/transitions";
import type { Conclusion } from "@/lib/evaluations/summary";
import type { Assessment } from "@/lib/assessments/assessment-records";
import { buildRelease } from "./builders";

/*
 * Builders for Home's fixtures: Runs and Evaluations driven to a final state
 * through their state machines.
 */

const RUN_PATHS = pathsFromInitial(RUN_MACHINE);
const EVALUATION_PATHS = pathsFromInitial(EVALUATION_MACHINE);

/** Moves a Run through its state machine to +to+. With complete_with_issues, the first +failedTargets+ targets fail first. */
export function driveRun(db: Executor, run: Run, to: RunState, options: { failedTargets?: number } = {}): Run {
  for (const target of targetsOf(db, run.id).slice(0, options.failedTargets ?? 0)) {
    transitionTarget(db, target, "failed", { failureCode: "authentication_failed", failureMessage: "Could not read the repository" });
  }
  let current = run;
  for (const state of RUN_PATHS.get(to)!.slice(1)) current = transitionRun(db, current, state);
  return current;
}

/** An Evaluation of +run+ against a new Release, written directly without launching jobs. */
export function buildEvaluation(db: Executor, assessment: Assessment, run: Run): Evaluation {
  return createEvaluation(db, { assessment, run, launchToken: crypto.randomUUID(), evaluatorVersion: "1", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, coverageGaps: [], releases: [buildRelease(db)] }).evaluation;
}

/** Moves an Evaluation to +to+; a completed one records a summary with +conclusion+. */
export function driveEvaluation(db: Executor, evaluation: Evaluation, to: EvaluationState, conclusion: Conclusion = "conforms"): Evaluation {
  let current = evaluation;
  for (const state of EVALUATION_PATHS.get(to)!.slice(1)) {
    current = transitionEvaluation(db, current, state, state === "complete" ? { summary: JSON.stringify({ combined: { conclusion } }), resultDigest: "0".repeat(64) } : {});
  }
  return current;
}
