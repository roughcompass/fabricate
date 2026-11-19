import fs from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { mirrorPath, surveyRefFor } from "@/lib/acquisition/mirror";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, withOverrides } from "@/lib/config";
import { immediate } from "@/lib/db/client";
import { runs, jobs, previewBuilds, previewPreparations, repositoryProfiles, surveys } from "@/lib/db/schema";
import { jobPayload } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { requestPreparation } from "@/lib/previews/preparation";
import { BUILD_PREVIEW, PREPARE_PREVIEW, type PreviewPreparation, findPreparation, preparationPackages, preparationRefusal, startPreview } from "@/lib/previews/records";
import type { RefRequest } from "@/lib/previews/refs";
import { insertProfile, profileDocument, profileOfSurvey } from "@/lib/profiles/profile-records";
import { currentProfile } from "@/lib/profiling/current";
import { versionsOf } from "@/lib/profiling/versions";
import { surveyRepository } from "@/lib/surveys/background";
import { type Survey, currentRecipe, moveSurvey, pinSurvey, recordConfiguredResolution, requestSurvey, surveyById } from "@/lib/surveys/records";
import { RUN_SURVEY, finishSurvey } from "@/lib/surveys/run";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { type BareRepo, type Repo, git } from "../support/git-fixture";
import { FEDERATED_WORKSPACE, NEXT_APP, NPM_WORKSPACE, SCALA_SERVICE, type Tree, VITE_REACT_APP, collidingCommits, offlineViteLibrary } from "../support/preview-trees";
import { memoryProfile } from "../support/profiles";

/*
 * Preparing a pinned commit before any package build (design decision 3):
 * the Profile of the commit's survey under the current recipe (unify-surveys,
 * design decision 6), which any Run, check, or earlier preview may already
 * have, else a survey the preparation starts and waits on, listed among the
 * Repository's versions; then one qualifying package starts its preview,
 * several wait for a choice, and none leaves a refusal without a build row.
 */

const NODE = { "20.18.1": "/opt/node-20/bin", "22.11.0": "/opt/node-22/bin" };
/** A Surveyor release before the pinned bundle's. */
const EARLIER_RELEASE = "0.0.1";

