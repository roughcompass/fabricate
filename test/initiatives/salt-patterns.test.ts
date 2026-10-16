import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { launchAssessment } from "@/lib/assessments/launcher";
import { ScopeResolutionError } from "@/lib/assessments/scope-resolver";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { SALT_PATTERNS_INITIATIVE_ID, deleteInitiative, isSystemOwned, listInitiatives, saltPatternsInitiative, selectedReleases, updateInitiative, updateReleaseSelections } from "@/lib/initiatives/initiative-records";
import { buildRelease, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";

// initiative-scoping spec: "A system-owned Salt Patterns initiative assesses template versions".

describe("the Salt Patterns initiative", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("exists from the migration, is system-owned, and stays out of the operator's and claims' lists", () => {
    const initiative = saltPatternsInitiative(db);
    expect(initiative).toMatchObject({ publicId: SALT_PATTERNS_INITIATIVE_ID, name: "Salt Patterns", selectionMode: "explicit", systemOwned: true, claimRepositorySourceId: null });
    expect(isSystemOwned(initiative)).toBe(true);
    expect(listInitiatives(db)).toEqual([]);
    expect(listInitiatives(db, { systemOwned: true })).toEqual([]);
  });

  it("selects and clears published Releases, and nothing else", () => {
    const [first, second] = [buildRelease(db), buildRelease(db)];
    const updated = updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, 0, [first.publicId, second.publicId]);
    expect(selectedReleases(db, updated.id).map(({ release }) => release.id).sort()).toEqual([first.id, second.id].sort());
    expect(updated).toMatchObject({ name: "Salt Patterns", lockVersion: 1 });

    updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, 1, []);
    expect(selectedReleases(db, updated.id)).toEqual([]);
    expect(() => updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, 1, [])).toThrow(/changed by someone else/);
    expect(() => updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, 2, ["rel_missing000000000"])).toThrow(ValidationError);
  });

  it("refuses a change to its name, objective, or targets, and deletion (Catalog source refused)", () => {
    const orders = buildSource(db, { name: "orders" });
    const refused = (work: () => unknown) => {
      try {
        work();
      } catch (error) {
        return (error as ValidationError).issues.map((issue) => issue.message);
      }
      throw new Error("Expected a refusal");
    };

    expect(refused(() => updateInitiative(db, SALT_PATTERNS_INITIATIVE_ID, 0, { name: "Salt Patterns", selectionMode: "explicit", sourcePublicIds: [orders.publicId] }))).toEqual([expect.stringMatching(/can't change, but you can choose its Releases/)]);
    expect(refused(() => updateInitiative(db, SALT_PATTERNS_INITIATIVE_ID, 0, { name: "Renamed", selectionMode: "explicit" }))).toEqual([expect.stringMatching(/can't change/)]);
    expect(refused(() => deleteInitiative(db, SALT_PATTERNS_INITIATIVE_ID))).toEqual(["Salt Patterns is owned by DE FabLab and is retained"]);
    expect(saltPatternsInitiative(db).name).toBe("Salt Patterns");
  });

  it("refuses an operator-started Run: its Runs start from templates", () => {
    expect(() => launchAssessment(db, SALT_PATTERNS_INITIATIVE_ID, crypto.randomUUID())).toThrow(ScopeResolutionError);
    expect(db.$client.prepare("select count(*) as n from assessments").get()).toEqual({ n: 0 });
  });
});
