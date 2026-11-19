import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAssessment, deleteAssessment, startRun, updateAssessment } from "@/app/(operator)/assessments/actions";
import type { AssessmentFormState } from "@/app/(operator)/assessments/form-state";
import { listRuns, targetsOf } from "@/lib/runs/run-records";
import { jobs } from "@/lib/db/schema";
import { getAssessment, listAssessments, selectedReleases, selectedSources } from "@/lib/assessments/assessment-records";
import { createStandard } from "@/lib/standards/standard-records";
import { buildRun, buildAssessment, buildRelease, buildSource } from "../support/builders";
import { redirectOf, useAppDb, formData } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

const blank: AssessmentFormState = { values: { name: "", objective: "", selectionMode: "all", sourcePublicIds: [], standardReleasePublicIds: [] }, errors: {} };

describe("initiative Server Actions", () => {
  const app = useAppDb();

  it("creates an initiative of all Repositories that selects two published Releases", async () => {
    const [first, second] = [buildRelease(app.db), buildRelease(app.db)];
    const location = await redirectOf(createAssessment(blank, formData({ name: "Modernize", objective: "Upgrade", selectionMode: "all", standardReleasePublicIds: [first.publicId, second.publicId] })));

    const [assessment] = listAssessments(app.db);
    expect(location).toBe(`/assessments/${assessment!.publicId}?notice=created`);
    expect(assessment).toMatchObject({ selectionMode: "all" });
    expect(selectedReleases(app.db, assessment!.id).map(({ release }) => release.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("creates an explicit initiative with exactly the selected sources", async () => {
    const [a, , c] = ["a", "b", "c"].map((name) => buildSource(app.db, { name }));
    await redirectOf(createAssessment(blank, formData({ name: "Subset", selectionMode: "explicit", sourcePublicIds: [a!.publicId, c!.publicId] })));

    expect(selectedSources(app.db, listAssessments(app.db)[0]!.id).map((source) => source.name)).toEqual(["a", "c"]);
  });

  it("rejects a draft Standard submitted in place of a Release", async () => {
    const { standard } = createStandard(app.db, { name: "Draft only", purpose: "Not yet published" });
    const state = await createAssessment(blank, formData({ name: "Drafty", selectionMode: "all", standardReleasePublicIds: [standard.publicId] }));

    expect(state.errors.standardReleases).toEqual(["Draft only is a draft Standard; select one of its published Releases"]);
    expect(listAssessments(app.db)).toEqual([]);
  });

  it("requires a source for an explicit scope and a supported scope mode", async () => {
    expect((await createAssessment(blank, formData({ name: "Empty", selectionMode: "explicit" }))).errors.sources).toEqual([
      "Select at least one repository source for an explicit scope",
    ]);
    expect((await createAssessment(blank, formData({ name: "Odd", selectionMode: "everything" }))).errors.selectionMode).toHaveLength(1);
  });

  it("updates with optimistic locking and reports a stale edit", async () => {
    const assessment = buildAssessment(app.db);
    const fields = { name: "Renamed", selectionMode: "all", lockVersion: 0 };

    expect(await redirectOf(updateAssessment(assessment.publicId, blank, formData(fields)))).toBe(`/assessments/${assessment.publicId}?notice=updated`);
    expect((await updateAssessment(assessment.publicId, blank, formData(fields))).errors.base?.[0]).toMatch(/changed by someone else/);
    expect(getAssessment(app.db, assessment.publicId).name).toBe("Renamed");
  });

  it("deletes an unassessed initiative and retains an assessed one", async () => {
    const assessed = buildAssessment(app.db);
    buildRun(app.db, { assessment: assessed, sources: [buildSource(app.db)] });
    const fresh = buildAssessment(app.db);

    expect(await redirectOf(deleteAssessment(formData({ publicId: assessed.publicId })))).toBe(`/assessments/${assessed.publicId}?notice=retained`);
    expect(await redirectOf(deleteAssessment(formData({ publicId: fresh.publicId })))).toBe("/assessments?notice=deleted");
    expect(listAssessments(app.db).map((assessment) => assessment.id)).toEqual([assessed.id]);
  });

  it("starts an assessment and redirects to it, once per launch token", async () => {
    buildSource(app.db, { name: "orders" });
    const assessment = buildAssessment(app.db);
    const token = crypto.randomUUID();

    const first = await redirectOf(startRun(assessment.publicId, { problems: [] }, formData({ launchToken: token })));
    const [run] = listRuns(app.db, assessment.id);
    expect(first).toBe(`/runs/${run!.publicId}?notice=started`);
    expect(targetsOf(app.db, run!.id).map((target) => target.sourceName)).toEqual(["orders"]);

    expect(await redirectOf(startRun(assessment.publicId, { problems: [] }, formData({ launchToken: token })))).toBe(`/runs/${run!.publicId}?notice=already-started`);
    expect(listRuns(app.db, assessment.id)).toHaveLength(1);
    expect(app.db.select().from(jobs).all()).toHaveLength(1);
  });

  it("returns an actionable problem when the scope can't be resolved, and starts nothing", async () => {
    // An Assessment of all Repositories, while there are none.
    const assessment = buildAssessment(app.db);

    const state = await startRun(assessment.publicId, { problems: [] }, formData({ launchToken: crypto.randomUUID() }));
    expect(state.problems).toEqual(["The scope is empty: there are no Repositories. Add one before starting a Run."]);
    expect(listRuns(app.db, assessment.id)).toEqual([]);
    expect(app.db.select().from(jobs).all()).toEqual([]);
  });
});
