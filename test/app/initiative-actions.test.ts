import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitiative, deleteInitiative, startAssessment, updateInitiative } from "@/app/(operator)/assessments/actions";
import type { InitiativeFormState } from "@/app/(operator)/assessments/form-state";
import { listAssessments, targetsOf } from "@/lib/assessments/assessment-records";
import { setSourceEnabled } from "@/lib/catalog/source-records";
import { type Db, setDb } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { getInitiative, listInitiatives, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { createStandard } from "@/lib/standards/standard-records";
import { buildAssessment, buildInitiative, buildRelease, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { redirectOf } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);
vi.mock("next/cache", async () => (await import("../support/next")).cacheStub);

const form = (fields: Record<string, string | number | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, String(item));
  }
  return data;
};
const blank: InitiativeFormState = { values: { name: "", objective: "", selectionMode: "all_enabled", sourcePublicIds: [], standardReleasePublicIds: [] }, errors: {} };

describe("initiative Server Actions", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    setDb(db);
  });
  afterEach(() => setDb(undefined));

  it("creates an all-enabled initiative that selects two published Releases", async () => {
    const [first, second] = [buildRelease(db), buildRelease(db)];
    const location = await redirectOf(createInitiative(blank, form({ name: "Modernize", objective: "Upgrade", selectionMode: "all_enabled", standardReleasePublicIds: [first.publicId, second.publicId] })));

    const [initiative] = listInitiatives(db);
    expect(location).toBe(`/assessments/${initiative!.publicId}?notice=created`);
    expect(initiative).toMatchObject({ selectionMode: "all_enabled" });
    expect(selectedReleases(db, initiative!.id).map(({ release }) => release.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("creates an explicit initiative with exactly the selected sources", async () => {
    const [a, , c] = ["a", "b", "c"].map((name) => buildSource(db, { name }));
    await redirectOf(createInitiative(blank, form({ name: "Subset", selectionMode: "explicit", sourcePublicIds: [a!.publicId, c!.publicId] })));

    expect(selectedSources(db, listInitiatives(db)[0]!.id).map((source) => source.name)).toEqual(["a", "c"]);
  });

  it("rejects a draft Standard submitted in place of a Release", async () => {
    const { standard } = createStandard(db, { name: "Draft only", purpose: "Not yet published" });
    const state = await createInitiative(blank, form({ name: "Drafty", selectionMode: "all_enabled", standardReleasePublicIds: [standard.publicId] }));

    expect(state.errors.standardReleases).toEqual(["Draft only is a draft Standard; select one of its published Releases"]);
    expect(listInitiatives(db)).toEqual([]);
  });

  it("requires a source for an explicit scope and a supported scope mode", async () => {
    expect((await createInitiative(blank, form({ name: "Empty", selectionMode: "explicit" }))).errors.sources).toEqual([
      "Select at least one repository source for an explicit scope",
    ]);
    expect((await createInitiative(blank, form({ name: "Odd", selectionMode: "everything" }))).errors.selectionMode).toHaveLength(1);
  });

  it("updates with optimistic locking and reports a stale edit", async () => {
    const initiative = buildInitiative(db);
    const fields = { name: "Renamed", selectionMode: "all_enabled", lockVersion: 0 };

    expect(await redirectOf(updateInitiative(initiative.publicId, blank, form(fields)))).toBe(`/assessments/${initiative.publicId}?notice=updated`);
    expect((await updateInitiative(initiative.publicId, blank, form(fields))).errors.base?.[0]).toMatch(/changed by someone else/);
    expect(getInitiative(db, initiative.publicId).name).toBe("Renamed");
  });

  it("deletes an unassessed initiative and retains an assessed one", async () => {
    const assessed = buildInitiative(db);
    buildAssessment(db, { initiative: assessed, sources: [buildSource(db)] });
    const fresh = buildInitiative(db);

    expect(await redirectOf(deleteInitiative(form({ publicId: assessed.publicId })))).toBe(`/assessments/${assessed.publicId}?notice=retained`);
    expect(await redirectOf(deleteInitiative(form({ publicId: fresh.publicId })))).toBe("/assessments?notice=deleted");
    expect(listInitiatives(db).map((initiative) => initiative.id)).toEqual([assessed.id]);
  });

  it("starts an assessment and redirects to it, once per launch token", async () => {
    buildSource(db, { name: "orders" });
    const initiative = buildInitiative(db);
    const token = crypto.randomUUID();

    const first = await redirectOf(startAssessment(initiative.publicId, { problems: [] }, form({ launchToken: token })));
    const [assessment] = listAssessments(db, initiative.id);
    expect(first).toBe(`/runs/${assessment!.publicId}?notice=started`);
    expect(targetsOf(db, assessment!.id).map((target) => target.sourceName)).toEqual(["orders"]);

    expect(await redirectOf(startAssessment(initiative.publicId, { problems: [] }, form({ launchToken: token })))).toBe(`/runs/${assessment!.publicId}?notice=already-started`);
    expect(listAssessments(db, initiative.id)).toHaveLength(1);
    expect(db.select().from(jobs).all()).toHaveLength(1);
  });

  it("returns one actionable problem per invalid source and starts nothing", async () => {
    const [orders, billing] = [buildSource(db, { name: "orders" }), buildSource(db, { name: "billing" })];
    const initiative = buildInitiative(db, { sources: [orders, billing] });
    setSourceEnabled(db, orders.publicId, false);

    const state = await startAssessment(initiative.publicId, { problems: [] }, form({ launchToken: crypto.randomUUID() }));
    expect(state.problems).toEqual([`orders (${orders.publicId}) is disabled. Enable it in Repositories or remove it from this Assessment's scope.`]);
    expect(listAssessments(db, initiative.id)).toEqual([]);
    expect(db.select().from(jobs).all()).toEqual([]);
  });
});
