import { describe, expect, it, vi } from "vitest";
import { conclusionCounts, latestConclusions } from "@/lib/evaluations/conclusions";
import { requestSurvey } from "@/lib/surveys/records";
import { buildRun, buildAssessment, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, driveEvaluation, driveRun } from "../support/home";

describe("latest conclusions", () => {
  it("reads each Assessment's latest completed Evaluation, so a later failure keeps the earlier conclusion (Conclusion from the latest completed Evaluation)", () => {
    const db = createTestDb();
    const assessment = buildAssessment(db, { repositories: [buildRepository(db)] });
    const run = driveRun(db, buildRun(db, { assessment }).run, "complete");
    driveEvaluation(db, buildEvaluation(db, assessment, run), "complete", "conforms");
    const second = driveEvaluation(db, buildEvaluation(db, assessment, run), "complete", "gaps");
    driveEvaluation(db, buildEvaluation(db, assessment, run), "failed");

    expect(latestConclusions(db).get(assessment.id)).toEqual({ evaluation: { id: second.id, publicId: second.publicId, number: 2 }, conclusion: "gaps" });
  });

  it("reports an Assessment with no completed Evaluation as none (Not evaluated)", () => {
    const db = createTestDb();
    const repository = buildRepository(db);
    const unevaluated = buildAssessment(db, { repositories: [repository] });
    const pending = buildAssessment(db, { repositories: [repository] });
    buildEvaluation(db, pending, driveRun(db, buildRun(db, { assessment: pending }).run, "complete"));

    const conclusions = latestConclusions(db);
    expect(conclusions.get(unevaluated.id)).toEqual({ evaluation: null, conclusion: "none" });
    expect(conclusions.get(pending.id)).toEqual({ evaluation: null, conclusion: "none" });
    expect(conclusionCounts(conclusions)).toEqual({ gaps: 0, undetermined: 0, conforms: 0, not_applicable: 0, none: 2 });
  });

  it("lists only operators' Assessments, background surveys adding none (No profiling Assessment)", () => {
    const db = createTestDb();
    const repository = buildRepository(db);
    const operator = buildAssessment(db, { repositories: [repository] });
    requestSurvey(db, { repositoryId: repository.id, commitSha: "a".repeat(40), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", surveyorRelease: "0.6.0", configurationDigest: "f".repeat(64), profileSchemaVersion: 2 });

    expect([...latestConclusions(db).keys()]).toEqual([operator.id]);
  });

  it("reads the conclusions as they stood at a time: Assessments created by then, and Evaluations completed by then", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 1) });
    const db = createTestDb();
    const assessment = buildAssessment(db, { repositories: [buildRepository(db)] });
    const run = driveRun(db, buildRun(db, { assessment }).run, "complete");
    driveEvaluation(db, buildEvaluation(db, assessment, run), "complete", "conforms");
    vi.setSystemTime(Date.UTC(2026, 9, 10));
    driveEvaluation(db, buildEvaluation(db, assessment, run), "complete", "gaps");
    buildAssessment(db, { repositories: [buildRepository(db)] });
    vi.useRealTimers();

    expect(conclusionCounts(latestConclusions(db, { at: new Date(Date.UTC(2026, 9, 5)) }))).toMatchObject({ conforms: 1, gaps: 0, none: 0 });
    expect(conclusionCounts(latestConclusions(db))).toMatchObject({ conforms: 0, gaps: 1, none: 1 });
  });
});
