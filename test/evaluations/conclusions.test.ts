import { describe, expect, it, vi } from "vitest";
import { conclusionCounts, latestConclusions } from "@/lib/evaluations/conclusions";
import { requestSurvey } from "@/lib/surveys/records";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, driveEvaluation, driveRun } from "../support/home";

describe("latest conclusions", () => {
  it("reads each Assessment's latest completed Evaluation, so a later failure keeps the earlier conclusion (Conclusion from the latest completed Evaluation)", () => {
    const db = createTestDb();
    const initiative = buildInitiative(db, { sources: [buildSource(db)] });
    const run = driveRun(db, buildAssessment(db, { initiative }).assessment, "complete");
    driveEvaluation(db, buildEvaluation(db, initiative, run), "complete", "conforms");
    const second = driveEvaluation(db, buildEvaluation(db, initiative, run), "complete", "gaps");
    driveEvaluation(db, buildEvaluation(db, initiative, run), "failed");

    expect(latestConclusions(db).get(initiative.id)).toEqual({ evaluation: { id: second.id, publicId: second.publicId, number: 2 }, conclusion: "gaps" });
  });

  it("reports an Assessment with no completed Evaluation as none (Not evaluated)", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const unevaluated = buildInitiative(db, { sources: [source] });
    const pending = buildInitiative(db, { sources: [source] });
    buildEvaluation(db, pending, driveRun(db, buildAssessment(db, { initiative: pending }).assessment, "complete"));

    const conclusions = latestConclusions(db);
    expect(conclusions.get(unevaluated.id)).toEqual({ evaluation: null, conclusion: "none" });
    expect(conclusions.get(pending.id)).toEqual({ evaluation: null, conclusion: "none" });
    expect(conclusionCounts(conclusions)).toEqual({ gaps: 0, undetermined: 0, conforms: 0, not_applicable: 0, none: 2 });
  });

  it("lists only operators' Assessments, background surveys adding none (No profiling Assessment)", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const operator = buildInitiative(db, { sources: [source] });
    requestSurvey(db, { repositorySourceId: source.id, commitSha: "a".repeat(40), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", surveyorRelease: "0.6.0", configurationDigest: "f".repeat(64), profileSchemaVersion: 2 });

    expect([...latestConclusions(db).keys()]).toEqual([operator.id]);
  });

  it("reads the conclusions as they stood at a time: Assessments created by then, and Evaluations completed by then", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 1) });
    const db = createTestDb();
    const initiative = buildInitiative(db, { sources: [buildSource(db)] });
    const run = driveRun(db, buildAssessment(db, { initiative }).assessment, "complete");
    driveEvaluation(db, buildEvaluation(db, initiative, run), "complete", "conforms");
    vi.setSystemTime(Date.UTC(2026, 9, 10));
    driveEvaluation(db, buildEvaluation(db, initiative, run), "complete", "gaps");
    buildInitiative(db, { sources: [buildSource(db)] });
    vi.useRealTimers();

    expect(conclusionCounts(latestConclusions(db, { at: new Date(Date.UTC(2026, 9, 5)) }))).toMatchObject({ conforms: 1, gaps: 0, none: 0 });
    expect(conclusionCounts(latestConclusions(db))).toMatchObject({ conforms: 0, gaps: 1, none: 1 });
  });
});
