import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createInitiative, deleteInitiative, startAssessment, updateInitiative } from "@/app/(operator)/assessments/actions";
import type { InitiativeFormState } from "@/app/(operator)/assessments/form-state";
import { listAssessments, targetsOf } from "@/lib/assessments/assessment-records";
import { jobs } from "@/lib/db/schema";
import { getInitiative, listInitiatives, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { createStandard } from "@/lib/standards/standard-records";
import { buildAssessment, buildInitiative, buildRelease, buildSource } from "../support/builders";
import { redirectOf, useAppDb, formData } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

const blank: InitiativeFormState = { values: { name: "", objective: "", selectionMode: "all", sourcePublicIds: [], standardReleasePublicIds: [] }, errors: {} };

describe("initiative Server Actions", () => {
  const app = useAppDb();

  it("creates an initiative of all Repositories that selects two published Releases", async () => {
    const [first, second] = [buildRelease(app.db), buildRelease(app.db)];
    const location = await redirectOf(createInitiative(blank, formData({ name: "Modernize", objective: "Upgrade", selectionMode: "all", standardReleasePublicIds: [first.publicId, second.publicId] })));

    const [initiative] = listInitiatives(app.db);
    expect(location).toBe(`/assessments/${initiative!.publicId}?notice=created`);
    expect(initiative).toMatchObject({ selectionMode: "all" });
    expect(selectedReleases(app.db, initiative!.id).map(({ release }) => release.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("creates an explicit initiative with exactly the selected sources", async () => {
    const [a, , c] = ["a", "b", "c"].map((name) => buildSource(app.db, { name }));
    await redirectOf(createInitiative(blank, formData({ name: "Subset", selectionMode: "explicit", sourcePublicIds: [a!.publicId, c!.publicId] })));

    expect(selectedSources(app.db, listInitiatives(app.db)[0]!.id).map((source) => source.name)).toEqual(["a", "c"]);
  });

  it("rejects a draft Standard submitted in place of a Release", async () => {
    const { standard } = createStandard(app.db, { name: "Draft only", purpose: "Not yet published" });
    const state = await createInitiative(blank, formData({ name: "Drafty", selectionMode: "all", standardReleasePublicIds: [standard.publicId] }));

    expect(state.errors.standardReleases).toEqual(["Draft only is a draft Standard; select one of its published Releases"]);
    expect(listInitiatives(app.db)).toEqual([]);
  });

  it("requires a source for an explicit scope and a supported scope mode", async () => {
    expect((await createInitiative(blank, formData({ name: "Empty", selectionMode: "explicit" }))).errors.sources).toEqual([
      "Select at least one repository source for an explicit scope",
    ]);
    expect((await createInitiative(blank, formData({ name: "Odd", selectionMode: "everything" }))).errors.selectionMode).toHaveLength(1);
  });

  it("updates with optimistic locking and reports a stale edit", async () => {
    const initiative = buildInitiative(app.db);
    const fields = { name: "Renamed", selectionMode: "all", lockVersion: 0 };

    expect(await redirectOf(updateInitiative(initiative.publicId, blank, formData(fields)))).toBe(`/assessments/${initiative.publicId}?notice=updated`);
    expect((await updateInitiative(initiative.publicId, blank, formData(fields))).errors.base?.[0]).toMatch(/changed by someone else/);
    expect(getInitiative(app.db, initiative.publicId).name).toBe("Renamed");
  });

  it("deletes an unassessed initiative and retains an assessed one", async () => {
    const assessed = buildInitiative(app.db);
    buildAssessment(app.db, { initiative: assessed, sources: [buildSource(app.db)] });
    const fresh = buildInitiative(app.db);

    expect(await redirectOf(deleteInitiative(formData({ publicId: assessed.publicId })))).toBe(`/assessments/${assessed.publicId}?notice=retained`);
    expect(await redirectOf(deleteInitiative(formData({ publicId: fresh.publicId })))).toBe("/assessments?notice=deleted");
    expect(listInitiatives(app.db).map((initiative) => initiative.id)).toEqual([assessed.id]);
  });

  it("starts an assessment and redirects to it, once per launch token", async () => {
    buildSource(app.db, { name: "orders" });
    const initiative = buildInitiative(app.db);
    const token = crypto.randomUUID();

    const first = await redirectOf(startAssessment(initiative.publicId, { problems: [] }, formData({ launchToken: token })));
    const [assessment] = listAssessments(app.db, initiative.id);
    expect(first).toBe(`/runs/${assessment!.publicId}?notice=started`);
    expect(targetsOf(app.db, assessment!.id).map((target) => target.sourceName)).toEqual(["orders"]);

    expect(await redirectOf(startAssessment(initiative.publicId, { problems: [] }, formData({ launchToken: token })))).toBe(`/runs/${assessment!.publicId}?notice=already-started`);
    expect(listAssessments(app.db, initiative.id)).toHaveLength(1);
    expect(app.db.select().from(jobs).all()).toHaveLength(1);
  });

  it("returns an actionable problem when the scope can't be resolved, and starts nothing", async () => {
    // An Assessment of all Repositories, while there are none.
    const initiative = buildInitiative(app.db);

    const state = await startAssessment(initiative.publicId, { problems: [] }, formData({ launchToken: crypto.randomUUID() }));
    expect(state.problems).toEqual(["The scope is empty: there are no Repositories. Add one before starting a Run."]);
    expect(listAssessments(app.db, initiative.id)).toEqual([]);
    expect(app.db.select().from(jobs).all()).toEqual([]);
  });
});
