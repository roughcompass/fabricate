import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { detectorConfiguration } from "@repo-facts/bundle";
import { describe, expect, it } from "vitest";
import { mirrorPath } from "@/lib/acquisition/mirror";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type FabricateConfig, withOverrides } from "@/lib/config";
import { jobs, previewBuilds, previewPreparations, profileVersions, repositoryProfiles } from "@/lib/db/schema";
import { readDocument } from "@/lib/documents/digested";
import { jobPayload } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { requestPreparation } from "@/lib/previews/preparation";
import { BUILD_PREVIEW, PREPARE_PREVIEW, type PreviewPreparation, findPreparation, preparationPackages, preparationRefusal, startPreview } from "@/lib/previews/records";
import type { RefRequest } from "@/lib/previews/refs";
import { currentProfile } from "@/lib/profiling/current";
import { queueProfile, versionsOf } from "@/lib/profiling/versions";
import { registerLocalSource, useAcquisitionWorld } from "../support/acquisition";
import { type BareRepo, type Repo, git } from "../support/git-fixture";
import { FEDERATED_WORKSPACE, NEXT_APP, NPM_WORKSPACE, SCALA_SERVICE, type Tree, VITE_REACT_APP, collidingCommits, offlineViteLibrary } from "../support/preview-trees";

/*
 * Preparing a pinned commit before any package build (design decision 3):
 * the Repository's own Profile when it's of that commit, else a static run
 * of the same detector kept with the preparation, never a profile version;
 * then one qualifying package starts its preview, several wait for a choice,
 * and none leaves a refusal without a build row.
 */

const NODE = { "20.18.1": "/opt/node-20/bin", "22.11.0": "/opt/node-22/bin" };

