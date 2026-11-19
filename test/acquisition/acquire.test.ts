import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { acquireSnapshot } from "@/lib/acquisition/acquire";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { withSourceLock } from "@/lib/acquisition/source-lease";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { snapshotOf } from "@/lib/assessments/assessment-records";
import type { FabricateConfig } from "@/lib/config";
import { type BareRepo, type Repo, git } from "../support/git-fixture";
import { acquire, acquiringTarget, registerLocalSource, useAcquisitionWorld } from "../support/acquisition";

describe("controlled acquisition", () => {
  const world = useAcquisitionWorld("acquire");
  let work: Repo;
  let remote: BareRepo;
  let first: string;
  let second: string;

  beforeEach(() => {
    work = world.fixture.repo("work/orders", { branch: "trunk" });
    first = work.write("README.md", "one\n").commit("one");
    second = work.write("README.md", "two\n").commit("two");
    work.tag("v1.0", { message: "Release 1.0" }).tag("light");
    work.branch("feature").checkout("feature");
    work.write("feature.txt", "feature\n").commit("feature");
    work.checkout("trunk");
    remote = world.fixture.bare("remotes/orders.git", { from: work });
  });

  const mirrorGit = (sourcePublicId: string, ...args: string[]) => git(mirrorPath(world.config.repositoryStorage, sourcePublicId), args).trim();

  it("acquires the default branch into a managed bare mirror", async () => {
    const source = registerLocalSource(world.db, world.config, "orders", remote.path);
    const { target, snapshot } = await acquire(world.db, world.config, source);

    expect(snapshot).toMatchObject({ commitSha: second, refKind: "default_branch", resolvedRef: "refs/heads/trunk", repositorySourceId: source.id });
    expect(snapshot.treeSha).toBe(remote.rev(`${second}^{tree}`));
    expect(snapshotOf(world.db, target.id)?.id).toBe(snapshot.id);
    expect(fs.existsSync(path.join(mirrorPath(world.config.repositoryStorage, source.publicId), "HEAD"))).toBe(true);
    expect(mirrorGit(source.publicId, "rev-parse", "--is-bare-repository")).toBe("true");
  });

  it.each([
    ["a branch", "feature", "branch", "refs/heads/feature", () => work.rev("feature")],
    ["an annotated tag", "v1.0", "tag", "refs/tags/v1.0", () => second],
    ["a lightweight tag", "light", "tag", "refs/tags/light", () => second],
    ["a fully qualified branch", "refs/heads/feature", "branch", "refs/heads/feature", () => work.rev("feature")],
    ["a commit that is not a branch tip", null, "commit", null, () => first],
  ] as const)("acquires %s", async (_label, ref, kind, resolvedRef, commit) => {
    const source = registerLocalSource(world.db, world.config, "orders", remote.path, ref ?? first);
    const { snapshot } = await acquire(world.db, world.config, source);

    expect(snapshot).toMatchObject({ refKind: kind, resolvedRef: resolvedRef ?? first, commitSha: commit() });
  });

  it("follows a force-updated branch while keeping the earlier snapshot pinned", async () => {
    const source = registerLocalSource(world.db, world.config, "orders", remote.path, "trunk");
    const before = (await acquire(world.db, world.config, source)).snapshot;

    work.git("checkout", "--quiet", "--orphan", "rewrite");
    work.git("rm", "-rq", "--cached", ".");
    const rewritten = work.write("NEW.md", "rewritten history\n").commit("rewrite");
    work.git("push", "--quiet", "--force", remote.path, "rewrite:trunk");

    const after = (await acquire(world.db, world.config, source)).snapshot;
    expect(after.commitSha).toBe(rewritten);
    expect(before.commitSha).toBe(second);
    expect(mirrorGit(source.publicId, "rev-parse", `${before.internalRef}^{commit}`)).toBe(second);
    expect(mirrorGit(source.publicId, "rev-parse", `${after.internalRef}^{commit}`)).toBe(rewritten);
  });

  it("leaves no private incoming refs behind", async () => {
    const source = registerLocalSource(world.db, world.config, "orders", remote.path, "feature");
    const { snapshot } = await acquire(world.db, world.config, source);

    expect(mirrorGit(source.publicId, "for-each-ref", "--format=%(refname)")).toBe(snapshot.internalRef);
  });

  it("refuses a name that is both a branch and a tag", async () => {
    work.tag("feature");
    work.git("push", "--quiet", remote.path, "refs/tags/feature");
    const source = registerLocalSource(world.db, world.config, "orders", remote.path, "feature");

    await expect(acquire(world.db, world.config, source)).rejects.toMatchObject({ code: "ambiguous_ref", message: expect.stringContaining("refs/heads/feature or refs/tags/feature") });
  });

  it.each([
    ["a missing branch", "does-not-exist", /no branch or tag named does-not-exist/],
    ["an abbreviated commit", "abc1234", /full 40-character commit SHA/],
    ["an unknown commit", "0123456789abcdef0123456789abcdef01234567", /./],
  ])("reports %s as an invalid reference", async (_label, ref, message) => {
    const source = registerLocalSource(world.db, world.config, "orders", remote.path, ref);
    const error = await acquire(world.db, world.config, source).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AcquisitionError);
    expect(error).toMatchObject({ code: "invalid_ref", message: expect.stringMatching(message) });
  });

  it("fails with lock_timeout while other work holds the source's mirror", async () => {
    const source = registerLocalSource(world.db, world.config, "orders", remote.path);
    const target = acquiringTarget(world.db, source);
    let release!: () => void;
    const held = withSourceLock(source.id, { waitMs: 1_000 }, () => new Promise<void>((resolve) => (release = resolve)));

    const quick = { ...world.config, gitLockTimeoutSeconds: 1 } as FabricateConfig;
    await expect(acquireSnapshot(world.db, target, { config: quick })).rejects.toMatchObject({ code: "lock_timeout" });
    release();
    await held;
  });
});
