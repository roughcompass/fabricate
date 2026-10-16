import crypto from "node:crypto";
import type { Assessment } from "@/lib/assessments/assessment-records";
import { transitionAssessment, transitionTarget } from "@/lib/assessments/transitions";
import { targetsOf } from "@/lib/assessments/assessment-records";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Executor } from "@/lib/db/client";
import { ASSESSMENT_MACHINE, EVALUATION_MACHINE, pathsFromInitial } from "@/lib/db/state-machines";
import type { AssessmentState, EvaluationState } from "@/lib/db/schema";
import { type Evaluation, createEvaluation } from "@/lib/evaluations/evaluation-records";
import { transitionEvaluation } from "@/lib/evaluations/transitions";
import type { Conclusion } from "@/lib/evaluations/summary";
import type { Initiative } from "@/lib/initiatives/initiative-records";
import { parseDeConsoleExport, recordDeConsoleRead } from "@/lib/ownership/de-console";
import { type Application, createApplication, recordAssertion } from "@/lib/ownership/records";
import { buildRelease } from "./builders";

/*
 * Builders for Home's fixtures: Runs and Evaluations driven to a final state
 * through their state machines, claims, and DE Console reads.
 */

const RUN_PATHS = pathsFromInitial(ASSESSMENT_MACHINE);
const EVALUATION_PATHS = pathsFromInitial(EVALUATION_MACHINE);

/** Moves a Run through its state machine to +to+. With complete_with_issues, the first +failedTargets+ targets fail first. */
export function driveRun(db: Executor, run: Assessment, to: AssessmentState, options: { failedTargets?: number } = {}): Assessment {
  for (const target of targetsOf(db, run.id).slice(0, options.failedTargets ?? 0)) {
    transitionTarget(db, target, "failed", { failureCode: "authentication_failed", failureMessage: "Could not read the repository" });
  }
  let current = run;
  for (const state of RUN_PATHS.get(to)!.slice(1)) current = transitionAssessment(db, current, state);
  return current;
}

/** An Evaluation of +run+ against a new Release, written directly without launching jobs. */
export function buildEvaluation(db: Executor, initiative: Initiative, run: Assessment): Evaluation {
  return createEvaluation(db, { initiative, assessment: run, launchToken: crypto.randomUUID(), evaluatorVersion: "1", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, coverageGaps: [], releases: [buildRelease(db)] }).evaluation;
}

/** Moves an Evaluation to +to+; a completed one records a summary with +conclusion+. */
export function driveEvaluation(db: Executor, evaluation: Evaluation, to: EvaluationState, conclusion: Conclusion = "conforms"): Evaluation {
  let current = evaluation;
  for (const state of EVALUATION_PATHS.get(to)!.slice(1)) {
    current = transitionEvaluation(db, current, state, state === "complete" ? { summary: JSON.stringify({ combined: { conclusion } }), resultDigest: "0".repeat(64) } : {});
  }
  return current;
}

/** Records a person's claim that +source+ belongs to +application+ (a new SEAL application by default). */
export function claim(db: Executor, source: RepositorySource, options: { application?: Application; providedBy?: string; supersedes?: number[] } = {}) {
  const application = options.application ?? createApplication(db, { sealId: String(10_000 + source.id) });
  const assertion = recordAssertion(db, { attribute: "application", repository: source.id, application: application.id, providedBy: options.providedBy ?? "Ana", source: "person", supersedes: options.supersedes });
  return { application, assertion };
}

/** Records a successful DE Console read of a version 1 export. */
export function readDeConsole(db: Executor, applications: object[], readAt: Date) {
  return recordDeConsoleRead(db, parseDeConsoleExport({ format: "de-console-ownership", version: 1, exported_at: null, applications }), { trigger: "schedule", readAt });
}
