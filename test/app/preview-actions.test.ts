import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewOutcome } from "@/app/(operator)/repositories/outcomes";
import { buildPreview, deletePreviewAction, preparePreview, rebuildPreview } from "@/app/(operator)/repositories/preview-actions";
import type { PrepareFormState } from "@/app/(operator)/repositories/preview-form-state";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { setDb } from "@/lib/db/client";
import { previewBuilds } from "@/lib/db/schema";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { BUILD_PREVIEW, decidePreparation, failAttempt, findPreparation, findPreview, openPreparation } from "@/lib/previews/records";
import type { PackageVerdict } from "@/lib/previews/eligibility";
import { previewDirectory } from "@/lib/previews/storage";
import { requestSurvey } from "@/lib/surveys/records";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { buildRepository } from "../support/builders";
import { rawRun } from "../support/db";
import { type Tree, offlineViteApp } from "../support/preview-trees";
import { publishFiles, queuedPreview } from "../support/previews";
import { formData, redirectOf } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

/*
 * The Repository page's and the preview page's Server Actions (tasks 6.1 and
 * 6.4): preparing a ref or commit, building a chosen package, Rebuild, and
 * Delete. Each answers not found unless previews are on and the remote is
 * enrolled, like the pages.
 */

const INITIAL: PrepareFormState = { values: { ref: "configured", commit: "" }, errors: {} };
const NODE_BIN = path.dirname(process.execPath);
const verdict = (directory: string): PackageVerdict => ({
  directory,
  manifest: `${directory}/package.json`,
  name: directory.split("/").at(-1)!,
  qualifies: true,
  conditions: [],
  plan: { installRoot: ".", packageManager: { name: "npm", version: null, lockfile: "package-lock.json" }, buildTool: "vite", buildScript: "vite build", node: { version: process.versions.node, ranges: [] }, layout: "standalone", composition: null },
});

