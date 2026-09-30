import { beforeEach, describe, expect, it } from "vitest";
import { ScopeResolutionError, resolveScope } from "@/lib/assessments/scope-resolver";
import { setSourceEnabled, updateSource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { getInitiative } from "@/lib/initiatives/initiative-records";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";

const problemsOf = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    if (error instanceof ScopeResolutionError) return error.problems;
    throw error;
  }
  throw new Error("expected a ScopeResolutionError");
};

describe("scope resolution", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("includes every enabled source and no disabled source for an all-enabled initiative", () => {
    buildSource(db, { name: "billing" });
    buildSource(db, { name: "Accounts" });
    buildSource(db, { name: "legacy", enabled: false });
    const initiative = buildInitiative(db);

    expect(resolveScope(db, initiative).map((source) => source.name)).toEqual(["Accounts", "billing"]);
  });

  it("includes exactly an explicit subset regardless of other catalog entries", () => {
    const [a, , c, d] = ["a", "b", "c", "d", "e"].map((name) => buildSource(db, { name }));
    const initiative = buildInitiative(db, { sources: [d!, a!, c!] });

    expect(resolveScope(db, initiative).map((source) => source.name)).toEqual(["a", "c", "d"]);
  });

  it("uses the catalog's current values when a selected source was edited", () => {
    const source = buildSource(db, { name: "orders", gitRef: "main" });
    const initiative = buildInitiative(db, { sources: [source] });
    updateSource(db, source.publicId, 0, { name: "orders-ui", gitRef: "release" });

    expect(resolveScope(db, initiative)[0]).toMatchObject({ name: "orders-ui", gitRef: "release" });
  });

  it("orders deterministically by name, then public id, whatever the insertion order", () => {
    const names = ["delta", "Alpha", "charlie", "bravo", "alpha"];
    const first = createTestDb();
    const second = createTestDb();
    for (const name of names) buildSource(first, { name, cloneUrl: `https://git.example.com/${name}-1` });
    for (const name of [...names].reverse()) buildSource(second, { name, cloneUrl: `https://git.example.com/${name}-2` });

    const order = (database: Db) => resolveScope(database, buildInitiative(database)).map((source) => source.name.toLowerCase());
    expect(order(first)).toEqual(["alpha", "alpha", "bravo", "charlie", "delta"]);
    expect(order(second)).toEqual(order(first));

    const alphas = resolveScope(first, buildInitiative(first)).filter((source) => source.name.toLowerCase() === "alpha");
    expect(alphas.map((source) => source.publicId)).toEqual([...alphas.map((source) => source.publicId)].sort());
  });

  it("reports an empty all-enabled scope", () => {
    buildSource(db, { enabled: false });
    expect(problemsOf(() => resolveScope(db, buildInitiative(db)))[0]?.message).toMatch(/The scope is empty: no repository sources are enabled/);
  });

  it("reports an explicit scope with no selections", () => {
    const initiative = buildInitiative(db, { sources: [buildSource(db)] });
    rawRun(db, "delete from initiative_targets where initiative_id = ?", initiative.id);

    expect(problemsOf(() => resolveScope(db, getInitiative(db, initiative.publicId)))[0]?.message).toMatch(/selects no repository sources/);
  });

  it("names every disabled source in an explicit scope", () => {
    const [orders, billing, accounts] = ["orders", "billing", "accounts"].map((name) => buildSource(db, { name }));
    const initiative = buildInitiative(db, { sources: [orders!, billing!, accounts!] });
    setSourceEnabled(db, orders!.publicId, false);
    setSourceEnabled(db, billing!.publicId, false);

    const problems = problemsOf(() => resolveScope(db, initiative));
    expect(problems.map((problem) => problem.sourceName)).toEqual(["billing", "orders"]);
    expect(problems[0]?.message).toBe(`billing (${billing!.publicId}) is disabled. Enable it in Sources or remove it from this initiative's scope.`);
  });

  it("reports a selected source that no longer exists", () => {
    const [kept, removed] = [buildSource(db, { name: "kept" }), buildSource(db, { name: "removed" })];
    const initiative = buildInitiative(db, { sources: [kept, removed] });
    db.$client.pragma("foreign_keys = OFF");
    rawRun(db, "drop trigger repository_sources_never_deleted");
    rawRun(db, "delete from repository_sources where id = ?", removed.id);

    const problems = problemsOf(() => resolveScope(db, initiative));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toMatch(new RegExp(`catalog record ${removed.id}\\) no longer exists`));
  });
});
