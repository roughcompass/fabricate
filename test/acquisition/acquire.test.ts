import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { gitSource, resolveReference, resolveTarget } from "@/lib/acquisition/acquire";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { withSourceLock } from "@/lib/acquisition/source-lease";
import { Mirror, mirrorPath, surveyRefFor } from "@/lib/acquisition/mirror";
import { getTarget } from "@/lib/runs/run-records";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { FrontendRegistryConfig } from "@/lib/config";
import { surveys } from "@/lib/db/schema";
import { GitRunner } from "@/lib/git/runner";
import { currentRecipe, moveSurvey, requestSurvey } from "@/lib/surveys/records";
import { pinSurveyCommit } from "@/lib/surveys/run";
import { type BareRepo, type Repo, git } from "../support/git-fixture";
import { acquire, acquiringTarget, registerLocalSource, useAcquisitionWorld } from "../support/acquisition";

describe("reference resolution and survey pinning", () => {
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
  const runner = () => new GitRunner({ config: world.config });

  describe("Mirror.resolve", () => {
    /** The mirror of +source+ and the URL and transport Git reaches its remote with. */
    const mirrorOf = (source: RepositorySource) => ({ mirror: new Mirror(runner(), source.publicId), ...gitSource(source, new SourceBoundary(world.config)) });

    it.each([
      ["the default branch", null, "default_branch", "refs/heads/trunk", () => second],
      ["a branch", "feature", "branch", "refs/heads/feature", () => work.rev("feature")],
      ["an annotated tag, peeled to its commit", "v1.0", "tag", "refs/tags/v1.0", () => second],
      ["a lightweight tag", "light", "tag", "refs/tags/light", () => second],
    ] as const)("returns the commit the remote advertises for %s, before anything is fetched", async (_label, ref, kind, name, commit) => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path, ref);
      const { mirror, url, protocol } = mirrorOf(source);

      expect(await mirror.resolve(url, protocol, ref)).toEqual({ kind, name, commitSha: commit() });
      expect(fs.existsSync(mirror.gitDir)).toBe(false);
    });

    it("names an annotated tag's commit, not the tag object", async () => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path, "v1.0");
      const { mirror, url, protocol } = mirrorOf(source);
      const tagObject = remote.rev("refs/tags/v1.0");

      expect(tagObject).not.toBe(second);
      expect((await mirror.resolve(url, protocol, "v1.0")).commitSha).toBe(remote.rev("v1.0^{commit}"));
    });

    it("takes a full commit SHA as it is, without asking the remote", async () => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path, first);
      const { mirror, url, protocol } = mirrorOf(source);
      fs.rmSync(remote.path, { recursive: true, force: true });

      expect(await mirror.resolve(url, protocol, first)).toEqual({ kind: "commit", name: first, commitSha: first });
    });
  });

  describe("resolving a Run target", () => {
    it("returns the resolution and leaves the target acquiring, with nothing fetched and no survey", async () => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path);
      const target = acquiringTarget(world.db, source);

      expect(await resolveTarget(world.db, target, { config: world.config })).toEqual({ ok: true, resolution: { kind: "default_branch", name: "refs/heads/trunk", commitSha: second } });
      expect(getTarget(world.db, target.publicId)).toMatchObject({ state: "acquiring", refKind: null, surveyId: null });
      expect(world.db.select().from(surveys).all()).toEqual([]);
      expect(fs.existsSync(mirrorPath(world.config.repositoryStorage, source.publicId))).toBe(false);
    });
  });

  describe("pinning a survey's commit", () => {
    it("pins the default branch's commit into a managed bare mirror under the survey's ref", async () => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path);
      const { survey, snapshot } = await acquire(world.db, world.config, source);

      expect(snapshot).toMatchObject({ commitSha: second, refKind: "default_branch", resolvedRef: "refs/heads/trunk", internalRef: surveyRefFor(survey.publicId) });
      expect(snapshot.treeSha).toBe(remote.rev(`${second}^{tree}`));
      expect(survey).toMatchObject({ repositorySourceId: source.id, commitSha: second, treeSha: snapshot.treeSha, internalRef: snapshot.internalRef, reference: "refs/heads/trunk" });
      expect(fs.existsSync(path.join(mirrorPath(world.config.repositoryStorage, source.publicId), "HEAD"))).toBe(true);
      expect(mirrorGit(source.publicId, "rev-parse", "--is-bare-repository")).toBe("true");
      expect(mirrorGit(source.publicId, "rev-parse", `${snapshot.internalRef}^{commit}`)).toBe(second);
    });

    it.each([
      ["a branch", "feature", "branch", "refs/heads/feature", () => work.rev("feature")],
      ["an annotated tag", "v1.0", "tag", "refs/tags/v1.0", () => second],
      ["a lightweight tag", "light", "tag", "refs/tags/light", () => second],
      ["a fully qualified branch", "refs/heads/feature", "branch", "refs/heads/feature", () => work.rev("feature")],
      ["a commit that is not a branch tip", null, "commit", null, () => first],
    ] as const)("pins %s", async (_label, ref, kind, resolvedRef, commit) => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path, ref ?? first);
      const { snapshot } = await acquire(world.db, world.config, source);

      expect(snapshot).toMatchObject({ refKind: kind, resolvedRef: resolvedRef ?? first, commitSha: commit() });
      expect(mirrorGit(source.publicId, "rev-parse", `${snapshot.internalRef}^{commit}`)).toBe(commit());
    });

    it("follows a force-updated branch while keeping the earlier survey's commit pinned", async () => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path, "trunk");
      const before = await acquire(world.db, world.config, source);

      work.git("checkout", "--quiet", "--orphan", "rewrite");
      work.git("rm", "-rq", "--cached", ".");
      const rewritten = work.write("NEW.md", "rewritten history\n").commit("rewrite");
      work.git("push", "--quiet", "--force", remote.path, "rewrite:trunk");

      const after = await acquire(world.db, world.config, source);
      expect(after.survey.id).not.toBe(before.survey.id);
      expect(after.snapshot.commitSha).toBe(rewritten);
      expect(before.snapshot.commitSha).toBe(second);
      expect(mirrorGit(source.publicId, "rev-parse", `${before.snapshot.internalRef}^{commit}`)).toBe(second);
      expect(mirrorGit(source.publicId, "rev-parse", `${after.snapshot.internalRef}^{commit}`)).toBe(rewritten);
    });

    it("pins a commit the mirror already holds without fetching it again", async () => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path);
      const { survey } = await acquire(world.db, world.config, source);
      // Without the remote, a fetch would fail.
      fs.rmSync(remote.path, { recursive: true, force: true });

      // The same commit under another recipe is another survey, with its own pin.
      const { survey: other } = requestSurvey(world.db, { repositorySourceId: source.id, commitSha: survey.commitSha, reference: survey.reference, fromConfiguredReference: true, trigger: "recipe", ...currentRecipe(world.config), configurationDigest: "a".repeat(64) });
      const running = moveSurvey(world.db, other, "running", { attempts: 1 });
      const pinned = await pinSurveyCommit(world.db, running, source, { config: world.config, runner: runner(), boundary: new SourceBoundary(world.config) });

      expect(pinned).toMatchObject({ internalRef: surveyRefFor(other.publicId), treeSha: survey.treeSha });
      expect(mirrorGit(source.publicId, "rev-parse", `${pinned.internalRef}^{commit}`)).toBe(survey.commitSha);
    });

    it("leaves no private incoming refs behind", async () => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path, "feature");
      const { snapshot } = await acquire(world.db, world.config, source);

      expect(mirrorGit(source.publicId, "for-each-ref", "--format=%(refname)")).toBe(snapshot.internalRef);
    });

    it("fails with lock_timeout while other work holds the source's mirror", async () => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path);
      let release!: () => void;
      const held = withSourceLock(source.id, { waitMs: 1_000 }, () => new Promise<void>((resolve) => (release = resolve)));

      const quick = { ...world.config, gitLockTimeoutSeconds: 1 } as FrontendRegistryConfig;
      await expect(acquire(world.db, quick, source)).rejects.toMatchObject({ code: "lock_timeout" });
      release();
      await held;
    });
  });

  describe("references that can't be used", () => {
    it("refuses a name that is both a branch and a tag", async () => {
      work.tag("feature");
      work.git("push", "--quiet", remote.path, "refs/tags/feature");
      const source = registerLocalSource(world.db, world.config, "orders", remote.path, "feature");

      await expect(resolveReference({ sourcePublicId: source.publicId, cloneUrl: source.cloneUrl, gitRef: source.gitRef }, { config: world.config })).rejects.toMatchObject({
        code: "ambiguous_ref",
        message: expect.stringContaining("refs/heads/feature or refs/tags/feature"),
      });
    });

    it.each([
      ["a missing branch", "does-not-exist", /no branch or tag named does-not-exist/],
      ["an abbreviated commit", "abc1234", /full 40-character commit SHA/],
    ])("reports %s as an invalid reference before any survey is requested", async (_label, ref, message) => {
      const source = registerLocalSource(world.db, world.config, "orders", remote.path, ref);
      const error = await acquire(world.db, world.config, source).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AcquisitionError);
      expect(error).toMatchObject({ code: "invalid_ref", message: expect.stringMatching(message) });
      expect(world.db.select().from(surveys).all()).toEqual([]);
    });

    it("reports an unknown commit as an invalid reference when its survey pins it", async () => {
      const unknown = "0123456789abcdef0123456789abcdef01234567";
      const source = registerLocalSource(world.db, world.config, "orders", remote.path, unknown);
      const error = await acquire(world.db, world.config, source).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AcquisitionError);
      expect(error).toMatchObject({ code: "invalid_ref", message: expect.stringContaining(unknown) });
      expect(mirrorGit(source.publicId, "for-each-ref", "--format=%(refname)")).toBe("");
    });
  });
});
