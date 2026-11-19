import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCounts, editRepository, registerRepository } from "@/lib/repositories/registration";
import { jobs } from "@/lib/db/schema";
import { jobPayload } from "@/lib/jobs/queue";
import { REQUEST_SURVEY } from "@/lib/surveys/background";
import { SourceBoundary } from "@/lib/repositories/source-boundary";
import { getRepository, listRepositories } from "@/lib/repositories/repository-records";
import { getConfig, withOverrides } from "@/lib/config";
import { targetsOf } from "@/lib/runs/run-records";
import type { Db } from "@/lib/db/client";
import { buildRun } from "../support/builders";
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
    const repository = registerRepository(db, { name: "orders", cloneUrl: "https://GIT.example.com/acme/orders.git", gitRef: "main" }, boundary);

    expect(repository).toMatchObject({ cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders", gitRef: "main" });
  });

  it("registers a local source at its resolved path", () => {
    const repository = registerRepository(db, { name: "orders", cloneUrl: `file://${fixture.root}/fleet/./orders`.replace("/./", "/"), gitRef: "" }, boundary);

    expect(repository.cloneUrl).toBe(`file://${path.join(fixture.root, "fleet", "orders")}`);
  });

  it("reports URL and field problems together and writes nothing", () => {
    const error = captureValidation(() => registerRepository(db, { name: "x".repeat(101), cloneUrl: "git@github.com:acme/orders.git", gitRef: "bad..ref" }, boundary));

    expect(error.issues.map((issue) => issue.field)).toEqual(["cloneUrl", "name", "gitRef"]);
    expect(error.messagesFor("cloneUrl")[0]).toMatch(/scp-style shorthand/);
    expect(listRepositories(db)).toEqual([]);
  });

  it("reports a local path outside the boundary as a clone URL problem", () => {
    const error = captureValidation(() => registerRepository(db, { name: "escape", cloneUrl: "file:///etc", gitRef: "" }, boundary));

    expect(error.messagesFor("cloneUrl")[0]).toMatch(/outside the allowed source roots/);
  });

  it("rejects a duplicate canonical URL and identifies the existing source", () => {
    const existing = registerRepository(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "" }, boundary);
    const error = captureValidation(() => registerRepository(db, { name: "copy", cloneUrl: "https://git.example.com/acme/orders/", gitRef: "" }, boundary));

    expect(error.messagesFor("cloneUrl")).toEqual([`This clone URL is already registered as orders (${existing.publicId})`]);
  });

  it("names a Repository after its clone URL when the name is left blank, and keeps a name someone gave", () => {
    const named = registerRepository(db, { name: "  ", cloneUrl: "https://github.com/vickykatoch/helios.git", gitRef: "" }, boundary);
    expect(named.name).toBe("vickykatoch-helios");
    const kept = registerRepository(db, { name: "Helios", cloneUrl: "https://github.com/vickykatoch/helios-docs.git", gitRef: "" }, boundary);
    expect(kept.name).toBe("Helios");
    expect(editRepository(db, named.publicId, named.lockVersion, { name: "", cloneUrl: "https://github.com/vickykatoch/helios.git", gitRef: "main" }, boundary).name).toBe("vickykatoch-helios");
  });

  it("asks for a name only when the clone URL names no repository either", () => {
    expect(() => registerRepository(db, { name: "", cloneUrl: "https://github.com/", gitRef: "" }, boundary)).toThrow(/Enter a name/);
  });

  it("edits a source with optimistic locking", () => {
    const repository = registerRepository(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "" }, boundary);
    const edited = editRepository(db, repository.publicId, 0, { name: "orders-ui", cloneUrl: "https://git.example.com/acme/orders-ui.git", gitRef: "release" }, boundary);

    expect(edited).toMatchObject({ name: "orders-ui", canonicalUrl: "https://git.example.com/acme/orders-ui", gitRef: "release", lockVersion: 1 });
  });

  it("preserves assessment history when a source is edited", () => {
    const repository = registerRepository(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "main" }, boundary);
    const { run } = buildRun(db, { repositories: [repository] });

    editRepository(db, repository.publicId, repository.lockVersion, { name: "orders-ui", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "release" }, boundary);
    expect(getRepository(db, repository.publicId)).toMatchObject({ name: "orders-ui", gitRef: "release" });
    expect(targetsOf(db, run.id)[0]).toMatchObject({ repositoryName: "orders", gitRef: "main" });
    // Adding and editing each request a background survey, which is no Run, so only the Assessment's Run is counted.
    expect(db.select().from(jobs).all().filter((job) => job.kind === REQUEST_SURVEY).map((job) => jobPayload(job).trigger)).toEqual(["added", "edited"]);
    expect(runCounts(db).get(repository.id)).toBe(1);
  });
});
