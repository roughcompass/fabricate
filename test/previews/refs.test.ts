import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { AcquisitionError } from "@/lib/acquisition/errors";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { FabricateConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { GitError } from "@/lib/git/errors";
import { GitRunner, type Protocol } from "@/lib/git/runner";
import { RefResolutionError, listRemoteRefs, pinCommit, previewPinRef } from "@/lib/previews/refs";
import { SnapshotReader } from "@/lib/snapshot/reader";
import { acquire, acquisitionConfig, registerLocalSource } from "../support/acquisition";
import { createTestDb } from "../support/db";
import { type BareRepo, GitFixture, type Repo, git } from "../support/git-fixture";
import { collidingCommits } from "../support/preview-trees";

/*
 * Refs and commit fetch for previews (design decision 2): branches and tags
 * read live with ls-remote, the configured reference first, and one commit
 * fetched on demand, verified, and pinned under refs/fabricate/previews/<sha>.
 */

describe("preview refs", () => {
  let fixture: GitFixture;
  let config: FabricateConfig;
  let db: Db;
  let work: Repo;
  let remote: BareRepo;
  const commits: Record<string, string> = {};

  beforeEach(() => {
    fixture = GitFixture.create("preview-refs");
    config = acquisitionConfig(fixture);
    db = createTestDb();
    work = fixture.repo("work/orders");
    commits.first = work.write("README.md", "first\n").commit("first");
    work.tag("v1.0");
    commits.second = work.write("README.md", "second\n").commit("second");
    work.tag("v1.1", { message: "Release 1.1" });
    work.branch("release/1.4");
    work.checkout("release/1.4");
    commits.release = work.write("RELEASE.md", "1.4\n").commit("release");
    work.checkout("main");
    work.branch("feature/new-nav");
    work.checkout("feature/new-nav");
    commits.feature = work.write("nav.ts", "export const nav = 1;\n").commit("nav");
    work.checkout("main");
    remote = fixture.bare("remotes/orders.git", { from: work });
  });

  afterEach(() => {
    fixture.cleanup();
    fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
  });

  const register = (gitRef: string | null = null) => registerLocalSource(db, config, "orders", remote.path, gitRef);
  const gitDir = (source: RepositorySource) => mirrorPath(config.repositoryStorage, source.publicId);
  const previewPins = (source: RepositorySource) => git(gitDir(source), ["for-each-ref", "--format=%(objectname) %(refname)", "refs/fabricate/"]).trim().split("\n").filter(Boolean);
  const objectExists = (directory: string, objectId: string) => {
    try {
      git(directory, ["cat-file", "-e", objectId]);
      return true;
    } catch {
      return false;
    }
  };

  describe("listing", () => {
    it("lists branches and tags with the default branch first when no reference is configured", async () => {
      const listing = await listRemoteRefs(register(), { config });

      expect(listing.unavailable).toBeNull();
      expect(listing.configured).toEqual({ label: "Default branch", request: { kind: "ref", name: null } });
      expect(listing.refs.map((ref) => [ref.name, ref.kind, ref.configured])).toEqual([
        ["refs/heads/main", "branch", true],
        ["refs/heads/feature/new-nav", "branch", false],
        ["refs/heads/release/1.4", "branch", false],
        ["refs/tags/v1.0", "tag", false],
        ["refs/tags/v1.1", "tag", false],
      ]);
      // An annotated tag lists the commit it points at, not the tag object.
      expect(listing.refs.find((ref) => ref.label === "v1.1")!.commit).toBe(commits.second);
      expect(listing.refs.find((ref) => ref.label === "release/1.4")!.commit).toBe(commits.release);
    });

    it("puts the configured branch or tag first", async () => {
      expect((await listRemoteRefs(register("release/1.4"), { config })).refs[0]).toMatchObject({ name: "refs/heads/release/1.4", label: "release/1.4", configured: true });
      const tagged = await listRemoteRefs({ cloneUrl: `file://${remote.path}`, gitRef: "refs/tags/v1.1" }, { config });
      expect(tagged.refs[0]).toMatchObject({ name: "refs/tags/v1.1", configured: true });
      expect(tagged.configured).toEqual({ label: "refs/tags/v1.1", request: { kind: "ref", name: "refs/tags/v1.1" } });
    });

    it("still offers the configured reference when the remote can't be listed", async () => {
      const source = register("release/1.4");
      fs.renameSync(remote.path, `${remote.path}.moved`);

      const listing = await listRemoteRefs(source, { config });
      expect(listing.refs).toEqual([]);
      expect(listing.configured).toEqual({ label: "release/1.4", request: { kind: "ref", name: "release/1.4" } });
      expect(listing.unavailable).toMatch(/.+/);
    });

    it("offers a commit configured as the reference as a commit to request", async () => {
      expect((await listRemoteRefs({ cloneUrl: `file://${remote.path}`, gitRef: commits.first! }, { config })).configured.request).toEqual({ kind: "commit", sha: commits.first });
    });
  });

  describe("pinning", () => {
    it("pins a branch's commit and records the ref as the operator chose it", async () => {
      const source = register();
      const pinned = await pinCommit(db, source, { kind: "ref", name: "feature/new-nav" }, { config });

      expect(pinned).toEqual({ commitSha: commits.feature, refName: "refs/heads/feature/new-nav", refKind: "branch" });
      expect(git(gitDir(source), ["rev-parse", previewPinRef(commits.feature!)]).trim()).toBe(commits.feature);
      // Only the pin remains; the private incoming ref is cleared.
      expect(previewPins(source)).toEqual([`${commits.feature} ${previewPinRef(commits.feature!)}`]);
    });

    it("resolves the default branch, and an annotated tag to the commit it references", async () => {
      const source = register();
      expect(await pinCommit(db, source, { kind: "ref", name: null }, { config })).toEqual({ commitSha: commits.second, refName: "refs/heads/main", refKind: "branch" });
      expect(await pinCommit(db, source, { kind: "ref", name: "v1.1" }, { config })).toEqual({ commitSha: commits.second, refName: "refs/tags/v1.1", refKind: "tag" });
      expect(git(gitDir(source), ["cat-file", "-t", previewPinRef(commits.second!)]).trim()).toBe("commit");
    });

    it("rejects a ref that moves while it's fetched, pinning neither commit", async () => {
      const source = register();
      /** Moves feature/new-nav on the remote right after it's advertised. */
      class MovingRemote extends GitRunner {
        override async lsRemote(url: string, protocol: Protocol, signal?: AbortSignal): Promise<string> {
          const advertised = await super.lsRemote(url, protocol, signal);
          work.checkout("feature/new-nav");
          commits.moved = work.write("nav.ts", "export const nav = 2;\n").commit("moved");
          work.checkout("main");
          work.git("push", "--quiet", "--force", remote.path, "feature/new-nav");
          return advertised;
        }
      }

      const attempt = pinCommit(db, source, { kind: "ref", name: "feature/new-nav" }, { config, runner: new MovingRemote({ config }) });
      await expect(attempt).rejects.toMatchObject({ name: "RefResolutionError", code: "moved" });
      await expect(attempt).rejects.toThrow(/moved from .* to .* while it was fetched\. Try again/);
      expect(previewPins(source)).toEqual([]);
    });

    it("reports a missing branch or tag as unresolved, and a name that is both as ambiguous", async () => {
      const source = register();
      await expect(pinCommit(db, source, { kind: "ref", name: "nope" }, { config })).rejects.toMatchObject({ code: "unresolved" });
      work.tag("release/1.4");
      work.git("push", "--quiet", remote.path, "refs/tags/release/1.4");
      await expect(pinCommit(db, source, { kind: "ref", name: "release/1.4" }, { config })).rejects.toMatchObject({ code: "ambiguous" });
      expect(previewPins(source)).toEqual([]);
    });

    describe("commit SHAs", () => {
      it("accepts a full SHA an advertised ref names, or that the remote supplies on its own", async () => {
        const source = register();
        expect(await pinCommit(db, source, { kind: "commit", sha: commits.release!.toUpperCase() }, { config })).toEqual({ commitSha: commits.release, refName: null, refKind: "commit" });
        // The first commit is no branch's or tag's tip... except v1.0's; this one no ref names at all.
        const unnamed = git(remote.path, ["commit-tree", `${commits.first}^{tree}`, "-m", "unnamed"]).trim();
        expect(await pinCommit(db, source, { kind: "commit", sha: unnamed }, { config })).toEqual({ commitSha: unnamed, refName: null, refKind: "commit" });
        expect(objectExists(gitDir(source), unnamed)).toBe(true);
      });

      it("uses a commit already acquired for the Repository without contacting the remote", async () => {
        const source = register();
        await pinCommit(db, source, { kind: "ref", name: "feature/new-nav" }, { config });
        fs.renameSync(remote.path, `${remote.path}.moved`);

        expect(await pinCommit(db, source, { kind: "commit", sha: commits.feature! }, { config })).toEqual({ commitSha: commits.feature, refName: null, refKind: "commit" });
      });

      it("doesn't report a remote's refusal to serve an exact SHA as proof the commit is absent", async () => {
        const source = register();
        const unnamed = git(remote.path, ["commit-tree", `${commits.first}^{tree}`, "-m", "unadvertised"]).trim();
        /** A server that, like many hosted ones, serves only advertised refs. */
        class RefusingRemote extends GitRunner {
          override async fetch(gitDirectory: string, url: string, refspecs: readonly string[], protocol: Protocol, options: { signal?: AbortSignal; shallow?: boolean } = {}): Promise<void> {
            if (refspecs.some((refspec) => /^\+[0-9a-f]{40}:/.test(refspec))) {
              const stderr = `fatal: remote error: upload-pack: not our ref ${unnamed}\nerror: Server does not allow request for unadvertised object ${unnamed}`;
              throw new GitError("command_failed", `git fetch failed (exit 128): ${stderr}`, 128, stderr);
            }
            return super.fetch(gitDirectory, url, refspecs, protocol, options);
          }
        }

        const attempt = pinCommit(db, source, { kind: "commit", sha: unnamed }, { config, runner: new RefusingRemote({ config }) });
        await expect(attempt).rejects.toMatchObject({ name: "RefResolutionError", code: "not_supplied" });
        const message = await attempt.catch((error: Error) => error.message);
        expect(message).toBe(`The remote didn't supply commit ${unnamed}. It may not exist there, or the server may not allow fetching a commit that no branch or tag names.`);
        expect(message).not.toMatch(/has no commit|does not exist/);
        expect(previewPins(source)).toEqual([]);

        // A SHA the remote truly lacks is reported the same way, never as absent.
        await expect(pinCommit(db, source, { kind: "commit", sha: "ab".repeat(20) }, { config })).rejects.toMatchObject({ code: "not_supplied" });
      });

      it("reports an unreachable remote as unreachable, not as an unsupplied commit", async () => {
        const source = register();
        fs.renameSync(remote.path, `${remote.path}.moved`);
        const attempt = pinCommit(db, source, { kind: "commit", sha: "ab".repeat(20) }, { config });
        await expect(attempt).rejects.toBeInstanceOf(AcquisitionError);
        await expect(attempt).rejects.toMatchObject({ code: "source_unavailable" });
      });

      it("resolves a prefix only when it names one advertised or acquired commit", async () => {
        const source = register();
        expect(await pinCommit(db, source, { kind: "commit", sha: commits.feature!.slice(0, 7) }, { config })).toEqual({ commitSha: commits.feature, refName: null, refKind: "commit" });

        // A prefix of no branch, tag, or acquired commit isn't resolved, even if the remote has it.
        const unnamed = git(remote.path, ["commit-tree", `${commits.first}^{tree}`, "-m", "unadvertised prefix"]).trim();
        await expect(pinCommit(db, source, { kind: "commit", sha: unnamed.slice(0, 10) }, { config })).rejects.toMatchObject({ code: "unresolved" });
        await expect(pinCommit(db, source, { kind: "commit", sha: "zz12" }, { config })).rejects.toMatchObject({ code: "unresolved" });

        // An acquired commit stays resolvable after its branch is deleted from the remote.
        git(remote.path, ["update-ref", "-d", "refs/heads/feature/new-nav"]);
        expect(await pinCommit(db, source, { kind: "commit", sha: commits.feature!.slice(0, 8) }, { config })).toMatchObject({ commitSha: commits.feature });
      });

      it("refuses a prefix that several commits share", async () => {
        const source = register();
        const [left, right] = collidingCommits(remote, 4);
        git(remote.path, ["update-ref", "refs/heads/left", left]);
        git(remote.path, ["update-ref", "refs/heads/right", right]);

        const attempt = pinCommit(db, source, { kind: "commit", sha: left.slice(0, 4) }, { config });
        await expect(attempt).rejects.toMatchObject({ name: "RefResolutionError", code: "ambiguous" });
        await expect(attempt).rejects.toThrow(`${left.slice(0, 4)} matches 2 commits of this Repository. Enter more of the SHA.`);
        expect(previewPins(source)).toEqual([]);
        expect(await pinCommit(db, source, { kind: "commit", sha: left.slice(0, 12) }, { config })).toMatchObject({ commitSha: left });
      });
    });

    it("keeps the pinned commit through acquisition and pruning after its branch is rewritten", async () => {
      const source = register();
      await pinCommit(db, source, { kind: "ref", name: "feature/new-nav" }, { config });
      const blob = git(remote.path, ["rev-parse", `${commits.feature}:nav.ts`]).trim();

      // Rewrite the branch so nothing on the remote reaches the pinned commit, then acquire and prune.
      work.git("checkout", "--quiet", "--orphan", "rewrite");
      work.git("rm", "-rq", "--cached", ".");
      work.remove("nav.ts").write("README.md", "rewritten\n").commit("rewrite");
      work.git("push", "--quiet", "--force", remote.path, "rewrite:feature/new-nav");
      await acquire(db, config, { ...source, gitRef: "feature/new-nav" });
      const prune = () => {
        git(gitDir(source), ["-c", "gc.reflogExpire=now", "-c", "gc.reflogExpireUnreachable=now", "-c", "gc.pruneExpire=now", "gc", "--quiet", "--prune=now"]);
        git(gitDir(source), ["prune", "--expire=now"]);
      };
      prune();

      for (const objectId of [commits.feature!, blob]) expect(objectExists(gitDir(source), objectId)).toBe(true);
      const reader = await SnapshotReader.open(new GitRunner({ config }), gitDir(source), previewPinRef(commits.feature!), commits.feature!, config.analysis);
      const read = await reader.read("nav.ts");
      expect(read.ok && read.content.text).toBe("export const nav = 1;\n");

      // Control: without its pin, the commit is pruned.
      git(gitDir(source), ["update-ref", "-d", previewPinRef(commits.feature!)]);
      prune();
      expect(objectExists(gitDir(source), commits.feature!)).toBe(false);
    });

    it("lets the snapshot reader open only a preview pin of the commit it names", async () => {
      const source = register();
      await pinCommit(db, source, { kind: "ref", name: "feature/new-nav" }, { config });
      const runner = new GitRunner({ config });
      await expect(SnapshotReader.open(runner, gitDir(source), previewPinRef(commits.feature!), commits.second!, config.analysis)).rejects.toThrow(/pinned internal refs/);
      await expect(SnapshotReader.open(runner, gitDir(source), "refs/heads/main", commits.feature!, config.analysis)).rejects.toThrow(/pinned internal refs/);
    });

    it("refuses malformed requests before contacting the remote", async () => {
      const source = register();
      await expect(pinCommit(db, source, { kind: "commit", sha: "abc" }, { config })).rejects.toBeInstanceOf(RefResolutionError);
      await expect(pinCommit(db, source, { kind: "ref", name: "--upload-pack=evil" }, { config })).rejects.toMatchObject({ code: "unresolved" });
      expect(fs.existsSync(gitDir(source))).toBe(false);
    });
  });
});
