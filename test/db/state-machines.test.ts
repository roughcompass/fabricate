import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { advanceAssessment, requestCancellation, transitionAssessment, transitionTarget } from "@/lib/assessments/transitions";
import type { Db } from "@/lib/db/client";
import { TransitionError } from "@/lib/db/errors";
import { assessmentTargets, assessments, evaluationReleases, evaluations } from "@/lib/db/schema";
import { activeStates, ASSESSMENT_MACHINE, canTransition, EVALUATION_MACHINE, EVALUATION_RELEASE_MACHINE, isTerminal, pathsFromInitial, TARGET_MACHINE, type StateMachine } from "@/lib/db/state-machines";
import { createEvaluation } from "@/lib/evaluations/evaluation-records";
import { transitionEvaluation, transitionEvaluationRelease } from "@/lib/evaluations/transitions";
import { buildAssessment, buildRelease, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { ACTIVE_STATES } from "@/lib/profiling/versions";

interface Harness {
  table: string;
  machine: StateMachine<string>;
  /** Creates a fresh row and returns its id. */
  create: (db: Db) => number;
  /** Extra columns a raw update needs to reach +state+ legally. */
  extra?: (state: string) => string;
  /** Moves the row through the data-access layer. */
  transition: (db: Db, id: number, to: string) => unknown;
}

const summaryColumns = (state: string) => (state === "complete" ? `, summary = '{}', result_digest = '${"a".repeat(64)}'` : "");

const harnesses: Harness[] = [
  {
    table: "assessments",
    machine: ASSESSMENT_MACHINE as StateMachine<string>,
    create: (db) => buildAssessment(db, { sources: [buildSource(db)] }).assessment.id,
    transition: (db, id, to) => transitionAssessment(db, db.select().from(assessments).where(eq(assessments.id, id)).get()!, to as never),
  },
  {
    table: "assessment_targets",
    machine: TARGET_MACHINE as StateMachine<string>,
    create: (db) => buildAssessment(db, { sources: [buildSource(db)] }).targets[0]!.id,
    extra: (state) => (state === "failed" ? ", failure_code = 'test'" : ", failure_code = NULL"),
    transition: (db, id, to) =>
      transitionTarget(db, db.select().from(assessmentTargets).where(eq(assessmentTargets.id, id)).get()!, to as never, { failureCode: "unexpected" }),
  },
  {
    table: "evaluations",
    machine: EVALUATION_MACHINE as StateMachine<string>,
    create: (db) => newEvaluation(db).evaluation.id,
    extra: summaryColumns,
    transition: (db, id, to) =>
      transitionEvaluation(db, db.select().from(evaluations).where(eq(evaluations.id, id)).get()!, to as never, { summary: "{}", resultDigest: "a".repeat(64) }),
  },
  {
    table: "evaluation_releases",
    machine: EVALUATION_RELEASE_MACHINE as StateMachine<string>,
    create: (db) => newEvaluation(db).releases[0]!.id,
    transition: (db, id, to) => transitionEvaluationRelease(db, db.select().from(evaluationReleases).where(eq(evaluationReleases.id, id)).get()!, to as never),
  },
];

function newEvaluation(db: Db) {
  const { assessment } = buildAssessment(db, { sources: [buildSource(db)] });
  return createEvaluation(db, {
    initiative: { id: assessment.initiativeId } as never,
    assessment,
    launchToken: crypto.randomUUID(),
    evaluatorVersion: "test",
    configuration: {},
    profileSchemaVersion: 1,
    relationshipSchemaVersion: 1,
    coverageGaps: [],
    releases: [buildRelease(db)],
  });
}

describe.each(harnesses)("$table state machine", ({ table, machine, create, extra, transition }) => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const states = Object.keys(machine.transitions);
  const paths = pathsFromInitial(machine);
  const rawMove = (id: number, state: string) => rawRun(db, `update ${table} set state = ?${extra?.(state) ?? ""} where id = ?`, state, id);
  const rowAt = (state: string) => {
    const id = create(db);
    for (const step of paths.get(state)!.slice(1)) rawMove(id, step);
    return id;
  };

  it("reaches every state from the initial state", () => {
    expect([...paths.keys()].sort()).toEqual([...states].sort());
  });

  const pairs = states.flatMap((from) => states.filter((to) => to !== from).map((to) => [from, to] as const));

  it.each(pairs)("direct SQL: %s -> %s follows the machine", (from, to) => {
    const id = rowAt(from);
    const allowed = canTransition(machine, from, to);

    if (allowed) expect(() => rawMove(id, to)).not.toThrow();
    else expect(() => rawMove(id, to)).toThrow(isTerminal(machine, from) ? /terminal .* cannot change/ : /state transition is not allowed/);
  });

  it.each(pairs)("data access: %s -> %s follows the machine", (from, to) => {
    const id = rowAt(from);

    if (canTransition(machine, from, to)) expect(() => transition(db, id, to)).not.toThrow();
    else expect(() => transition(db, id, to)).toThrow(TransitionError);
  });

  it.each(machine.terminal)("rejects any update once %s", (terminal) => {
    const id = rowAt(terminal);

    expect(() => rawRun(db, `update ${table} set lock_version = lock_version + 1 where id = ?`, id)).toThrow(/terminal .* cannot change/);
  });

  it("rejects rows that do not start in the initial state", () => {
    const id = create(db);
    const other = states.find((state) => state !== machine.initial)!;
    const copy = db.$client.prepare(`select * from ${table} where id = ?`).get(id) as Record<string, unknown>;
    delete copy.id;
    copy.state = other;
    if ("public_id" in copy) copy.public_id = `${String(copy.public_id).slice(0, 4)}zzzzzzzzzzzzzzzz`;
    if ("launch_token" in copy) copy.launch_token = crypto.randomUUID();
    if ("position" in copy) copy.position = 99;
    const columns = Object.keys(copy);

    expect(() => rawRun(db, `insert into ${table} (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`, ...Object.values(copy))).toThrow(
      /start|frozen|pinned/,
    );
  });
});

