import { beforeEach, describe, expect, it } from "vitest";
import { assessmentNumber, assessmentNumbers } from "@/lib/assessments/assessment-records";
import type { Db } from "@/lib/db/client";
import { createEvaluation, evaluationNumber, evaluationNumbers } from "@/lib/evaluations/evaluation-records";
import { buildAssessment, buildInitiative, buildRelease, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";

describe("record sequence numbers", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    buildSource(db);
  });

  it("numbers Assessments from 1 within each Initiative and keeps the numbers as more start", () => {
    const first = buildInitiative(db);
    const second = buildInitiative(db);
    const a1 = buildAssessment(db, { initiative: first }).assessment;
    const b1 = buildAssessment(db, { initiative: second }).assessment;
    const a2 = buildAssessment(db, { initiative: first }).assessment;
    expect([assessmentNumber(db, a1), assessmentNumber(db, a2), assessmentNumber(db, b1)]).toEqual([1, 2, 1]);

    const a3 = buildAssessment(db, { initiative: first }).assessment;
    expect([assessmentNumber(db, a1), assessmentNumber(db, a2), assessmentNumber(db, a3)]).toEqual([1, 2, 3]);
    expect(assessmentNumbers(db, first.id)).toEqual(new Map([[a1.id, 1], [a2.id, 2], [a3.id, 3]]));
  });

  it("numbers Evaluations from 1 within each Initiative", () => {
    const initiative = buildInitiative(db);
    const assessment = buildAssessment(db, { initiative }).assessment;
    const evaluate = () =>
      createEvaluation(db, { initiative, assessment, launchToken: crypto.randomUUID(), evaluatorVersion: "1", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, coverageGaps: [], releases: [buildRelease(db)] }).evaluation;
    const e1 = evaluate();
    const e2 = evaluate();
    expect([evaluationNumber(db, e1), evaluationNumber(db, e2)]).toEqual([1, 2]);
    const e3 = evaluate();
    expect(evaluationNumbers(db, initiative.id)).toEqual(new Map([[e1.id, 1], [e2.id, 2], [e3.id, 3]]));
  });
});
