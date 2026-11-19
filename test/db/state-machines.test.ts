import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { advanceRun, requestCancellation, transitionRun, transitionTarget } from "@/lib/runs/transitions";
import type { Db } from "@/lib/db/client";
import { TransitionError } from "@/lib/db/errors";
import { runTargets, runs, evaluationReleases, evaluations } from "@/lib/db/schema";
import { activeStates, RUN_MACHINE, canTransition, EVALUATION_MACHINE, EVALUATION_RELEASE_MACHINE, isTerminal, pathsFromInitial, SURVEY_MACHINE, TARGET_MACHINE, type StateMachine } from "@/lib/db/state-machines";
import { createEvaluation } from "@/lib/evaluations/evaluation-records";
import { transitionEvaluation, transitionEvaluationRelease } from "@/lib/evaluations/transitions";
import { moveSurvey, requestSurvey, surveyById } from "@/lib/surveys/records";
import { buildRun, buildRelease, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { ACTIVE_STATES } from "@/lib/profiling/versions";

interface Harness {
  table: string;
  machine: StateMachine<string>;
  /** Creates a fresh row and returns its id. */
  create: (db: Db) => number;
  /** Extra columns a raw update needs to reach +state+ legally. */
  extra?: (state: string) => string;
  /** An update that changes nothing but a counter, to prove a terminal row is frozen. */
  touch?: string;
  /** Moves the row through the data-access layer. */
  transition: (db: Db, id: number, to: string) => unknown;
}

const summaryColumns = (state: string) => (state === "complete" ? `, summary = '{}', result_digest = '${"a".repeat(64)}'` : "");

const harnesses: Harness[] = [
  {
    table: "assessments",
    machine: RUN_MACHINE as StateMachine<string>,
    create: (db) => buildRun(db, { sources: [buildSource(db)] }).run.id,
    transition: (db, id, to) => transitionRun(db, db.select().from(runs).where(eq(runs.id, id)).get()!, to as never),
  },
  {
    table: "assessment_targets",
    machine: TARGET_MACHINE as StateMachine<string>,
    // With a survey of its Repository to link, as resolving its reference does.
    create: (db) => {
      const source = buildSource(db);
      newSurvey(db, source.id);
      return buildRun(db, { sources: [source] }).targets[0]!.id;
    },
    // A target moves to analyzing when it links its survey, which completing requires.
    extra: (state) =>
      state === "failed"
        ? ", failure_code = 'test'"
        : state === "analyzing"
          ? ", failure_code = NULL, ref_kind = 'default_branch', resolved_ref = 'refs/heads/main', resolved_at = 1, survey_id = (select id from surveys where repository_source_id = assessment_targets.repository_source_id)"
          : ", failure_code = NULL",
    transition: (db, id, to) =>
      transitionTarget(db, db.select().from(runTargets).where(eq(runTargets.id, id)).get()!, to as never, { failureCode: "unexpected" }),
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
  {
    table: "surveys",
    machine: SURVEY_MACHINE as StateMachine<string>,
    // Each on a Repository of its own, so its number is 1.
    create: (db) => newSurvey(db, buildSource(db).id).id,
    extra: (state) => (state === "failed" ? ", failure_code = 'test', finished_at = 1" : state === "succeeded" ? ", finished_at = 1, internal_ref = 'refs/fabricate/snapshots/srv_test'" : ", finished_at = NULL"),
    touch: "attempts = attempts + 1",
    transition: (db, id, to) => moveSurvey(db, surveyById(db, id), to as never, to === "failed" ? { failureCode: "unexpected" } : to === "succeeded" ? { internalRef: "refs/fabricate/snapshots/srv_test" } : {}),
  },
];

/** A queued survey of a commit of the Repository +repositorySourceId+. */
function newSurvey(db: Db, repositorySourceId: number) {
  return requestSurvey(db, { repositorySourceId, commitSha: "a".repeat(40), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "manual", surveyorRelease: "0.6.0", configurationDigest: "f".repeat(64), profileSchemaVersion: 2 }).survey;
}

function newEvaluation(db: Db) {
  const { run } = buildRun(db, { sources: [buildSource(db)] });
  return createEvaluation(db, {
    assessment: { id: run.assessmentId } as never,
    run,
    launchToken: crypto.randomUUID(),
    evaluatorVersion: "test",
    configuration: {},
    profileSchemaVersion: 1,
    relationshipSchemaVersion: 1,
    coverageGaps: [],
    releases: [buildRelease(db)],
  });
}

describe.each(harnesses)("$table state machine", ({ table, machine, create, extra, touch = "lock_version = lock_version + 1", transition }) => {
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

    expect(() => rawRun(db, `update ${table} set ${touch} where id = ?`, id)).toThrow(/terminal .* cannot change/);
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
    if ("number" in copy) copy.number = Number(copy.number) + 1;
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
    const { run } = buildRun(db, { sources: [buildSource(db)] });

    expect(advanceRun(db, run.id, "acquiring").state).toBe("acquiring");
    expect(advanceRun(db, run.id, "analyzing").state).toBe("analyzing");
    expect(advanceRun(db, run.id, "acquiring").state).toBe("analyzing");
    expect(advanceRun(db, run.id, "analyzing").startedAt).toBeInstanceOf(Date);
  });

  it("records timestamps on start and on terminal states", () => {
    const { run, targets } = buildRun(db, { sources: [buildSource(db)] });
    const acquiring = transitionTarget(db, targets[0]!, "acquiring");
    const failed = transitionTarget(db, acquiring, "failed", { failureCode: "source_unavailable", failureMessage: "https://user:secret@example.com unreachable" });

    expect(acquiring.startedAt).toBeInstanceOf(Date);
    expect(failed.finishedAt).toBeInstanceOf(Date);
    expect(failed.failureMessage).not.toContain("secret");
    expect(() => transitionTarget(db, targets[0]!, "failed")).toThrow(TransitionError);
    expect(transitionRun(db, run, "failed", { failureReason: "no target" }).finishedAt).toBeInstanceOf(Date);
  });

  it("records a durable, idempotent cancellation request and refuses it once terminal", () => {
    const { run } = buildRun(db, { sources: [buildSource(db)] });
    const requested = requestCancellation(db, run.id);

    expect(requested.cancelRequestedAt).toBeInstanceOf(Date);
    expect(requestCancellation(db, run.id).cancelRequestedAt).toEqual(requested.cancelRequestedAt);
    transitionRun(db, requestCancellation(db, run.id), "canceled");
    expect(() => requestCancellation(db, run.id)).toThrow(/cannot be canceled/);
  });

  it("refuses a stale write when the state changed underneath the caller", () => {
    const { run } = buildRun(db, { sources: [buildSource(db)] });
    transitionRun(db, run, "acquiring");

    expect(() => transitionRun(db, run, "failed")).toThrow(/changed while moving/);
  });

  it("requires a summary and result digest to complete an Evaluation", () => {
    const { evaluation } = newEvaluation(db);
    const finalizing = transitionEvaluation(db, transitionEvaluation(db, evaluation, "evaluating"), "finalizing");

    expect(() => transitionEvaluation(db, finalizing, "complete")).toThrow(/summary and result digest/);
  });
});

describe("active states", () => {
  it("are derived from the state machine: every state a Run moves on from", () => {
    expect(activeStates(RUN_MACHINE)).toEqual(["queued", "acquiring", "analyzing", "finalizing"]);
    for (const state of activeStates(RUN_MACHINE)) expect(isTerminal(RUN_MACHINE, state), state).toBe(false);
  });

  it("count a survey as on its way while it moves on toward a result: not once it failed, which waits for a retry", () => {
    expect(activeStates(SURVEY_MACHINE)).toEqual(["queued", "running", "failed"]);
    expect(ACTIVE_STATES).toEqual(activeStates(SURVEY_MACHINE).filter((state) => state !== "failed"));
  });
});
