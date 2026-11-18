import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assessmentCounts, editSource, registerSource } from "@/lib/catalog/catalog";
import { versionsOf } from "@/lib/profiling/versions";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { getSource, listSources } from "@/lib/catalog/source-records";
import { getConfig, withOverrides } from "@/lib/config";
import { targetsOf } from "@/lib/assessments/assessment-records";
import type { Db } from "@/lib/db/client";
import { buildAssessment } from "../support/builders";
import { createTestDb } from "../support/db";
import { GitFixture } from "../support/git-fixture";
import { captureValidation } from "../support/validation";

describe("catalog service", () => {
  let db: Db;
  let fixture: GitFixture;
  let boundary: SourceBoundary;

  beforeEach(() => {
    db = createTestDb();
    fixture = GitFixture.create("catalog");
    fixture.repo("fleet/orders").write("README.md", "orders").commit();
    boundary = new SourceBoundary(withOverrides(getConfig(), { allowedRoots: [path.join(fixture.root, "fleet")] }));
  });

  afterEach(() => fixture.cleanup());

  it("registers a remote source with its canonical URL", () => {
    const source = registerSource(db, { name: "orders", cloneUrl: "https://GIT.example.com/acme/orders.git", gitRef: "main" }, boundary);

    expect(source).toMatchObject({ cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders", gitRef: "main" });
  });

  it("registers a local source at its resolved path", () => {
    const source = registerSource(db, { name: "orders", cloneUrl: `file://${fixture.root}/fleet/./orders`.replace("/./", "/"), gitRef: "" }, boundary);

    expect(source.cloneUrl).toBe(`file://${path.join(fixture.root, "fleet", "orders")}`);
  });

  it("reports URL and field problems together and writes nothing", () => {
    const error = captureValidation(() => registerSource(db, { name: "x".repeat(101), cloneUrl: "git@github.com:acme/orders.git", gitRef: "bad..ref" }, boundary));

    expect(error.issues.map((issue) => issue.field)).toEqual(["cloneUrl", "name", "gitRef"]);
    expect(error.messagesFor("cloneUrl")[0]).toMatch(/scp-style shorthand/);
    expect(listSources(db)).toEqual([]);
  });

  it("reports a local path outside the boundary as a clone URL problem", () => {
    const error = captureValidation(() => registerSource(db, { name: "escape", cloneUrl: "file:///etc", gitRef: "" }, boundary));

    expect(error.messagesFor("cloneUrl")[0]).toMatch(/outside the allowed source roots/);
  });

  it("rejects a duplicate canonical URL and identifies the existing source", () => {
    const existing = registerSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "" }, boundary);
    const error = captureValidation(() => registerSource(db, { name: "copy", cloneUrl: "https://git.example.com/acme/orders/", gitRef: "" }, boundary));

    expect(error.messagesFor("cloneUrl")).toEqual([`This clone URL is already registered as orders (${existing.publicId})`]);
  });

  it("names a Repository after its clone URL when the name is left blank, and keeps a name someone gave", () => {
    const named = registerSource(db, { name: "  ", cloneUrl: "https://github.com/vickykatoch/helios.git", gitRef: "" }, boundary);
    expect(named.name).toBe("vickykatoch-helios");
    const kept = registerSource(db, { name: "Helios", cloneUrl: "https://github.com/vickykatoch/helios-docs.git", gitRef: "" }, boundary);
    expect(kept.name).toBe("Helios");
    expect(editSource(db, named.publicId, named.lockVersion, { name: "", cloneUrl: "https://github.com/vickykatoch/helios.git", gitRef: "main" }, boundary).name).toBe("vickykatoch-helios");
  });

  it("asks for a name only when the clone URL names no repository either", () => {
    expect(() => registerSource(db, { name: "", cloneUrl: "https://github.com/", gitRef: "" }, boundary)).toThrow(/Enter a name/);
  });

  it("edits a source with optimistic locking", () => {
    const source = registerSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "" }, boundary);
    const edited = editSource(db, source.publicId, 0, { name: "orders-ui", cloneUrl: "https://git.example.com/acme/orders-ui.git", gitRef: "release" }, boundary);

    expect(edited).toMatchObject({ name: "orders-ui", canonicalUrl: "https://git.example.com/acme/orders-ui", gitRef: "release", lockVersion: 1 });
  });

  it("preserves assessment history when a source is edited", () => {
    const source = registerSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "main" }, boundary);
    const { assessment } = buildAssessment(db, { sources: [source] });

    editSource(db, source.publicId, source.lockVersion, { name: "orders-ui", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "release" }, boundary);
    expect(getSource(db, source.publicId)).toMatchObject({ name: "orders-ui", gitRef: "release" });
    expect(targetsOf(db, assessment.id)[0]).toMatchObject({ sourceName: "orders", gitRef: "main" });
    // Its profile version's Run is shown apart, so it isn't counted.
    expect(versionsOf(db, source.id)).toHaveLength(1);
    expect(assessmentCounts(db).get(source.id)).toBe(1);
  });
});
