import { describe, expect, it } from "vitest";
import { conclusionCounts, latestConclusions } from "@/lib/evaluations/conclusions";
import { claimInitiative } from "@/lib/initiatives/initiative-records";
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

  it("keeps Assessments created for claims apart (Assessments created for claims)", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const operator = buildInitiative(db, { sources: [source] });
    const claimed = claimInitiative(db, source);

    expect([...latestConclusions(db).keys()]).toEqual([operator.id]);
    expect([...latestConclusions(db, { systemOwned: true }).keys()]).toEqual([claimed.id]);
  });
});