describe("preview preparation", () => {
  const world = useAcquisitionWorld("preview-preparation");
  let config: FabricateConfig;

  const settings = (source: RepositorySource, previews: Partial<FabricateConfig["settings"]["previews"]> = {}) =>
    withOverrides(world.config, { previews: { enabled: true, trustedSources: [source.cloneUrl], nodeVersions: NODE, ...previews } });

  /** A remote holding +tree+ on main, registered and enrolled. */
  function repository(tree: Tree, name = "orders"): { work: Repo; remote: BareRepo; source: RepositorySource; commit: string } {
    const work = world.fixture.repo(`work/${name}`);
    for (const [file, content] of Object.entries(tree)) work.write(file, content);
    const commit = work.commit("initial");
    const remote = world.fixture.bare(`remotes/${name}.git`, { from: work });
    const source = registerLocalSource(world.db, world.config, name, remote.path);
    config = settings(source);
    return { work, remote, source, commit };
  }

  /** Commits +tree+, in place of everything, on a new branch +branch+ and pushes it. */
  function branch(work: Repo, remote: BareRepo, name: string, tree: Tree): string {
    work.git("checkout", "--quiet", "-b", name);
    work.git("rm", "-rq", ".");
    for (const [file, content] of Object.entries(tree)) work.write(file, content);
    const commit = work.commit(name);
    work.git("push", "--quiet", remote.path, name);
    work.checkout("main");
    return commit;
  }

  const request = (source: RepositorySource, ref: RefRequest = { kind: "ref", name: null }) => requestPreparation(world.db, source.publicId, ref, { config });
  /** Runs every queued preparation job through the worker's registered handler. */
  async function runPreparations(): Promise<void> {
    const handler = jobHandlers(world.db, config)[PREPARE_PREVIEW]!;
    for (const job of world.db.select().from(jobs).where(and(eq(jobs.kind, PREPARE_PREVIEW), eq(jobs.state, "queued"))).all()) {
      await handler(jobPayload(job), { job, signal: new AbortController().signal });
      world.db.update(jobs).set({ state: "succeeded", finishedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id)).run();
    }
  }
  const prepared = async (source: RepositorySource, ref?: RefRequest): Promise<PreviewPreparation> => {
    const preparation = await request(source, ref);
    await runPreparations();
    return findPreparation(world.db, preparation.publicId)!;
  };
  const builds = () => world.db.select().from(previewBuilds).all();
  const buildJobs = () => world.db.select().from(jobs).where(eq(jobs.kind, BUILD_PREVIEW)).all();
  const counts = () => ({
    versions: world.db.select().from(profileVersions).all().length,
    profiles: world.db.select().from(repositoryProfiles).all().length,
    assessments: world.db.$client.prepare("select count(*) as n from assessments").get(),
    snapshots: world.db.$client.prepare("select count(*) as n from source_snapshots").get(),
  });
  /** Profiles +source+ as the background profiling does: version 1 of its default branch. */
  async function profile(source: RepositorySource): Promise<void> {
    queueProfile(world.db, source, "added", { config });
    await drainJobs(world.db, jobHandlers(world.db, config));
  }

  describe("profiles", () => {
    it("profiles a branch's commit statically for the preparation, leaving the Repository's profile versions unchanged", async () => {
      const { work, remote, source } = repository(VITE_REACT_APP);
      const next = branch(work, remote, "feature/next", NEXT_APP);
      await profile(source);
      const before = counts();
      expect(before.versions).toBe(1);

      const preparation = await request(source, { kind: "ref", name: "feature/next" });
      expect(preparation).toMatchObject({ state: "profiling", commitSha: next, refName: "refs/heads/feature/next", refKind: "branch" });
      await runPreparations();
      const decided = findPreparation(world.db, preparation.publicId)!;

      // Decided from this commit's own profile, which is kept with the preparation.
      expect(decided).toMatchObject({ state: "refused", repositoryProfileId: null });
      const document = readDocument("repositoryProfile", { document: decided.profileDocument!, digest: decided.profileDigest! }, "preparation profile");
      expect(document).toMatchObject({ commit: next, source: { public_id: source.publicId }, detector_configuration_digest: detectorConfiguration(config.analysis).digest });
      expect(preparationRefusal(decided)!.conditions.find((condition) => condition.condition === "framework")!.reason).toMatch(/^Next\.js renders on a server/);
      // No profile version, Profile, Run, or snapshot was added, and none was changed.
      expect(counts()).toEqual(before);
      expect(versionsOf(world.db, source.id).map((version) => [version.version, version.commit])).toEqual([[1, currentProfile(world.db, source.id)!.commit]]);
      expect(builds()).toEqual([]);
    });

    it("decides from the Repository's newest Profile when it's of the pinned commit, and starts the one qualifying package", async () => {
      const { source, commit } = repository(VITE_REACT_APP);
      await profile(source);
      const before = counts();
      const current = currentProfile(world.db, source.id)!;
      expect(current.commit).toBe(commit);

      const decided = await prepared(source);

      const stored = world.db.select().from(repositoryProfiles).where(eq(repositoryProfiles.id, current.profile.id)).get()!;
      expect(decided).toMatchObject({ state: "ready", commitSha: commit, repositoryProfileId: stored.id, profileDocument: null, profileDigest: stored.digest });
      expect(counts()).toEqual(before);
      // Exactly one package qualifies, so its build is queued without asking.
      expect(builds()).toEqual([expect.objectContaining({ commitSha: commit, packageDir: ".", refName: "refs/heads/main", preparationId: decided.id, attemptState: "queued", profileDigest: stored.digest })]);
      expect(buildJobs().map(jobPayload)).toEqual([{ preview: builds()[0]!.publicId, attempt: 1 }]);
    });

    it("selects the highest configured Node install that satisfies the package, and refuses without a build when none does", async () => {
      const { source } = repository(VITE_REACT_APP);
      // VITE_REACT_APP declares engines.node >=20.
      config = settings(source, { nodeVersions: { "18.20.4": "/opt/node-18/bin", "20.18.1": "/opt/node-20/bin", "22.11.0": "/opt/node-22/bin" } });
      const ready = await prepared(source);
      expect(preparationPackages(ready)[0]!.plan!.node).toEqual({ version: "22.11.0", ranges: [">=20.0.0"] });
      expect(builds()).toHaveLength(1);

      const other = repository(VITE_REACT_APP, "reports").source;
      config = settings(other, { nodeVersions: { "18.20.4": "/opt/node-18/bin" } });
      const refused = await prepared(other);
      expect(refused.state).toBe("refused");
      expect(preparationRefusal(refused)!.conditions.map((condition) => [condition.condition, condition.reason])).toEqual([["node", "No configured Node version satisfies >=20.0.0. Configured: 18.20.4."]]);
      expect(builds().filter((build) => build.repositorySourceId === other.id)).toEqual([]);
      expect(buildJobs()).toHaveLength(1);
    });

    it("re-decides a refused commit under new settings, reusing the profile it kept", async () => {
      const { source } = repository(VITE_REACT_APP);
      config = settings(source, { nodeVersions: {} });
      const refused = await prepared(source);
      expect(refused.state).toBe("refused");
      expect(preparationRefusal(refused)!.conditions.map((condition) => condition.reason)).toEqual(["No Node versions are configured for previews (previews.nodeVersions)."]);

      config = settings(source);
      const ready = await prepared(source);
      expect(ready).toMatchObject({ publicId: refused.publicId, state: "ready", profileDigest: refused.profileDigest, profileDocument: refused.profileDocument });
      expect(builds()).toHaveLength(1);
    });
  });

  describe("monorepos", () => {
    it("previews the one application of a workspace without asking, installing from the workspace root", async () => {
      const { source, commit } = repository(NPM_WORKSPACE);
      const decided = await prepared(source);

      expect(decided.state).toBe("ready");
      expect(preparationPackages(decided).filter((verdict) => verdict.qualifies).map((verdict) => verdict.directory)).toEqual(["packages/web"]);
      const [preview] = builds();
      expect(preview).toMatchObject({ commitSha: commit, packageDir: "packages/web", attemptState: "queued" });
      expect(preview!.decidingFacts.plan).toMatchObject({ installRoot: ".", packageManager: { name: "npm", lockfile: "package-lock.json" }, buildTool: "vite", buildScript: "vite build" });
    });

    it("queues nothing until a package is chosen among several, then builds the pinned commit after the branch moves", async () => {
      const { work, remote, source, commit } = repository(FEDERATED_WORKSPACE);
      const decided = await prepared(source);

      expect(decided.state).toBe("ready");
      expect(preparationPackages(decided).filter((verdict) => verdict.qualifies).map((verdict) => verdict.directory)).toEqual(["apps/admin", "apps/billing", "apps/shell"]);
      expect(builds()).toEqual([]);
      expect(buildJobs()).toEqual([]);

      // main moves on the remote before the operator chooses.
      const moved = work.write("apps/shell/index.html", "<!doctype html><title>moved</title>\n").commit("moved");
      work.git("push", "--quiet", remote.path, "main");
      expect(git(remote.path, ["rev-parse", "refs/heads/main"]).trim()).toBe(moved);

      const { preview } = startPreview(world.db, decided.publicId, "apps/admin");
      expect(preview).toMatchObject({ commitSha: commit, packageDir: "apps/admin", refName: "refs/heads/main" });
      expect(preview.decidingFacts.plan).toMatchObject({ layout: "module_federation", buildTool: "rspack" });
      expect(buildJobs().map(jobPayload)).toEqual([{ preview: preview.publicId, attempt: 1 }]);
      expect(git(mirrorPath(config.repositoryStorage, source.publicId), ["rev-parse", `refs/fabricate/previews/${commit}`]).trim()).toBe(commit);
    });

    it("refuses a commit no package of which qualifies, without a build row", async () => {
      const { source } = repository(SCALA_SERVICE, "ledger");
      const decided = await prepared(source);

      expect(decided).toMatchObject({ state: "refused" });
      expect(preparationPackages(decided)).toEqual([]);
      expect(preparationRefusal(decided)!.conditions).toEqual([expect.objectContaining({ condition: "framework", package: null, passed: false })]);
      expect(builds()).toEqual([]);
      expect(buildJobs()).toEqual([]);
    });
  });

  describe("pages", () => {
    it("refuses a Vite single-spa library with no committed page, naming the page, without a build row", async () => {
      const { source } = repository(offlineViteLibrary(), "spa-orders");
      const decided = await prepared(source);

      expect(decided.state).toBe("refused");
      // The application fails only for its page; its vendored stand-ins aren't applications at all.
      expect(preparationRefusal(decided)!.conditions.filter((condition) => condition.package === ".").map((condition) => [condition.condition, condition.reason])).toEqual([
        ["page", "No index.html is committed at index.html, the page Vite builds from. Previews need a page that loads the application on its own."],
      ]);
      expect(builds()).toEqual([]);
      expect(buildJobs()).toEqual([]);
    });

    it("finds a Vite app's page in the root its configuration names, reading the commit, and builds it", async () => {
      const { "index.html": page, ...tree } = VITE_REACT_APP;
      const app = { ...tree, "vite.config.ts": "import { defineConfig } from 'vite';\nexport default defineConfig({ root: 'web', build: { outDir: '../dist' } });\n", "web/index.html": page! };
      const { source } = repository(app);
      const decided = await prepared(source);

      expect(decided.state).toBe("ready");
      const [verdict] = preparationPackages(decided);
      expect(verdict!.conditions.find((condition) => condition.condition === "page")).toMatchObject({ passed: true, reason: "Vite builds its page from web/index.html, in the root vite.config.ts sets" });
      expect(builds()).toHaveLength(1);
    });
  });

  describe("access", () => {
    const nothingStarted = (source: RepositorySource) => {
      expect(world.db.select().from(previewPreparations).all()).toEqual([]);
      expect(world.db.select().from(jobs).where(eq(jobs.kind, PREPARE_PREVIEW)).all()).toEqual([]);
      expect(fs.existsSync(mirrorPath(world.config.repositoryStorage, source.publicId))).toBe(false);
    };

    it("does nothing while previews are off", async () => {
      const { source } = repository(VITE_REACT_APP);
      config = settings(source, { enabled: false });
      await expect(request(source)).rejects.toMatchObject({ name: "PreviewAccessError", code: "disabled" });
      nothingStarted(source);
    });

    it("accepts no request for a remote that isn't enrolled, whatever the Repository is named", async () => {
      const { source } = repository(VITE_REACT_APP);
      config = settings(source, { trustedSources: ["https://git.example.com/acme/orders.git"] });
      await expect(request(source)).rejects.toMatchObject({ name: "PreviewAccessError", code: "not_enrolled" });
      nothingStarted(source);
    });

    it("fails a queued preparation when previews are turned off or enrollment is revoked before it runs, and prepares it again on request", async () => {
      const { source } = repository(VITE_REACT_APP);
      const enrolled = config;
      const first = await request(source);
      config = settings(source, { enabled: false });
      await runPreparations();
      expect(findPreparation(world.db, first.publicId)).toMatchObject({ state: "failed", failure: "Previews were turned off before the commit was prepared" });

      config = enrolled;
      await request(source);
      config = settings(source, { trustedSources: [] });
      await runPreparations();
      expect(findPreparation(world.db, first.publicId)).toMatchObject({ state: "failed", failure: "orders is not enrolled for previews" });

      config = enrolled;
      expect(await prepared(source)).toMatchObject({ publicId: first.publicId, state: "ready" });
    });

    it("queues no preparation for a commit prefix several commits share", async () => {
      const { remote, source } = repository(VITE_REACT_APP);
      const [left, right] = collidingCommits(remote, 4);
      git(remote.path, ["update-ref", "refs/heads/left", left]);
      git(remote.path, ["update-ref", "refs/heads/right", right]);

      await expect(request(source, { kind: "commit", sha: left.slice(0, 4) })).rejects.toMatchObject({ name: "RefResolutionError", code: "ambiguous" });
      expect(world.db.select().from(previewPreparations).all()).toEqual([]);
      expect(world.db.select().from(jobs).where(eq(jobs.kind, PREPARE_PREVIEW)).all()).toEqual([]);
    });
  });
});
