import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireSnapshot } from "@/lib/acquisition/acquire";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { snapshotOf } from "@/lib/assessments/assessment-records";
import type { FabricateConfig } from "@/lib/config";
import { type Db, migrateDatabase, openDatabase } from "@/lib/db/client";
import { buildAssessment } from "../support/builders";
import { createTestDb } from "../support/db";
import { GitFixture, type BareRepo, type Repo, git } from "../support/git-fixture";
import { acquire, acquiringTarget, acquisitionConfig, registerLocalSource } from "../support/acquisition";
import { transitionTarget } from "@/lib/assessments/transitions";

const run = promisify(execFile);

describe("controlled acquisition", () => {
  let fixture: GitFixture;
  let config: FabricateConfig;
  let db: Db;
  let work: Repo;
  let remote: BareRepo;
  let first: string;
  let second: string;

  beforeEach(() => {
    fixture = GitFixture.create("acquire");
    work = fixture.repo("work/orders", { branch: "trunk" });
    first = work.write("README.md", "one\n").commit("one");
    second = work.write("README.md", "two\n").commit("two");
    work.tag("v1.0", { message: "Release 1.0" }).tag("light");
    work.branch("feature").checkout("feature");
    work.write("feature.txt", "feature\n").commit("feature");
    work.checkout("trunk");
    remote = fixture.bare("remotes/orders.git", { from: work });
    config = acquisitionConfig(fixture);
    db = createTestDb();
  });

  afterEach(() => {
    fixture.cleanup();
    fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
  });

  const mirrorGit = (sourcePublicId: string, ...args: string[]) => git(mirrorPath(config.repositoryStorage, sourcePublicId), args).trim();

  it("acquires the default branch into a managed bare mirror", async () => {
    const source = registerLocalSource(db, config, "orders", remote.path);
    const { target, snapshot } = await acquire(db, config, source);

    expect(snapshot).toMatchObject({ commitSha: second, refKind: "default_branch", resolvedRef: "refs/heads/trunk", repositorySourceId: source.id });
    expect(snapshot.treeSha).toBe(remote.rev(`${second}^{tree}`));
    expect(snapshotOf(db, target.id)?.id).toBe(snapshot.id);
    expect(fs.existsSync(path.join(mirrorPath(config.repositoryStorage, source.publicId), "HEAD"))).toBe(true);
    expect(mirrorGit(source.publicId, "rev-parse", "--is-bare-repository")).toBe("true");
  });

  it.each([
    ["a branch", "feature", "branch", "refs/heads/feature", () => work.rev("feature")],
    ["an annotated tag", "v1.0", "tag", "refs/tags/v1.0", () => second],
    ["a lightweight tag", "light", "tag", "refs/tags/light", () => second],
    ["a fully qualified branch", "refs/heads/feature", "branch", "refs/heads/feature", () => work.rev("feature")],
    ["a commit that is not a branch tip", null, "commit", null, () => first],
  ] as const)("acquires %s", async (_label, ref, kind, resolvedRef, commit) => {
    const source = registerLocalSource(db, config, "orders", remote.path, ref ?? first);
    const { snapshot } = await acquire(db, config, source);

    expect(snapshot).toMatchObject({ refKind: kind, resolvedRef: resolvedRef ?? first, commitSha: commit() });
  });

  it("follows a force-updated branch while keeping the earlier snapshot pinned", async () => {
    const source = registerLocalSource(db, config, "orders", remote.path, "trunk");
    const before = (await acquire(db, config, source)).snapshot;

    work.git("checkout", "--quiet", "--orphan", "rewrite");
    work.git("rm", "-rq", "--cached", ".");
    const rewritten = work.write("NEW.md", "rewritten history\n").commit("rewrite");
    work.git("push", "--quiet", "--force", remote.path, "rewrite:trunk");

    const after = (await acquire(db, config, source)).snapshot;
    expect(after.commitSha).toBe(rewritten);
    expect(before.commitSha).toBe(second);
    expect(mirrorGit(source.publicId, "rev-parse", `${before.internalRef}^{commit}`)).toBe(second);
    expect(mirrorGit(source.publicId, "rev-parse", `${after.internalRef}^{commit}`)).toBe(rewritten);
  });

  it("leaves no private incoming refs behind", async () => {
    const source = registerLocalSource(db, config, "orders", remote.path, "feature");
    const { snapshot } = await acquire(db, config, source);

    expect(mirrorGit(source.publicId, "for-each-ref", "--format=%(refname)")).toBe(snapshot.internalRef);
  });

  it("refuses a name that is both a branch and a tag", async () => {
    work.tag("feature");
    work.git("push", "--quiet", remote.path, "refs/tags/feature");
    const source = registerLocalSource(db, config, "orders", remote.path, "feature");

    await expect(acquire(db, config, source)).rejects.toMatchObject({ code: "ambiguous_ref", message: expect.stringContaining("refs/heads/feature or refs/tags/feature") });
  });

  it.each([
    ["a missing branch", "does-not-exist", /no branch or tag named does-not-exist/],
    ["an abbreviated commit", "abc1234", /full 40-character commit SHA/],
    ["an unknown commit", "0123456789abcdef0123456789abcdef01234567", /./],
  ])("reports %s as an invalid reference", async (_label, ref, message) => {
    const source = registerLocalSource(db, config, "orders", remote.path, ref);
    const error = await acquire(db, config, source).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AcquisitionError);
    expect(error).toMatchObject({ code: "invalid_ref", message: expect.stringMatching(message) });
  });

  describe("concurrent acquisition from separate worker processes", () => {
    it("serializes updates to one mirror", async () => {
      const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "concurrent-")));
      const database = path.join(directory, "fabricate.sqlite3");
      const shared = openDatabase(database);
      migrateDatabase(shared);
      const source = registerLocalSource(shared, config, "orders", remote.path, "trunk");
      const targets = [1, 2, 3].map(() => transitionTarget(shared, buildAssessment(shared, { sources: [source] }).targets[0]!, "acquiring"));

      const log = path.join(directory, "git.log");
      const wrapper = path.join(directory, "git");
      const realGit = (await run("sh", ["-c", "command -v git"])).stdout.trim();
      // Logs the calling worker process, then slows every call so overlap would be visible.
      fs.writeFileSync(wrapper, `#!/bin/sh\necho "$PPID $*" >> '${log}'\nsleep 0.1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
      const settings = path.join(directory, "settings.json");
      fs.writeFileSync(settings, JSON.stringify({ database, storage: config.repositoryStorage, allowedRoot: fixture.root }));

      const results = await Promise.all(
        targets.map((target) => run("npx", ["tsx", "test/support/concurrent-acquire.ts", settings, target.publicId, wrapper], { cwd: process.cwd(), timeout: 120_000 })),
      );

      expect(results.map((result) => JSON.parse(result.stdout).commitSha)).toEqual([second, second, second]);
      const mirrorCalls = fs.readFileSync(log, "utf8").split("\n").filter((line) => line.includes("--git-dir="));
      const blocks = mirrorCalls.map((line) => line.split(" ")[0]).filter((pid, index, all) => index === 0 || pid !== all[index - 1]);
      expect(new Set(blocks).size).toBe(3);
      expect(blocks).toHaveLength(3);

      shared.$client.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }, 180_000);

    it("fails with lock_timeout when another holder keeps the mirror", async () => {
      const source = registerLocalSource(db, config, "orders", remote.path);
      const target = acquiringTarget(db, source);
      db.$client.prepare("insert into source_leases (repository_source_id, holder, acquired_at, expires_at) values (?, 'other-worker', ?, ?)").run(source.id, Date.now(), Date.now() + 600_000);

      const quick = { ...config, gitLockTimeoutSeconds: 1 } as FabricateConfig;
      await expect(acquireSnapshot(db, target, { config: quick })).rejects.toMatchObject({ code: "lock_timeout" });
    });
  });
});
