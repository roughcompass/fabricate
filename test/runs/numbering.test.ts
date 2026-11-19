import { beforeEach, describe, expect, it } from "vitest";
import { runNumber, runNumbers } from "@/lib/runs/run-records";
import type { Db } from "@/lib/db/client";
import { createEvaluation, evaluationNumber, evaluationNumbers } from "@/lib/evaluations/evaluation-records";
import { buildRun, buildAssessment, buildRelease, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";

describe("record sequence numbers", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    buildSource(db);
  });

  it("numbers Assessments from 1 within each Initiative and keeps the numbers as more start", () => {
    const first = buildAssessment(db);
    const second = buildAssessment(db);
    const a1 = buildRun(db, { assessment: first }).run;
    const b1 = buildRun(db, { assessment: second }).run;
    const a2 = buildRun(db, { assessment: first }).run;
    expect([runNumber(db, a1), runNumber(db, a2), runNumber(db, b1)]).toEqual([1, 2, 1]);

    const a3 = buildRun(db, { assessment: first }).run;
    expect([runNumber(db, a1), runNumber(db, a2), runNumber(db, a3)]).toEqual([1, 2, 3]);
    expect(runNumbers(db, first.id)).toEqual(new Map([[a1.id, 1], [a2.id, 2], [a3.id, 3]]));
  });

  it("numbers Evaluations from 1 within each Initiative", () => {
    const assessment = buildAssessment(db);
    const run = buildRun(db, { assessment }).run;
    const evaluate = () =>
      createEvaluation(db, { assessment, run, launchToken: crypto.randomUUID(), evaluatorVersion: "1", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, coverageGaps: [], releases: [buildRelease(db)] }).evaluation;
    const e1 = evaluate();
    const e2 = evaluate();
    expect([evaluationNumber(db, e1), evaluationNumber(db, e2)]).toEqual([1, 2]);
    const e3 = evaluate();
    expect(evaluationNumbers(db, assessment.id)).toEqual(new Map([[e1.id, 1], [e2.id, 2], [e3.id, 3]]));
  });
});
