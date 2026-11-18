import { beforeAll, describe, expect, it } from "vitest";
import { targetsOf } from "@/lib/assessments/assessment-records";
import type { Db } from "@/lib/db/client";
import { packageProducers, repositoryRelationships } from "@/lib/profiles/relationships";
import { findVersion, queueProfile } from "@/lib/profiling/versions";
import { buildSource } from "../../support/builders";
import { createTestDb } from "../../support/db";
import { type MapWorldRun, seedMapWorldRun } from "../../support/map-world";
import { manifest } from "../../support/profiles";
import { completeRun } from "../../support/scenarios";

describe("A repository's relationships", () => {
  let db: Db;
  let world: MapWorldRun;
  beforeAll(async () => {
    db = createTestDb();
    world = await seedMapWorldRun(db);
  });

  it("lists the repositories that use it and those it uses, from the newest Assessment Run that mapped it", () => {
    const tokens = repositoryRelationships(db, world.sources["design-tokens"]!.id);
    expect(tokens.run?.publicId).toBe(world.assessment.publicId);
    expect(tokens.uses).toEqual([]);
    expect(tokens.usedBy.map((repository) => [repository.name, repository.types])).toEqual([
      ["fx-board", ["package_dependency"]],
      ["payee-hub", ["package_dependency"]],
      ["rates", ["package_dependency"]],
    ]);
    expect(tokens.mapHref).toMatch(new RegExp(`^/runs/${world.assessment.publicId}/map\\?focus=node_`));
    const shell = repositoryRelationships(db, world.sources["access-shell"]!.id);
    expect(shell.uses.map((repository) => repository.name)).toContain("fx-board");
    expect(shell.uses.find((repository) => repository.name === "fx-board")!.types).toContain("composition");
  });

  it("knows no relationships for a repository no Assessment Run has mapped, which isn't the same as none", () => {
    expect(repositoryRelationships(db, buildSource(db, { name: "unmapped" }).id)).toEqual({ run: null, uses: [], usedBy: [], mapHref: null });
  });
});

describe("Package producers across the fleet", () => {
  it("names the repository whose newest profiled version publishes a package, and never one whose package is private", async () => {
    const db = createTestDb();
    const profiled = async (name: string, packageManifest: string) => {
      const source = buildSource(db, { name });
      queueProfile(db, source, "imported");
      const version = findVersion(db, source.id, 1)!;
      await completeRun(db, version.assessment, targetsOf(db, version.assessment.id), [source], [{ "package.json": packageManifest }]);
      return source;
    };
    const tokens = await profiled("design-tokens", manifest({ name: "@acme/design-tokens", version: "1.0.0" }));
    // A private workspace named like a public package, as mattermost's e2e workspace is named cypress.
    await profiled("chat", manifest({ name: "cypress", private: true }));

    const producers = packageProducers(db, ["@acme/design-tokens", "cypress", "react"]);
    expect([...producers.entries()]).toEqual([["@acme/design-tokens", [{ publicId: tokens.publicId, name: "design-tokens" }]]]);
    expect(packageProducers(db, []).size).toBe(0);
  });
});