describe("preview preparation", () => {
  const world = useAcquisitionWorld("preview-preparation");
  let config: FrontendRegistryConfig;

  const settings = (repository: Repository, previews: Partial<FrontendRegistryConfig["settings"]["previews"]> = {}) =>
    withOverrides(world.config, { previews: { enabled: true, trustedSources: [repository.cloneUrl], nodeVersions: NODE, ...previews } });

  /** A remote holding +tree+ on main, registered and enrolled. */
  function enrolledRepository(tree: Tree, name = "orders"): { work: Repo; remote: BareRepo; repository: Repository; commit: string } {
    const work = world.fixture.repo(`work/${name}`);
    for (const [file, content] of Object.entries(tree)) work.write(file, content);
    const commit = work.commit("initial");
    const remote = world.fixture.bare(`remotes/${name}.git`, { from: work });
    const repository = registerLocalRepository(world.db, world.config, name, remote.path);
    config = settings(repository);
    return { work, remote, repository, commit };
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

  const request = (repository: Repository, ref: RefRequest = { kind: "ref", name: null }) => requestPreparation(world.db, repository.publicId, ref, { config });
  const nextJob = () =>
    world.db
      .select()
      .from(jobs)
      .where(and(inArray(jobs.kind, [PREPARE_PREVIEW, RUN_SURVEY]), eq(jobs.state, "queued")))
      .orderBy(jobs.id)
      .get();
  /**
   * Runs every queued preparation job, and each survey one waits on, which
   * queues it again when it finishes, through the worker's registered
   * handlers. Builds stay queued.
   */
  async function runPreparations(): Promise<void> {
    const handlers = jobHandlers(world.db, config);
    for (let job = nextJob(); job; job = nextJob()) {
      await handlers[job.kind]!(jobPayload(job), { job, signal: new AbortController().signal });
      world.db.update(jobs).set({ state: "succeeded", finishedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id)).run();
    }
  }
  const prepared = async (repository: Repository, ref?: RefRequest): Promise<PreviewPreparation> => {
    const preparation = await request(repository, ref);
    await runPreparations();
    return findPreparation(world.db, preparation.publicId)!;
  };
  const builds = () => world.db.select().from(previewBuilds).all();
  const buildJobs = () => world.db.select().from(jobs).where(eq(jobs.kind, BUILD_PREVIEW)).all();
  /** How many surveys, Profiles, survey jobs (Surveyor runs), and Runs exist. */
  const counts = () => ({
    surveys: world.db.select().from(surveys).all().length,
    profiles: world.db.select().from(repositoryProfiles).all().length,
    surveyJobs: world.db.select().from(jobs).where(eq(jobs.kind, RUN_SURVEY)).all().length,
    runs: world.db.select().from(runs).all().length,
  });
  /** Surveys +repository+ as background surveying does: version 1, of its configured reference. */
  async function profile(repository: Repository): Promise<void> {
    await surveyRepository(world.db, repository, "added", { config });
    await drainJobs(world.db, jobHandlers(world.db, config));
  }
  const surveyOf = (preparation: PreviewPreparation): Survey => surveyById(world.db, preparation.surveyId!);

  describe("profiles", () => {
    it("surveys a branch's commit for the preparation, listing it among the Repository's versions and leaving its current Profile (Commit not yet profiled)", async () => {
      const { work, remote, repository, commit } = enrolledRepository(VITE_REACT_APP);
      const next = branch(work, remote, "feature/next", NEXT_APP);
      await profile(repository);
      const before = counts();
      expect(before).toEqual({ surveys: 1, profiles: 1, surveyJobs: 1, runs: 0 });

      const preparation = await request(repository, { kind: "ref", name: "feature/next" });
      expect(preparation).toMatchObject({ state: "profiling", commitSha: next, refName: "refs/heads/feature/next", refKind: "branch", surveyId: null });
      await runPreparations();
      const decided = findPreparation(world.db, preparation.publicId)!;

      // Decided from the Profile of this commit's own survey, a preview survey under the current recipe.
      const survey = surveyOf(decided);
      expect(survey).toMatchObject({ number: 2, commitSha: next, reference: "refs/heads/feature/next", fromConfiguredReference: false, trigger: "preview", state: "succeeded", requestedByRunId: null, ...currentRecipe(config) });
      const stored = profileOfSurvey(world.db, survey.id)!;
      expect(decided).toMatchObject({ state: "refused", profileDigest: stored.digest });
      expect(profileDocument(stored)).toMatchObject({ commit: next, source: { public_id: repository.publicId }, detector_configuration_digest: currentRecipe(config).configurationDigest });
      expect(preparationRefusal(decided)!.conditions.find((condition) => condition.condition === "framework")!.reason).toMatch(/^Next\.js renders on a server/);
      // One survey and one Profile were added, and no Run.
      expect(counts()).toEqual({ surveys: 2, profiles: 2, surveyJobs: 2, runs: 0 });
      expect(versionsOf(world.db, repository.id).map((version) => [version.version, version.commit, version.trigger])).toEqual([
        [2, next, "preview"],
        [1, commit, "added"],
      ]);
      // A branch isn't the configured reference, so the current Profile is still version 1's.
      expect(currentProfile(world.db, repository.id)).toMatchObject({ version: 1, commit });
      expect(builds()).toEqual([]);
    });

    it("decides from the commit's successful survey without surveying again, and starts the one qualifying package (Preview of a surveyed commit)", async () => {
      const { repository, commit } = enrolledRepository(VITE_REACT_APP);
      await profile(repository);
      const before = counts();
      const current = currentProfile(world.db, repository.id)!;
      expect(current.commit).toBe(commit);

      const decided = await prepared(repository);

      expect(decided).toMatchObject({ state: "ready", commitSha: commit, surveyId: current.survey.id, profileDigest: current.profile.digest });
      // The survey was linked as it stood: Surveyor didn't run again, and nothing was added.
      expect(counts()).toEqual(before);
      expect(surveyOf(decided)).toEqual(current.survey);
      // Exactly one package qualifies, so its build is queued without asking.
      expect(builds()).toEqual([expect.objectContaining({ commitSha: commit, packageDir: ".", refName: "refs/heads/main", preparationId: decided.id, attemptState: "queued", profileDigest: current.profile.digest })]);
      expect(buildJobs().map(jobPayload)).toEqual([{ preview: builds()[0]!.publicId, attempt: 1 }]);
    });

    it("surveys a commit again under the current recipe when it was surveyed only by an earlier Surveyor release, not using that Profile (Preview after an upgrade)", async () => {
      const { repository, commit } = enrolledRepository(VITE_REACT_APP);
      // Version 1, by an earlier Surveyor release, read the commit as a Next.js application, which can't be previewed.
      const recipe = currentRecipe(config);
      const { survey: queued } = requestSurvey(world.db, { repositoryId: repository.id, commitSha: commit, reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", ...recipe, surveyorRelease: EARLIER_RELEASE });
      const running = pinSurvey(world.db, moveSurvey(world.db, queued, "running", { attempts: 1 }), { treeSha: null, internalRef: surveyRefFor(queued.publicId) });
      const { document } = await memoryProfile(NEXT_APP, { public_id: repository.publicId, name: repository.name }, commit);
      const earlier = immediate(world.db, (tx) => {
        const written = insertProfile(tx, { survey: running, document: { ...document, detector_release: EARLIER_RELEASE } });
        moveSurvey(tx, running, "succeeded", {});
        recordConfiguredResolution(tx, repository.id, commit, new Date());
        return written;
      });
      expect(currentProfile(world.db, repository.id)).toMatchObject({ version: 1, commit, profile: { id: earlier.id } });

      const decided = await prepared(repository);

      // A new survey of the same commit ran under the current recipe, and decided: the application qualifies.
      const survey = surveyOf(decided);
      expect(survey).toMatchObject({ number: 2, commitSha: commit, trigger: "preview", state: "succeeded", attempts: 1, ...recipe });
      const stored = profileOfSurvey(world.db, survey.id)!;
      expect(stored.id).not.toBe(earlier.id);
      expect(decided).toMatchObject({ state: "ready", profileDigest: stored.digest });
      expect(builds()).toHaveLength(1);
      // The earlier survey and its Profile remain; the new one, of the commit the configured reference names, is current.
      expect(versionsOf(world.db, repository.id).map((version) => [version.version, version.survey.surveyorRelease, version.profile?.id])).toEqual([
        [2, recipe.surveyorRelease, stored.id],
        [1, EARLIER_RELEASE, earlier.id],
      ]);
      expect(currentProfile(world.db, repository.id)).toMatchObject({ version: 2, profile: { id: stored.id } });
    });

    it("makes a preview's survey of the configured reference the Repository's current Profile", async () => {
      const { repository, commit } = enrolledRepository(VITE_REACT_APP);
      expect(currentProfile(world.db, repository.id)).toBeUndefined();

      const decided = await prepared(repository);

      expect(surveyOf(decided)).toMatchObject({ number: 1, commitSha: commit, trigger: "preview", fromConfiguredReference: true, state: "succeeded" });
      expect(currentProfile(world.db, repository.id)).toMatchObject({ version: 1, commit, survey: { id: decided.surveyId } });
    });

    it("selects the highest configured Node install that satisfies the package, and refuses without a build when none does", async () => {
      const { repository } = enrolledRepository(VITE_REACT_APP);
      // VITE_REACT_APP declares engines.node >=20.
      config = settings(repository, { nodeVersions: { "18.20.4": "/opt/node-18/bin", "20.18.1": "/opt/node-20/bin", "22.11.0": "/opt/node-22/bin" } });
      const ready = await prepared(repository);
      expect(preparationPackages(ready)[0]!.plan!.node).toEqual({ version: "22.11.0", ranges: [">=20.0.0"] });
      expect(builds()).toHaveLength(1);

      const other = enrolledRepository(VITE_REACT_APP, "reports").repository;
      config = settings(other, { nodeVersions: { "18.20.4": "/opt/node-18/bin" } });
      const refused = await prepared(other);
      expect(refused.state).toBe("refused");
      expect(preparationRefusal(refused)!.conditions.map((condition) => [condition.condition, condition.reason])).toEqual([["node", "No configured Node version satisfies >=20.0.0. Configured: 18.20.4."]]);
      expect(builds().filter((build) => build.repositoryId === other.id)).toEqual([]);
      expect(buildJobs()).toHaveLength(1);
    });

    it("re-decides a refused commit under new settings from the survey it linked, without surveying again", async () => {
      const { repository } = enrolledRepository(VITE_REACT_APP);
      config = settings(repository, { nodeVersions: {} });
      const refused = await prepared(repository);
      expect(refused.state).toBe("refused");
      expect(preparationRefusal(refused)!.conditions.map((condition) => condition.reason)).toEqual(["No Node versions are configured for previews (previews.nodeVersions)."]);
      const before = counts();

      config = settings(repository);
      const ready = await prepared(repository);
      expect(ready).toMatchObject({ publicId: refused.publicId, state: "ready", surveyId: refused.surveyId, profileDigest: refused.profileDigest });
      expect(counts()).toEqual(before);
      expect(builds()).toHaveLength(1);
    });

    it("fails the preparation when its survey fails, and retries that survey when the commit is requested again", async () => {
      const { repository } = enrolledRepository(VITE_REACT_APP);
      const first = await request(repository);
      const handlers = jobHandlers(world.db, config);
      // The preparation's job starts the commit's survey and waits on it.
      const job = nextJob()!;
      expect(job.kind).toBe(PREPARE_PREVIEW);
      await handlers[PREPARE_PREVIEW]!(jobPayload(job), { job, signal: new AbortController().signal });
      world.db.update(jobs).set({ state: "succeeded", finishedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id)).run();
      const waiting = findPreparation(world.db, first.publicId)!;
      expect(waiting).toMatchObject({ state: "profiling", surveyId: expect.any(Number) });
      expect(surveyOf(waiting)).toMatchObject({ state: "queued", trigger: "preview" });

      // Surveyor fails on it, which wakes the preparation to fail with it.
      world.db.delete(jobs).where(eq(jobs.kind, RUN_SURVEY)).run();
      finishSurvey(world.db, moveSurvey(world.db, surveyOf(waiting), "running", { attempts: 1 }), { failure: { code: "analysis_failed", message: "Surveyor stopped" } });
      await runPreparations();
      expect(findPreparation(world.db, first.publicId)).toMatchObject({ state: "failed", failure: "The commit couldn't be surveyed: Surveyor stopped" });

      // Requested again, the same survey is retried and the commit is decided.
      const again = await prepared(repository);
      expect(again).toMatchObject({ publicId: first.publicId, state: "ready", surveyId: waiting.surveyId });
      expect(surveyOf(again)).toMatchObject({ number: 1, state: "succeeded", attempts: 2 });
      expect(counts()).toMatchObject({ surveys: 1, profiles: 1 });
    });
  });

  describe("monorepos", () => {
    it("previews the one application of a workspace without asking, installing from the workspace root", async () => {
      const { repository, commit } = enrolledRepository(NPM_WORKSPACE);
      const decided = await prepared(repository);

      expect(decided.state).toBe("ready");
      expect(preparationPackages(decided).filter((verdict) => verdict.qualifies).map((verdict) => verdict.directory)).toEqual(["packages/web"]);
      const [preview] = builds();
      expect(preview).toMatchObject({ commitSha: commit, packageDir: "packages/web", attemptState: "queued" });
      expect(preview!.decidingFacts.plan).toMatchObject({ installRoot: ".", packageManager: { name: "npm", lockfile: "package-lock.json" }, buildTool: "vite", buildScript: "vite build" });
    });

    it("queues nothing until a package is chosen among several, then builds the pinned commit after the branch moves", async () => {
      const { work, remote, repository, commit } = enrolledRepository(FEDERATED_WORKSPACE);
      const decided = await prepared(repository);

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
      expect(git(mirrorPath(config.repositoryStorage, repository.publicId), ["rev-parse", `refs/fabricate/previews/${commit}`]).trim()).toBe(commit);
    });

    it("refuses a commit no package of which qualifies, without a build row", async () => {
      const { repository } = enrolledRepository(SCALA_SERVICE, "ledger");
      const decided = await prepared(repository);

      expect(decided).toMatchObject({ state: "refused" });
      expect(preparationPackages(decided)).toEqual([]);
      expect(preparationRefusal(decided)!.conditions).toEqual([expect.objectContaining({ condition: "framework", package: null, passed: false })]);
      expect(builds()).toEqual([]);
      expect(buildJobs()).toEqual([]);
    });
  });

  describe("pages", () => {
    it("refuses a Vite single-spa library with no committed page, naming the page, without a build row", async () => {
      const { repository } = enrolledRepository(offlineViteLibrary(), "spa-orders");
      const decided = await prepared(repository);

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
      const { repository } = enrolledRepository(app);
      const decided = await prepared(repository);

      expect(decided.state).toBe("ready");
      const [verdict] = preparationPackages(decided);
      expect(verdict!.conditions.find((condition) => condition.condition === "page")).toMatchObject({ passed: true, reason: "Vite builds its page from web/index.html, in the root vite.config.ts sets" });
      expect(builds()).toHaveLength(1);
    });
  });

  describe("access", () => {
    const nothingStarted = (repository: Repository) => {
      expect(world.db.select().from(previewPreparations).all()).toEqual([]);
      expect(world.db.select().from(jobs).where(eq(jobs.kind, PREPARE_PREVIEW)).all()).toEqual([]);
      expect(fs.existsSync(mirrorPath(world.config.repositoryStorage, repository.publicId))).toBe(false);
    };

    it("does nothing while previews are off", async () => {
      const { repository } = enrolledRepository(VITE_REACT_APP);
      config = settings(repository, { enabled: false });
      await expect(request(repository)).rejects.toMatchObject({ name: "PreviewAccessError", code: "disabled" });
      nothingStarted(repository);
    });

    it("accepts no request for a remote that isn't enrolled, whatever the Repository is named", async () => {
      const { repository } = enrolledRepository(VITE_REACT_APP);
      config = settings(repository, { trustedSources: ["https://git.example.com/acme/orders.git"] });
      await expect(request(repository)).rejects.toMatchObject({ name: "PreviewAccessError", code: "not_enrolled" });
      nothingStarted(repository);
    });

    it("fails a queued preparation when previews are turned off or enrollment is revoked before it runs, and prepares it again on request", async () => {
      const { repository } = enrolledRepository(VITE_REACT_APP);
      const enrolled = config;
      const first = await request(repository);
      config = settings(repository, { enabled: false });
      await runPreparations();
      expect(findPreparation(world.db, first.publicId)).toMatchObject({ state: "failed", failure: "Previews were turned off before the commit was prepared" });

      config = enrolled;
      await request(repository);
      config = settings(repository, { trustedSources: [] });
      await runPreparations();
      expect(findPreparation(world.db, first.publicId)).toMatchObject({ state: "failed", failure: "orders is not enrolled for previews" });

      config = enrolled;
      expect(await prepared(repository)).toMatchObject({ publicId: first.publicId, state: "ready" });
    });

    it("queues no preparation for a commit prefix several commits share", async () => {
      const { remote, repository } = enrolledRepository(VITE_REACT_APP);
      const [left, right] = collidingCommits(remote, 4);
      git(remote.path, ["update-ref", "refs/heads/left", left]);
      git(remote.path, ["update-ref", "refs/heads/right", right]);

      await expect(request(repository, { kind: "commit", sha: left.slice(0, 4) })).rejects.toMatchObject({ name: "RefResolutionError", code: "ambiguous" });
      expect(world.db.select().from(previewPreparations).all()).toEqual([]);
      expect(world.db.select().from(jobs).where(eq(jobs.kind, PREPARE_PREVIEW)).all()).toEqual([]);
    });
  });
});