describe("preview Server Actions", () => {
  const original = getConfig();
  const world = useAcquisitionWorld("preview-actions");
  let storage: string;

  beforeEach(() => {
    setDb(world.db);
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-actions-")));
  });

  afterEach(() => {
    setDb(undefined);
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  function enroll(repository: Repository, previews: Partial<FrontendRegistryConfig["settings"]["previews"]> = {}): FrontendRegistryConfig {
    const config = withOverrides(world.config, { previews: { enabled: true, trustedSources: [repository.cloneUrl], nodeVersions: { [process.versions.node]: NODE_BIN }, storage, ...previews } });
    setConfig(config);
    return config;
  }

  /** A remote holding +tree+ on main and +branches+, registered and enrolled. */
  function enrolledRepository(tree: Tree, branches: Record<string, Tree> = {}): Repository {
    const work = world.fixture.repo("work/orders-web");
    for (const [file, content] of Object.entries(tree)) work.write(file, content);
    work.commit("initial");
    for (const [branch, files] of Object.entries(branches)) {
      work.git("checkout", "--quiet", "-b", branch);
      for (const [file, content] of Object.entries(files)) work.write(file, content);
      work.commit(branch);
      work.checkout("main");
    }
    const remote = world.fixture.bare("remotes/orders-web.git", { from: work });
    const repository = registerLocalRepository(world.db, world.config, "orders-web", remote.path);
    enroll(repository);
    return repository;
  }

  const notFound = async (work: Promise<unknown>) => expect(await redirectOf(work)).toBe("not-found");

  describe("preparing", () => {
    it("pins the configured reference, a branch, or a commit, and shows its preparation on the Repository page", async () => {
      const repository = enrolledRepository(offlineViteApp(), { "feature/new-nav": offlineViteApp({ heading: "New nav" }) });

      const configured = await redirectOf(preparePreview(repository.publicId, INITIAL, formData({ ref: "configured", commit: "" })));
      expect(configured).toMatch(new RegExp(`^/repositories/${repository.publicId}\\?preparation=ppr_[a-z0-9]{16}#previews$`));
      const preparation = findPreparation(world.db, /preparation=(ppr_\w+)/.exec(configured)![1]!)!;
      expect(preparation).toMatchObject({ state: "profiling", refName: "refs/heads/main", refKind: "branch" });

      const branch = await redirectOf(preparePreview(repository.publicId, INITIAL, formData({ ref: "refs/heads/feature/new-nav", commit: "" })));
      expect(findPreparation(world.db, /preparation=(ppr_\w+)/.exec(branch)![1]!)).toMatchObject({ refName: "refs/heads/feature/new-nav" });

      // A commit SHA takes the branch's place, and a prefix of a pinned commit resolves.
      const commit = await redirectOf(preparePreview(repository.publicId, INITIAL, formData({ ref: "refs/heads/feature/new-nav", commit: ` ${preparation.commitSha.slice(0, 10).toUpperCase()} ` })));
      expect(findPreparation(world.db, /preparation=(ppr_\w+)/.exec(commit)![1]!)).toMatchObject({ commitSha: preparation.commitSha, publicId: preparation.publicId });
    });

    it("reports a ref or commit that can't be resolved under its field, and keeps the values", async () => {
      const repository = enrolledRepository(offlineViteApp());
      expect(await preparePreview(repository.publicId, INITIAL, formData({ ref: "main", commit: "" }))).toEqual({ values: { ref: "main", commit: "" }, errors: { ref: ["Choose a branch or tag, or enter a commit"] } });
      expect((await preparePreview(repository.publicId, INITIAL, formData({ ref: "refs/heads/gone", commit: "" }))).errors.ref?.[0]).toMatch(/gone/);
      expect((await preparePreview(repository.publicId, INITIAL, formData({ ref: "configured", commit: "xyz" }))).errors.commit).toEqual(["Enter at least 4 hexadecimal characters of a commit SHA"]);
      expect((await preparePreview(repository.publicId, INITIAL, formData({ ref: "configured", commit: "0000000" }))).errors.commit?.[0]).toMatch(/^No branch, tag, or acquired commit of this Repository starts with 0000000/);
      expect((await preparePreview(repository.publicId, INITIAL, formData({ ref: "configured", commit: "f".repeat(40) }))).errors.commit?.[0]).toMatch(/The remote didn't supply commit f{40}/);
    });

    it("reports a remote that can't be reached on the form", async () => {
      const repository = enrolledRepository(offlineViteApp());
      fs.rmSync(world.fixture.dir("remotes/orders-web.git"), { recursive: true, force: true });
      const state = await preparePreview(repository.publicId, INITIAL, formData({ ref: "configured", commit: "" }));
      expect(state.errors.base?.[0]).toBeTruthy();
    });

    it("answers not found while previews are off or the remote isn't enrolled", async () => {
      const repository = enrolledRepository(offlineViteApp());
      enroll(repository, { enabled: false });
      await notFound(preparePreview(repository.publicId, INITIAL, formData({ ref: "configured", commit: "" })));
      enroll(repository, { trustedSources: [] });
      await notFound(preparePreview(repository.publicId, INITIAL, formData({ ref: "configured", commit: "" })));
      await expect(preparePreview("not-an-id", INITIAL, formData({}))).rejects.toThrow(/Unknown Repository/);
    });
  });

  describe("choosing a package", () => {
    function decided(repository: Repository, packages: PackageVerdict[]) {
      const commitSha = "d".repeat(40);
      const { preparation } = openPreparation(world.db, repository, { commitSha, refName: "refs/heads/main", refKind: "branch" });
      const { survey } = requestSurvey(world.db, { repositoryId: repository.id, commitSha, reference: "refs/heads/main", fromConfiguredReference: false, trigger: "preview", surveyorRelease: "0.0.0", configurationDigest: "f".repeat(64), profileSchemaVersion: 2 });
      decidePreparation(world.db, preparation.publicId, preparation.requestedAt.getTime(), { surveyId: survey.id, digest: "f".repeat(64) }, { packages, refusal: null });
      rawRun(world.db, "delete from jobs");
      return preparation.publicId;
    }

    it("builds the chosen package, then opens its preview when chosen again", async () => {
      const repository = buildRepository(world.db, { name: "portal" });
      enroll(repository);
      const preparation = decided(repository, [verdict("apps/shell"), verdict("apps/admin")]);
      const fields = { source: repository.publicId, preparation, package: "apps/shell" };

      const queued = await redirectOf(buildPreview(formData(fields)));
      const [preview] = world.db.select().from(previewBuilds).all();
      expect(preview).toMatchObject({ packageDir: "apps/shell", attemptState: "queued" });
      expect(queued).toBe(`/repositories/${repository.publicId}/previews/${preview!.publicId}?notice=queued`);
      expect(previewOutcome(world.db, "queued", preview!.publicId)).toMatchObject({ tone: "success", title: "The build of shell is queued." });

      expect(await redirectOf(buildPreview(formData(fields)))).toBe(`/repositories/${repository.publicId}/previews/${preview!.publicId}`);
      expect(world.db.select().from(previewBuilds).all()).toHaveLength(1);
      // A package that doesn't qualify shows the preparation as it stands.
      expect(await redirectOf(buildPreview(formData({ ...fields, package: "packages/ui" })))).toBe(`/repositories/${repository.publicId}?preparation=${preparation}#previews`);
      enroll(repository, { enabled: false });
      await notFound(buildPreview(formData({ ...fields, package: "apps/admin" })));
      expect(world.db.select().from(previewBuilds).all()).toHaveLength(1);
    });
  });

  describe("Rebuild and Delete", () => {
    it("rebuilds a finished preview on the device it was viewed on, and says so when it's already building", async () => {
      const repository = buildRepository(world.db, { name: "orders" });
      const config = enroll(repository);
      const preview = publishFiles(world.db, config, queuedPreview(world.db, repository), { "index.html": "<h1>Orders</h1>" });

      const rebuilt = await redirectOf(rebuildPreview(formData({ preview: preview.publicId, device: "mobile", orientation: "landscape" })));
      expect(rebuilt).toBe(`/repositories/${repository.publicId}/previews/${preview.publicId}?device=mobile&orientation=landscape&notice=rebuilt`);
      expect(findPreview(world.db, preview.publicId)).toMatchObject({ attempt: 2, attemptState: "queued", artifactAttempt: 1 });
      expect(previewOutcome(world.db, "rebuilt", preview.publicId)).toMatchObject({ title: "Attempt 2 of orders is queued.", description: "The current output stays up until the new build is ready." });

      expect(await redirectOf(rebuildPreview(formData({ preview: preview.publicId, device: "desktop" })))).toBe(`/repositories/${repository.publicId}/previews/${preview.publicId}?notice=building`);
      expect(findPreview(world.db, preview.publicId)!.attempt).toBe(2);

      enroll(repository, { enabled: false });
      failAttempt(world.db, preview.publicId, { attempt: 2 }, "The build failed");
      await notFound(rebuildPreview(formData({ preview: preview.publicId })));
      expect(findPreview(world.db, preview.publicId)!.attempt).toBe(2);
    });

    it("deletes a preview and its files, and says so on the Repository page", async () => {
      const repository = buildRepository(world.db, { name: "orders" });
      const config = enroll(repository);
      const preview = publishFiles(world.db, config, queuedPreview(world.db, repository), { "index.html": "<h1>Orders</h1>" });
      const directory = previewDirectory(config, preview.publicId);
      expect(fs.existsSync(directory)).toBe(true);

      // Turned off, nothing is deleted.
      enroll(repository, { enabled: false });
      await notFound(deletePreviewAction(formData({ preview: preview.publicId })));
      expect(findPreview(world.db, preview.publicId)).toBeDefined();

      enroll(repository);
      expect(await redirectOf(deletePreviewAction(formData({ preview: preview.publicId })))).toBe(`/repositories/${repository.publicId}?notice=preview-deleted&preview=${preview.publicId}#previews`);
      expect(findPreview(world.db, preview.publicId)).toBeUndefined();
      expect(fs.existsSync(directory)).toBe(false);
      expect(previewOutcome(world.db, "preview-deleted", preview.publicId)).toMatchObject({ tone: "success", title: `The preview of orders at ${preview.commitSha.slice(0, 12)} was deleted.` });
      // An outcome code never speaks for a preview in another state, or an unknown one.
      expect(previewOutcome(world.db, "queued", preview.publicId)).toBeUndefined();
      expect(previewOutcome(world.db, "preview-deleted", "pvw_0000000000000000")).toBeUndefined();
      await notFound(deletePreviewAction(formData({ preview: preview.publicId })));
    });
  });

  describe.skipIf(!fs.existsSync(path.join(NODE_BIN, "npm")))("an offline app, end to end", () => {
    it("prepares the default branch, builds its one package without asking, and rebuilds it", async () => {
      const repository = enrolledRepository(offlineViteApp());
      const config = getConfig();
      await redirectOf(preparePreview(repository.publicId, INITIAL, formData({ ref: "configured", commit: "" })));
      await drainJobs(world.db, jobHandlers(world.db, config));

      const [preview] = world.db.select().from(previewBuilds).all();
      expect(preview).toMatchObject({ packageDir: ".", refName: "refs/heads/main", attemptState: "ready", artifactLayout: "standalone" });
      const page = fs.readFileSync(path.join(previewDirectory(config, preview!.publicId), preview!.artifact!, "index.html"), "utf8");
      expect(page).toContain(`src="/previews/${preview!.publicId}/assets/index.js"`);
      expect(preview!.artifactEntry).toMatchObject({ file: "index.html", rebase: false });

      await redirectOf(rebuildPreview(formData({ preview: preview!.publicId })));
      const jobs = world.db.$client.prepare("select idempotency_key as key, state from jobs where kind = ? order by id").all(BUILD_PREVIEW);
      expect(jobs).toEqual([
        { key: `${BUILD_PREVIEW}:${preview!.publicId}:1`, state: "succeeded" },
        { key: `${BUILD_PREVIEW}:${preview!.publicId}:2`, state: "queued" },
      ]);
    });
  });
});
