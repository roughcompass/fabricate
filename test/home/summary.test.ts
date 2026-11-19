import { describe, expect, it } from "vitest";
import { deleteSource } from "@/lib/catalog/catalog";
import { fleetSummary } from "@/lib/home/summary";
import { targetsOf } from "@/lib/assessments/assessment-records";
import { findVersion, queueProfile } from "@/lib/profiling/versions";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, driveEvaluation, driveRun } from "../support/home";
import { manifest } from "../support/profiles";
import { completeRun, seedAssessment } from "../support/scenarios";

describe("fleet summary", () => {
  it("counts every Repository, and those with a current Profile from any Run, not one only queued, failed, or deleted (Profiling coverage)", async () => {
    const db = createTestDb();
    const [profiled, assessed, queued, failed, deleted] = [buildSource(db, { name: "profiled" }), buildSource(db, { name: "assessed" }), buildSource(db, { name: "queued" }), buildSource(db, { name: "failed" }), buildSource(db, { name: "deleted" })];
    for (const source of [profiled, queued, failed, deleted]) queueProfile(db, source, "imported");
    for (const source of [profiled, failed, deleted]) {
      const { assessment } = findVersion(db, source.id, 1)!;
      await completeRun(db, assessment, targetsOf(db, assessment.id), [source], [source === failed ? "failed" : { "package.json": manifest({ name: source.name, version: "1.0.0" }) }]);
    }
    // An operator's Run profiles a repository too.
    await seedAssessment(db, buildInitiative(db, { sources: [assessed] }), [assessed], [{ "package.json": manifest({ name: "assessed", version: "1.0.0" }) }]);
    deleteSource(db, deleted.publicId, "deleted");

    expect(fleetSummary(db).repositories).toEqual({ empty: false, total: 4, profiled: 2 });
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

    const { assessments } = fleetSummary(db);
    expect(assessments).toEqual({ empty: false, total: 4, byConclusion: { gaps: 2, undetermined: 0, conforms: 1, not_applicable: 0, none: 1 } });
  });

  it("reports every group empty in a fresh installation (Fresh installation)", () => {
    const db = createTestDb();
    const summary = fleetSummary(db);
    expect(summary.repositories.empty).toBe(true);
    expect(summary.assessments.empty).toBe(true);
  });

  it("doesn't count the profiling Assessment as the operator's", () => {
    const db = createTestDb();
    queueProfile(db, buildSource(db), "imported");
    expect(fleetSummary(db).assessments).toMatchObject({ empty: true, total: 0 });
  });
});
