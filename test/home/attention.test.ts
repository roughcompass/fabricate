import { afterEach, describe, expect, it, vi } from "vitest";
import { attentionItems } from "@/lib/home/attention";
import { buildRun, buildAssessment, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, driveEvaluation, driveRun } from "../support/home";

describe("Needs attention", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists an Assessment whose latest Run failed, with its number and Assessment (Failed Run)", () => {
    const db = createTestDb();
    const repository = buildRepository(db);
    const assessment = buildAssessment(db, { name: "Checkout platform migration", repositories: [repository] });
    for (let i = 0; i < 3; i++) driveRun(db, buildRun(db, { assessment }).run, "complete");
    const failed = driveRun(db, buildRun(db, { assessment }).run, "failed");

    expect(attentionItems(db)).toEqual([
      { kind: "run_failed", since: failed.finishedAt, assessment: { publicId: assessment.publicId, name: "Checkout platform migration" }, run: { publicId: failed.publicId, number: 4 } },
    ]);
  });

  it("drops a failure that a later Run replaced (Failure replaced by a later Run)", () => {
    const db = createTestDb();
    const assessment = buildAssessment(db, { repositories: [buildRepository(db)] });
    driveRun(db, buildRun(db, { assessment }).run, "failed");
    driveRun(db, buildRun(db, { assessment }).run, "complete");

    expect(attentionItems(db)).toEqual([]);
  });

  it("counts the Repositories a Run with issues couldn't assess (Run that couldn't assess every Repository)", () => {
    const db = createTestDb();
    const repositories = Array.from({ length: 5 }, () => buildRepository(db));
    const assessment = buildAssessment(db, { repositories });
    driveRun(db, buildRun(db, { assessment }).run, "complete_with_issues", { failedTargets: 3 });

    expect(attentionItems(db)).toMatchObject([{ kind: "run_with_issues", unassessed: 3, run: { number: 1 } }]);
  });

  it("lists a failed latest Evaluation", () => {
    const db = createTestDb();
    const assessment = buildAssessment(db, { repositories: [buildRepository(db)] });
    const run = driveRun(db, buildRun(db, { assessment }).run, "complete");
    driveEvaluation(db, buildEvaluation(db, assessment, run), "complete", "gaps");
    const failed = driveEvaluation(db, buildEvaluation(db, assessment, run), "failed");

    expect(attentionItems(db)).toEqual([{ kind: "evaluation_failed", since: failed.finishedAt, assessment: { publicId: assessment.publicId, name: assessment.name }, evaluation: { publicId: failed.publicId, number: 2 } }]);
  });

  it("orders items newest first", () => {
    const db = createTestDb();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 15, 12, 0) });
    const failing = buildAssessment(db, { repositories: [buildRepository(db)] });
    driveRun(db, buildRun(db, { assessment: failing }).run, "failed");
    vi.setSystemTime(Date.UTC(2026, 9, 15, 12, 1));
    const evaluated = buildAssessment(db, { repositories: [buildRepository(db)] });
    const run = driveRun(db, buildRun(db, { assessment: evaluated }).run, "complete");
    driveEvaluation(db, buildEvaluation(db, evaluated, run), "failed");

    expect(attentionItems(db).map((item) => item.kind)).toEqual(["evaluation_failed", "run_failed"]);
  });

  it("lists the newer of two problems that began in the same millisecond first", () => {
    const db = createTestDb();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 15, 12, 0) });
    const names = ["Assessment 04", "Assessment 05"];
    for (const name of names) driveRun(db, buildRun(db, { assessment: buildAssessment(db, { name, repositories: [buildRepository(db)] }) }).run, "failed");

    expect(attentionItems(db).map((item) => item.assessment.name)).toEqual(["Assessment 05", "Assessment 04"]);
  });
});