describe("aggregate progress and cancellation", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("advances the aggregate state forward and never regresses", () => {
    const { assessment } = buildAssessment(db, { sources: [buildSource(db)] });

    expect(advanceAssessment(db, assessment.id, "acquiring").state).toBe("acquiring");
    expect(advanceAssessment(db, assessment.id, "analyzing").state).toBe("analyzing");
    expect(advanceAssessment(db, assessment.id, "acquiring").state).toBe("analyzing");
    expect(advanceAssessment(db, assessment.id, "analyzing").startedAt).toBeInstanceOf(Date);
  });

  it("records timestamps on start and on terminal states", () => {
    const { assessment, targets } = buildAssessment(db, { sources: [buildSource(db)] });
    const acquiring = transitionTarget(db, targets[0]!, "acquiring");
    const failed = transitionTarget(db, acquiring, "failed", { failureCode: "source_unavailable", failureMessage: "https://user:secret@example.com unreachable" });

    expect(acquiring.startedAt).toBeInstanceOf(Date);
    expect(failed.finishedAt).toBeInstanceOf(Date);
    expect(failed.failureMessage).not.toContain("secret");
    expect(() => transitionTarget(db, targets[0]!, "failed")).toThrow(TransitionError);
    expect(transitionAssessment(db, assessment, "failed", { failureReason: "no target" }).finishedAt).toBeInstanceOf(Date);
  });

  it("records a durable, idempotent cancellation request and refuses it once terminal", () => {
    const { assessment } = buildAssessment(db, { sources: [buildSource(db)] });
    const requested = requestCancellation(db, assessment.id);

    expect(requested.cancelRequestedAt).toBeInstanceOf(Date);
    expect(requestCancellation(db, assessment.id).cancelRequestedAt).toEqual(requested.cancelRequestedAt);
    transitionAssessment(db, requestCancellation(db, assessment.id), "canceled");
    expect(() => requestCancellation(db, assessment.id)).toThrow(/cannot be canceled/);
  });

  it("refuses a stale write when the state changed underneath the caller", () => {
    const { assessment } = buildAssessment(db, { sources: [buildSource(db)] });
    transitionAssessment(db, assessment, "acquiring");

    expect(() => transitionAssessment(db, assessment, "failed")).toThrow(/changed while moving/);
  });

  it("requires a summary and result digest to complete an Evaluation", () => {
    const { evaluation } = newEvaluation(db);
    const finalizing = transitionEvaluation(db, transitionEvaluation(db, evaluation, "evaluating"), "finalizing");

    expect(() => transitionEvaluation(db, finalizing, "complete")).toThrow(/summary and result digest/);
  });
});

describe("active states", () => {
  it("are derived from the state machine: every state a Run moves on from", () => {
    expect(activeStates(ASSESSMENT_MACHINE)).toEqual(["queued", "acquiring", "analyzing", "finalizing"]);
    expect(ACTIVE_STATES).toEqual(activeStates(ASSESSMENT_MACHINE));
    for (const state of ACTIVE_STATES) expect(isTerminal(ASSESSMENT_MACHINE, state), state).toBe(false);
  });
});
