import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { internalRefFor } from "@/lib/assessments/assessment-records";
import type { FabricateConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { parseCanonical } from "@repo-facts/contract";
import { acquire, acquisitionConfig, registerLocalSource } from "../support/acquisition";
import { createTestDb } from "../support/db";
import { GitFixture, git } from "../support/git-fixture";

describe("snapshot pinning", () => {
  let fixture: GitFixture;
  let config: FabricateConfig;
  let db: Db;

  beforeEach(() => {
    fixture = GitFixture.create("pinning");
    config = acquisitionConfig(fixture);
    db = createTestDb();
  });

  afterEach(() => {
    fixture.cleanup();
    fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
  });

  const objectExists = (gitDir: string, objectId: string) => {
    try {
      git(gitDir, ["cat-file", "-e", objectId]);
      return true;
    } catch {
      return false;
    }
  };
  const prune = (gitDir: string) => {
    git(gitDir, ["-c", "gc.reflogExpire=now", "-c", "gc.reflogExpireUnreachable=now", "-c", "gc.pruneExpire=now", "gc", "--quiet", "--prune=now"]);
    git(gitDir, ["prune", "--expire=now"]);
  };

  it("pins the commit under its snapshot id and records verified acquisition metadata", async () => {
    const work = fixture.repo("work/orders");
    const commit = work.write("README.md", "orders\n").commit();
    const source = registerLocalSource(db, config, "orders", work.path, "main");

    const { snapshot } = await acquire(db, config, source);
    const gitDir = mirrorPath(config.repositoryStorage, source.publicId);

    expect(snapshot.internalRef).toBe(internalRefFor(snapshot.publicId));
    expect(git(gitDir, ["rev-parse", snapshot.internalRef]).trim()).toBe(commit);
    expect(git(gitDir, ["rev-parse", `${commit}^{tree}`]).trim()).toBe(snapshot.treeSha);
    expect(parseCanonical(snapshot.acquisitionMetadata)).toEqual({
      clone_url: `file://${work.path}`,
      protocol: "file",
      ref_kind: "branch",
      requested_ref: "main",
      resolved_ref: "refs/heads/main",
      shallow: true,
    });
  });

  it("keeps pinned commits readable after the branch moves and the mirror is pruned", async () => {
    const work = fixture.repo("work/orders");
    work.write("README.md", "first\n").write("docs/guide.md", "guide\n").commit("first");
    const remote = fixture.bare("remotes/orders.git", { from: work });
    const source = registerLocalSource(db, config, "orders", remote.path);
    const before = (await acquire(db, config, source)).snapshot;
    const blob = git(remote.path, ["rev-parse", `${before.commitSha}:docs/guide.md`]).trim();

    work.git("checkout", "--quiet", "--orphan", "rewrite");
    work.git("rm", "-rq", "--cached", ".");
    work.remove("docs").write("README.md", "rewritten\n").commit("rewrite");
    work.git("push", "--quiet", "--force", remote.path, "rewrite:main");
    const after = (await acquire(db, config, source)).snapshot;

    const gitDir = mirrorPath(config.repositoryStorage, source.publicId);
    prune(gitDir);
    for (const objectId of [before.commitSha, before.treeSha, blob, after.commitSha]) expect(objectExists(gitDir, objectId)).toBe(true);
    expect(git(gitDir, ["cat-file", "-p", `${before.internalRef}:docs/guide.md`])).toBe("guide\n");

    // Control: without its pin, the earlier commit is pruned.
    git(gitDir, ["update-ref", "-d", before.internalRef]);
    prune(gitDir);
    expect(objectExists(gitDir, before.commitSha)).toBe(false);
    expect(objectExists(gitDir, after.commitSha)).toBe(true);
  });

  it("never includes a local repository's uncommitted, staged, or untracked files", async () => {
    const work = fixture.repo("fleet/orders");
    work.write("README.md", "committed\n").write("src/app.js", "export const app = 1;\n").commit();

    work.write("README.md", "unstaged edit\n");
    work.write("src/app.js", "export const app = 2; // staged\n");
    work.git("add", "src/app.js");
    work.write("secret.txt", "untracked secret\n");
    const stagedBlob = work.git("hash-object", "src/app.js").trim();
    const unstagedBlob = work.git("hash-object", "README.md").trim();
    const untrackedBlob = work.git("hash-object", "secret.txt").trim();

    const source = registerLocalSource(db, config, "orders", work.path);
    const { snapshot } = await acquire(db, config, source);
    const gitDir = mirrorPath(config.repositoryStorage, source.publicId);

    expect(git(gitDir, ["ls-tree", "-r", "--name-only", snapshot.commitSha]).trim().split("\n")).toEqual(["README.md", "src/app.js"]);
    expect(git(gitDir, ["cat-file", "-p", `${snapshot.commitSha}:README.md`])).toBe("committed\n");
    expect(git(gitDir, ["cat-file", "-p", `${snapshot.commitSha}:src/app.js`])).toBe("export const app = 1;\n");
    for (const blob of [stagedBlob, unstagedBlob, untrackedBlob]) expect(objectExists(gitDir, blob)).toBe(false);
  });
});
