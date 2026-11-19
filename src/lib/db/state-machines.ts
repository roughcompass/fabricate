import { TransitionError } from "./errors";
import type { AssessmentState, EvaluationReleaseState, EvaluationState, SurveyState, TargetState } from "./schema";

/**
 * Allowed state transitions for every run record. These tables are the
 * source of truth: the data-access layer checks them before writing, and the
 * triggers in drizzle/0010_state_machines.sql enforce the same graph for
 * direct SQL. A terminal record never changes again.
 */
export interface StateMachine<S extends string> {
  readonly name: string;
  readonly initial: S;
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  readonly terminal: readonly S[];
}

export const ASSESSMENT_MACHINE: StateMachine<AssessmentState> = {
  name: "Assessment",
  initial: "queued",
  transitions: {
    queued: ["acquiring", "finalizing", "canceled", "failed"],
    acquiring: ["analyzing", "finalizing", "canceled", "failed"],
    analyzing: ["finalizing", "canceled", "failed"],
    finalizing: ["complete", "complete_with_issues", "failed", "canceled"],
    complete: [],
    complete_with_issues: [],
    failed: [],
    canceled: [],
  },
  terminal: ["complete", "complete_with_issues", "failed", "canceled"],
};

export const TARGET_MACHINE: StateMachine<TargetState> = {
  name: "Assessment target",
  initial: "pending",
  transitions: {
    pending: ["acquiring", "canceled", "failed"],
    acquiring: ["analyzing", "canceled", "failed"],
    analyzing: ["complete", "canceled", "failed"],
    complete: [],
    failed: [],
    canceled: [],
  },
  terminal: ["complete", "failed", "canceled"],
};

export const EVALUATION_MACHINE: StateMachine<EvaluationState> = {
  name: "Evaluation",
  initial: "queued",
  transitions: {
    queued: ["evaluating", "failed"],
    evaluating: ["finalizing", "failed"],
    finalizing: ["complete", "failed"],
    complete: [],
    failed: [],
  },
  terminal: ["complete", "failed"],
};

export const EVALUATION_RELEASE_MACHINE: StateMachine<EvaluationReleaseState> = {
  name: "Evaluation Release",
  initial: "pending",
  transitions: {
    pending: ["evaluating", "failed"],
    evaluating: ["complete", "failed"],
    complete: [],
    failed: [],
  },
  terminal: ["complete", "failed"],
};

/** A survey (unify-surveys, decision 1). A failed survey is retried in place, so only success is final. */
export const SURVEY_MACHINE: StateMachine<SurveyState> = {
  name: "Survey",
  initial: "queued",
  transitions: {
    queued: ["running", "failed"],
    running: ["succeeded", "failed"],
    succeeded: [],
    failed: ["queued"],
  },
  terminal: ["succeeded"],
};

/** The states a record moves on from: every state but the terminal ones, in the machine's order. */
export function activeStates<S extends string>(machine: StateMachine<S>): S[] {
  return (Object.keys(machine.transitions) as S[]).filter((state) => !machine.terminal.includes(state));
}

export function isTerminal<S extends string>(machine: StateMachine<S>, state: S): boolean {
  return machine.terminal.includes(state);
}

export function canTransition<S extends string>(machine: StateMachine<S>, from: S, to: S): boolean {
  return machine.transitions[from].includes(to);
}

/** Throws unless +from+ may move to +to+. */
export function assertTransition<S extends string>(machine: StateMachine<S>, from: S, to: S, label: string): void {
  if (isTerminal(machine, from)) throw new TransitionError(`${label} is ${from} and cannot change`);
  if (!canTransition(machine, from, to)) throw new TransitionError(`${label} cannot move from ${from} to ${to}`);
}

/** Every state reachable from the initial state, with the path that reaches it.
 * @public Tests check the triggers against every path.
 */
export function pathsFromInitial<S extends string>(machine: StateMachine<S>): Map<S, S[]> {
  const paths = new Map<S, S[]>([[machine.initial, [machine.initial]]]);
  const queue: S[] = [machine.initial];
  while (queue.length) {
    const state = queue.shift()!;
    for (const next of machine.transitions[state]) {
      if (!paths.has(next)) {
        paths.set(next, [...paths.get(state)!, next]);
        queue.push(next);
      }
    }
  }
  return paths;
}
