import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmImport, previewImport } from "@/lib/catalog/directory-import";
import { BoundaryViolation, SourceBoundary } from "@/lib/catalog/source-boundary";
import { insertSource, listSources } from "@/lib/catalog/source-records";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { createTestDb } from "../support/db";
import { GitFixture } from "../support/git-fixture";

describe("directory import", () => {
  let db: Db;
  let fixture: GitFixture;
  let fleet: string;
  let boundary: SourceBoundary;

  beforeEach(() => {
    db = createTestDb();
    fixture = GitFixture.create("import");
    fleet = fixture.dir("fleet");
    for (const name of ["orders", "billing"]) fixture.repo(`fleet/${name}`).write("README.md", name).commit();
    fixture.dir("fleet/notes");
    fixture.dir("fleet/.hidden-repo");
    fixture.repo("fleet/fleet-kit").commit();
    fixture.bare("fleet/mirror.git");
    fs.writeFileSync(path.join(fleet, "loose-file.txt"), "not a directory");
    fixture.repo("outside/secret").commit();
    fs.symlinkSync(path.join(fixture.root, "outside", "secret"), path.join(fleet, "escape"));
    boundary = new SourceBoundary(withOverrides(getConfig(), { allowedRoots: [fleet] }));
  });

  afterEach(() => fixture.cleanup());

  it("previews only immediate child Git working trees without changing the catalog", () => {
    const preview = previewImport(db, fleet, boundary);

    expect(preview.root).toBe(fleet);
    expect(preview.candidates.map((candidate) => [candidate.name, candidate.status])).toEqual([
      ["billing", "importable"],
      ["escape", "rejected"],
      ["orders", "importable"],
    ]);
    expect(preview.candidates.find((candidate) => candidate.name === "orders")?.cloneUrl).toBe(`file://${path.join(fleet, "orders")}`);
    expect(preview.candidates.find((candidate) => candidate.name === "escape")?.reason).toMatch(/outside the allowed source roots/);
    expect(listSources(db)).toEqual([]);
  });

  it("marks candidates that are already registered", () => {
    insertSource(db, { name: "orders-existing", cloneUrl: `file://${path.join(fleet, "orders")}`, canonicalUrl: `file://${path.join(fleet, "orders")}` });

    const orders = previewImport(db, fleet, boundary).candidates.find((candidate) => candidate.name === "orders");
    expect(orders).toMatchObject({ status: "registered", reason: "Already registered as orders-existing" });
  });

  it("adds exactly the selected valid candidates", () => {
    const result = confirmImport(db, fleet, [path.join(fleet, "orders"), path.join(fleet, "escape"), path.join(fleet, "notes"), path.join(fixture.root, "outside", "secret")], boundary);

    expect(result.created.map((source) => source.name)).toEqual(["orders"]);
    expect(listSources(db).map((source) => [source.name, source.cloneUrl])).toEqual([["orders", `file://${path.join(fleet, "orders")}`]]);
  });

  it("does not add an already registered candidate a second time", () => {
    confirmImport(db, fleet, [path.join(fleet, "orders")], boundary);
    const again = confirmImport(db, fleet, [path.join(fleet, "orders")], boundary);

    expect(again).toEqual({ created: [], failed: [] });
    expect(listSources(db)).toHaveLength(1);
  });

  it("rejects a directory outside the allowed roots and fleet-kit itself", () => {
    expect(() => previewImport(db, "/", boundary)).toThrow(BoundaryViolation);
    expect(() => previewImport(db, path.join(fleet, "fleet-kit"), boundary)).toThrow(/denied root/);
    expect(() => previewImport(db, "relative/path", boundary)).toThrow(/absolute paths/);
  });
});
