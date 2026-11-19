import { beforeEach, describe, expect, it } from "vitest";
import { ScopeResolutionError, resolveScope } from "@/lib/runs/scope-resolver";
import { updateRepository } from "@/lib/repositories/repository-records";
import type { Db } from "@/lib/db/client";
import { getAssessment } from "@/lib/assessments/assessment-records";
import { buildAssessment, buildRepository } from "../support/builders";
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

  it("includes every source for an initiative of all Repositories", () => {
    buildRepository(db, { name: "billing" });
    buildRepository(db, { name: "Accounts" });
    const assessment = buildAssessment(db);

    expect(resolveScope(db, assessment).map((repository) => repository.name)).toEqual(["Accounts", "billing"]);
  });

  it("includes exactly an explicit subset regardless of other catalog entries", () => {
    const [a, , c, d] = ["a", "b", "c", "d", "e"].map((name) => buildRepository(db, { name }));
    const assessment = buildAssessment(db, { repositories: [d!, a!, c!] });

    expect(resolveScope(db, assessment).map((repository) => repository.name)).toEqual(["a", "c", "d"]);
  });

  it("uses the catalog's current values when a selected source was edited", () => {
    const repository = buildRepository(db, { name: "orders", gitRef: "main" });
    const assessment = buildAssessment(db, { repositories: [repository] });
    updateRepository(db, repository.publicId, 0, { name: "orders-ui", gitRef: "release" });

    expect(resolveScope(db, assessment)[0]).toMatchObject({ name: "orders-ui", gitRef: "release" });
  });

  it("orders deterministically by name, then public id, whatever the insertion order", () => {
    const names = ["delta", "Alpha", "charlie", "bravo", "alpha"];
    const first = createTestDb();
    const second = createTestDb();
    for (const name of names) buildRepository(first, { name, cloneUrl: `https://git.example.com/${name}-1` });
    for (const name of [...names].reverse()) buildRepository(second, { name, cloneUrl: `https://git.example.com/${name}-2` });

    const order = (database: Db) => resolveScope(database, buildAssessment(database)).map((repository) => repository.name.toLowerCase());
    expect(order(first)).toEqual(["alpha", "alpha", "bravo", "charlie", "delta"]);
    expect(order(second)).toEqual(order(first));

    const alphas = resolveScope(first, buildAssessment(first)).filter((repository) => repository.name.toLowerCase() === "alpha");
    expect(alphas.map((repository) => repository.publicId)).toEqual([...alphas.map((repository) => repository.publicId)].sort());
  });

  it("reports an empty scope of all Repositories", () => {
    expect(problemsOf(() => resolveScope(db, buildAssessment(db)))[0]?.message).toMatch(/The scope is empty: there are no Repositories/);
  });

  it("reports an explicit scope with no selections", () => {
    const assessment = buildAssessment(db, { repositories: [buildRepository(db)] });
    rawRun(db, "delete from initiative_targets where initiative_id = ?", assessment.id);

    expect(problemsOf(() => resolveScope(db, getAssessment(db, assessment.publicId)))[0]?.message).toMatch(/selects no Repositories/);
  });

  it("reports a selected source that no longer exists", () => {
    const [kept, removed] = [buildRepository(db, { name: "kept" }), buildRepository(db, { name: "removed" })];
    const assessment = buildAssessment(db, { repositories: [kept, removed] });
    db.$client.pragma("foreign_keys = OFF");
    rawRun(db, "drop trigger repository_sources_never_deleted");
    rawRun(db, "delete from repository_sources where id = ?", removed.id);

    const problems = problemsOf(() => resolveScope(db, assessment));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toMatch(new RegExp(`record ${removed.id}\\) no longer exists`));
  });
});
