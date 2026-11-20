import fs from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkApplications } from "@/lib/applications/check";
import { createApplication, createSavedPreview } from "@/lib/applications/pipeline";
import { getApplication, getApplicationRow } from "@/lib/applications/records";
import { findSavedPreview, getSavedPreviewRow } from "@/lib/applications/saved-previews";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, withOverrides } from "@/lib/config";
import { JOB_PRIORITIES, applications, jobs, previewBuilds } from "@/lib/db/schema";
import { GitRunner } from "@/lib/git/runner";
import { claimNext, jobPayload } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/registry";
import { enrollRemote } from "@/lib/previews/access";
import { requestPreparation } from "@/lib/previews/preparation";
import { BUILD_PREVIEW, PREPARE_PREVIEW, failAttempt, findPreparation } from "@/lib/previews/records";
import { CAPTURE_SCREENSHOT } from "@/lib/previews/screenshots";
import { RUN_SURVEY } from "@/lib/surveys/run";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { rawRun } from "../support/db";
import type { BareRepo, Repo } from "../support/git-fixture";
import { publishFiles } from "../support/previews";
import { VITE_REACT_APP } from "../support/preview-trees";
import { manifest } from "../support/profiles";

/*
 * The automatic check for new commits on tracked branches (add-applications,
 * design decision 3; task 3.1), against a local fixture remote, with every
 * commit surveyed and decided by the real preparation jobs. Builds stay
 * queued, and are published or failed as the build job would.
 */

const NODE = { "22.11.0": "/opt/node-22/bin" };

