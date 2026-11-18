import { describe, expect, it } from "vitest";
import { claimedShare, fleetSummary } from "@/lib/home/summary";
import { claimInitiative } from "@/lib/initiatives/initiative-records";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, claim, driveEvaluation, driveRun } from "../support/home";

describe("fleet summary", () => {
  it("counts every Repository, and the claimed and unclaimed ones (Ownership coverage)", () => {
    const db = createTestDb();
    const sources = Array.from({ length: 212 }, () => buildSource(db));
    for (const source of sources.slice(0, 130)) claim(db, source);

    const { repositories } = fleetSummary(db);
    expect(repositories).toMatchObject({ empty: false, total: 212, claimed: 130, unclaimed: 82 });
    expect(claimedShare(repositories)).toBe(61);
    expect(claimedShare({ total: 0, claimed: 0 })).toBeNull();
  });

  it("counts the operator's Assessments by conclusion and hides Not applicable at zero (Not applicable hidden at zero)", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const evaluated = (conclusion: "gaps" | "conforms") => {
      const initiative = buildInitiative(db, { sources: [source] });
      driveEvaluation(db, buildEvaluation(db, initiative, driveRun(db, buildAssessment(db, { initiative }).assessment, "complete")), "complete", conclusion);
    };
    evaluated("gaps");
    evaluated("gaps");
    evaluated("conforms");
    buildInitiative(db, { sources: [source] });
    claimInitiative(db, source);

    const { assessments } = fleetSummary(db);
    expect(assessments).toEqual({ empty: false, total: 4, byConclusion: { gaps: 2, undetermined: 0, conforms: 1, not_applicable: 0, none: 1 } });
  });

  it("reports every group empty in a fresh installation (Fresh installation)", () => {
    const db = createTestDb();
    const summary = fleetSummary(db);
    expect(summary.repositories.empty).toBe(true);
    expect(summary.assessments.empty).toBe(true);
  });

  it("doesn't count only claim-created Assessments as the operator's", () => {
    const db = createTestDb();
    claimInitiative(db, buildSource(db));
    expect(fleetSummary(db).assessments).toMatchObject({ empty: true, total: 0 });
  });
});