describe("applications check", () => {
  const world = useAcquisitionWorld("applications-check");
  let config: FrontendRegistryConfig;
  let work: Repo;
  let remote: BareRepo;
  let repository: Repository;
  const logged: string[] = [];

  const nextJob = () =>
    world.db
      .select()
      .from(jobs)
      .where(and(inArray(jobs.kind, [PREPARE_PREVIEW, RUN_SURVEY]), eq(jobs.state, "queued")))
      .orderBy(jobs.id)
      .get();
  /** Runs every queued preparation and the surveys they wait on, through the worker's handlers. Builds stay queued. */
  async function runPreparations(): Promise<void> {
    const handlers = jobHandlers(world.db, config);
    for (let job = nextJob(); job; job = nextJob()) {
      await handlers[job.kind]!(jobPayload(job), { job, signal: new AbortController().signal });
      world.db.update(jobs).set({ state: "succeeded", finishedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id)).run();
    }
  }
  const check = () => checkApplications(world.db, config, { log: (message) => logged.push(message) });
  const buildJobs = () => world.db.select().from(jobs).where(eq(jobs.kind, BUILD_PREVIEW)).all();
  const shown = () => getApplication(world.db, "orders-portal");
  const latestPreview = () => world.db.select().from(previewBuilds).where(eq(previewBuilds.id, getApplicationRow(world.db, shown().publicId).latestPreviewId!)).get()!;

  /** Orders portal, onboarded from a remote with a Vite app on main, whose first build succeeded. */
  async function readyApplication(): Promise<void> {
    logged.length = 0;
    work = world.fixture.repo("work/orders");
    for (const [file, content] of Object.entries(VITE_REACT_APP)) work.write(file, content);
    work.commit("initial");
    remote = world.fixture.bare("remotes/orders.git", { from: work });
    repository = registerLocalRepository(world.db, world.config, "spa-orders", remote.path);
    config = withOverrides(world.config, { previews: { enabled: true, trustedSources: [repository.cloneUrl], nodeVersions: NODE } });
    const preparation = await requestPreparation(world.db, repository.publicId, { kind: "ref", name: "refs/heads/main" }, { config });
    await runPreparations();
    createApplication(world.db, { repository: repository.publicId, branch: "main", packageDir: ".", preparation: findPreparation(world.db, preparation.publicId)!.publicId, name: "Orders portal", description: "", trusted: true }, config);
    publishFiles(world.db, config, latestPreview(), { "index.html": "<!doctype html>" });
    expect(shown().status).toBe("ready");
  }

  function push(files: Record<string, string>, message: string, branch = "main"): string {
    if (branch !== "main") work.git("checkout", "--quiet", ...(work.git("branch", "--list", branch).trim() ? [] : ["-b"]), branch);
    for (const [file, content] of Object.entries(files)) work.write(file, content);
    const commit = work.commit(message);
    work.git("push", "--quiet", remote.path, branch);
    if (branch !== "main") work.checkout("main");
    return commit;
  }

  const saved = (key: string) => findSavedPreview(world.db, shown().publicId, key)!;
  const savedLatest = (key: string) => world.db.select().from(previewBuilds).where(eq(previewBuilds.id, getSavedPreviewRow(world.db, saved(key).publicId).latestPreviewId!)).get()!;
  /** Saves a preview of +ref+ and publishes its first build, unless its commit's build already published. */
  async function readySaved(ref: string, key: string): Promise<void> {
    await createSavedPreview(world.db, shown().publicId, { ref }, { config });
    await runPreparations();
    if (saved(key).status !== "ready") publishFiles(world.db, config, savedLatest(key), { "index.html": "<!doctype html>" });
    expect(saved(key).status).toBe("ready");
  }

  it("builds a pushed commit once, and queues nothing when the check runs again (Branch moves)", async () => {
    await readyApplication();
    const current = shown().current!;
    expect(await check()).toEqual({ checked: 1, started: 0, unreadable: 0 });
    const before = buildJobs().length;

    const pushed = push({ "src/note.ts": "export const note = 1;\n" }, "second");
    expect(await check()).toEqual({ checked: 1, started: 1, unreadable: 0 });
    // Building, with the last good build and screenshot in use.
    expect(shown()).toMatchObject({ status: "building", latest: { commitSha: pushed }, current: { preview: current.preview } });

    await runPreparations();
    expect(buildJobs()).toHaveLength(before + 1);
    expect(latestPreview()).toMatchObject({ commitSha: pushed, attemptState: "queued" });

    // Building: the next check leaves it alone.
    expect(await check()).toEqual({ checked: 0, started: 0, unreadable: 0 });
    expect(buildJobs()).toHaveLength(before + 1);
  });

  it("doesn't retry a commit whose build failed until the branch moves (Failed commit isn't retried)", async () => {
    await readyApplication();
    push({ "src/note.ts": "export const note = 1;\n" }, "second");
    await check();
    await runPreparations();
    failAttempt(world.db, latestPreview().publicId, { attempt: 1 }, "The build failed");
    expect(shown().status).toBe("latest_build_failed");
    const before = buildJobs().length;

    expect(await check()).toEqual({ checked: 1, started: 0, unreadable: 0 });
    await runPreparations();
    expect(buildJobs()).toHaveLength(before);
    expect(shown().status).toBe("latest_build_failed");

    const fixed = push({ "src/note.ts": "export const note = 2;\n" }, "third");
    expect(await check()).toMatchObject({ started: 1 });
    await runPreparations();
    expect(latestPreview()).toMatchObject({ commitSha: fixed, attemptState: "queued" });
  });

  it("records a commit that stops qualifying, keeping the previous build current (Commit stops qualifying)", async () => {
    await readyApplication();
    const current = shown().current!;
    const { vite: _vite, ...devDependencies } = JSON.parse(VITE_REACT_APP["package.json"]!).devDependencies as Record<string, string>;
    work.remove("vite.config.ts");
    push({ "package.json": manifest({ ...JSON.parse(VITE_REACT_APP["package.json"]!), scripts: { build: "tsc -b" }, devDependencies }) }, "drop vite");
    await check();
    await runPreparations();

    const refused = shown();
    expect(refused).toMatchObject({ status: "latest_not_previewable", current: { preview: current.preview } });
    expect(refused.latest.reasons.map((reason) => reason.condition)).toContain("build_tool");
    // Refused: the next check doesn't try it again.
    expect(await check()).toMatchObject({ started: 0 });
  });

  it("leaves an application as it was when its remote can't be read, and reads it again next time (Remote unreachable)", async () => {
    await readyApplication();
    push({ "src/note.ts": "export const note = 1;\n" }, "second");
    const before = world.db.select().from(applications).get();
    const moved = `${remote.path}-moved`;
    fs.renameSync(remote.path, moved);

    expect(await check()).toEqual({ checked: 1, started: 0, unreadable: 1 });
    expect(world.db.select().from(applications).get()).toEqual(before);
    expect(logged.at(-1)).toMatch(/^applications check: spa-orders's remote couldn't be read: /);

    fs.renameSync(moved, remote.path);
    expect(await check()).toMatchObject({ started: 1, unreadable: 0 });
  });

  it("checks nothing while previews are off, or for a remote neither listed nor enrolled by an application", async () => {
    await readyApplication();
    push({ "src/note.ts": "export const note = 1;\n" }, "second");
    const enrolled = config;
    config = withOverrides(enrolled, { previews: { enabled: false } });
    expect(await check()).toEqual({ checked: 0, started: 0, unreadable: 0 });
    // Neither listed nor enrolled by an application.
    config = withOverrides(enrolled, { previews: { trustedSources: [] } });
    rawRun(world.db, "delete from preview_enrollments");
    expect(await check()).toEqual({ checked: 0, started: 0, unreadable: 0 });
    expect(shown().status).toBe("ready");
    // Enrolled by its application alone, as onboarding enrolls it.
    enrollRemote(world.db, repository, shown());
    expect(await check()).toEqual({ checked: 1, started: 1, unreadable: 0 });
  });

  describe("saved previews", () => {
    it("builds a saved branch that moved, never a saved tag, and doesn't retry a failed commit (A saved branch moves, Tag left alone, Failed commit isn't retried)", async () => {
      await readyApplication();
      push({ "src/nav.ts": "export const nav = 1;\n" }, "New nav", "feature/new-nav");
      work.git("tag", "v1.1.0", "feature/new-nav");
      work.git("push", "--quiet", remote.path, "v1.1.0");
      await readySaved("refs/heads/feature/new-nav", "feature-new-nav");
      await readySaved("refs/tags/v1.1.0", "v1.1.0");
      expect(await check()).toEqual({ checked: 3, started: 0, unreadable: 0 });

      const good = saved("feature-new-nav").current!;
      const moved = push({ "src/nav.ts": "export const nav = 2;\n" }, "Broken nav", "feature/new-nav");
      // The tag is moved too, as a force-push would; the check still leaves it alone.
      work.git("tag", "-f", "v1.1.0", "feature/new-nav");
      work.git("push", "--quiet", "--force", remote.path, "v1.1.0");
      expect(await check()).toEqual({ checked: 3, started: 1, unreadable: 0 });
      expect(saved("feature-new-nav")).toMatchObject({ status: "building", latest: { commitSha: moved }, current: { preview: good.preview } });
      expect(saved("v1.1.0")).toMatchObject({ status: "ready" });

      await runPreparations();
      failAttempt(world.db, savedLatest("feature-new-nav").publicId, { attempt: 1 }, "The build failed");
      expect(saved("feature-new-nav")).toMatchObject({ status: "latest_build_failed", current: { preview: good.preview } });
      const before = buildJobs().length;
      expect(await check()).toEqual({ checked: 3, started: 0, unreadable: 0 });
      await runPreparations();
      expect(buildJobs()).toHaveLength(before);
    });

    it("marks a saved ref gone from the remote, keeps its build, and clears the mark when it returns (Branch deleted after merging)", async () => {
      await readyApplication();
      const head = push({ "src/nav.ts": "export const nav = 1;\n" }, "New nav", "feature/new-nav");
      await readySaved("refs/heads/feature/new-nav", "feature-new-nav");
      const kept = saved("feature-new-nav").current!;

      work.git("push", "--quiet", remote.path, "--delete", "feature/new-nav");
      expect(await check()).toEqual({ checked: 2, started: 0, unreadable: 1 });
      expect(saved("feature-new-nav")).toMatchObject({ status: "ready", current: { preview: kept.preview } });
      const gone = saved("feature-new-nav").remoteMissingAt;
      expect(gone).toBeInstanceOf(Date);
      expect(logged.at(-1)).toBe("applications check: spa-orders has no branch feature/new-nav, which Orders portal keeps a preview of");
      // Still gone: the mark keeps when it was first missed.
      await check();
      expect(saved("feature-new-nav").remoteMissingAt).toEqual(gone);

      work.git("push", "--quiet", remote.path, `${head}:refs/heads/feature/new-nav`);
      expect(await check()).toEqual({ checked: 2, started: 0, unreadable: 0 });
      expect(saved("feature-new-nav").remoteMissingAt).toBeNull();
    });

    it("reads the remote once for the tracked branch and 20 saved branches (No extra reads of the remote)", async () => {
      await readyApplication();
      const head = work.head();
      const applicationId = getApplicationRow(world.db, shown().publicId).id;
      for (let index = 0; index < 20; index++) {
        work.git("branch", `feature/${index}`);
        rawRun(
          world.db,
          "insert into application_previews (public_id, application_id, key, ref, latest_commit_sha, latest_outcome, latest_reasons, latest_requested_at, created_at, updated_at) values (?, ?, ?, ?, ?, 'failed', '[{\"text\":\"no\"}]', 0, 0, 0)",
          `apv_${String(index).padStart(16, "0")}`,
          applicationId,
          `feature-${index}`,
          `refs/heads/feature/${index}`,
          head,
        );
      }
      work.git("push", "--quiet", remote.path, "--all");
      let reads = 0;
      const runner = new (class extends GitRunner {
        override lsRemote(...args: Parameters<GitRunner["lsRemote"]>) {
          reads += 1;
          return super.lsRemote(...args);
        }
      })({ config });
      expect(await checkApplications(world.db, config, { runner })).toEqual({ checked: 21, started: 0, unreadable: 0 });
      expect(reads).toBe(1);
    });

    it("queues a saved branch's rebuild, and its screenshot, behind the tracked branch's (Both move at once)", async () => {
      await readyApplication();
      push({ "src/nav.ts": "export const nav = 1;\n" }, "New nav", "feature/new-nav");
      await readySaved("refs/heads/feature/new-nav", "feature-new-nav");
      const tracked = push({ "src/note.ts": "export const note = 1;\n" }, "second");
      const feature = push({ "src/nav.ts": "export const nav = 2;\n" }, "Newer nav", "feature/new-nav");
      // Only what this check queues is waiting.
      world.db.update(jobs).set({ state: "succeeded", finishedAt: new Date() }).where(eq(jobs.state, "queued")).run();

      expect(await check()).toMatchObject({ started: 2 });
      // The tracked branch's preparation is claimed first.
      const first = claimNext(world.db, { workerId: "test" })!;
      expect(first.kind).toBe(PREPARE_PREVIEW);
      expect(findPreparation(world.db, String(jobPayload(first).preparation))!.commitSha).toBe(tracked);
      world.db.update(jobs).set({ state: "queued", leaseOwner: null, leaseExpiresAt: null, attempts: 0 }).where(eq(jobs.id, first.id)).run();

      await runPreparations();
      const builds = world.db.select().from(jobs).where(and(eq(jobs.kind, BUILD_PREVIEW), eq(jobs.state, "queued"))).all();
      const priorityOf = (commit: string) => builds.find((job) => job.payload.includes(world.db.select().from(previewBuilds).where(eq(previewBuilds.commitSha, commit)).get()!.publicId))!.priority;
      expect([priorityOf(tracked), priorityOf(feature)]).toEqual([JOB_PRIORITIES.normal, JOB_PRIORITIES.background]);
      const next = claimNext(world.db, { workerId: "test" })!;
      expect(jobPayload(next).preview).toBe(latestPreview().publicId);

      // The saved branch's screenshot waits behind the application's.
      publishFiles(world.db, config, savedLatest("feature-new-nav"), { "index.html": "<!doctype html>" });
      publishFiles(world.db, config, latestPreview(), { "index.html": "<!doctype html>" });
      const captures = world.db.select().from(jobs).where(and(eq(jobs.kind, CAPTURE_SCREENSHOT), eq(jobs.state, "queued"))).all();
      expect(captures.find((job) => job.payload.includes(latestPreview().publicId))!.priority).toBe(JOB_PRIORITIES.normal);
      expect(captures.find((job) => job.payload.includes(savedLatest("feature-new-nav").publicId))!.priority).toBe(JOB_PRIORITIES.background);
    });
  });

  it("runs in the profiling check's job, after the profiling check", async () => {
    await readyApplication();
    push({ "src/note.ts": "export const note = 1;\n" }, "second");
    const job = { id: 0, kind: "profiling.check", payload: "{}", attempts: 1 } as never;
    await jobHandlers(world.db, config)["profiling.check"]!({ slot: new Date(0).toISOString() }, { job, signal: new AbortController().signal });
    expect(shown().status).toBe("building");
  });
});
