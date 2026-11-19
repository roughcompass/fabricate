import fs from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkApplications } from "@/lib/applications/check";
import { createApplication } from "@/lib/applications/pipeline";
import { getApplication, getApplicationRow } from "@/lib/applications/records";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, withOverrides } from "@/lib/config";
import { applications, jobs, previewBuilds } from "@/lib/db/schema";
import { jobPayload } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/registry";
import { requestPreparation } from "@/lib/previews/preparation";
import { BUILD_PREVIEW, PREPARE_PREVIEW, failAttempt, findPreparation } from "@/lib/previews/records";
import { RUN_SURVEY } from "@/lib/surveys/run";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
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
    createApplication(world.db, { repository: repository.publicId, branch: "main", packageDir: ".", preparation: findPreparation(world.db, preparation.publicId)!.publicId, name: "Orders portal", description: "" }, config);
    publishFiles(world.db, config, latestPreview(), { "index.html": "<!doctype html>" });
    expect(shown().status).toBe("ready");
  }

  function push(files: Record<string, string>, message: string): string {
    for (const [file, content] of Object.entries(files)) work.write(file, content);
    const commit = work.commit(message);
    work.git("push", "--quiet", remote.path, "main");
    return commit;
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

  it("checks nothing while previews are off, or for a Repository no longer enrolled", async () => {
    await readyApplication();
    push({ "src/note.ts": "export const note = 1;\n" }, "second");
    const enrolled = config;
    config = withOverrides(enrolled, { previews: { enabled: false } });
    expect(await check()).toEqual({ checked: 0, started: 0, unreadable: 0 });
    config = withOverrides(enrolled, { previews: { trustedSources: [] } });
    expect(await check()).toEqual({ checked: 0, started: 0, unreadable: 0 });
    expect(shown().status).toBe("ready");
  });

  it("runs in the profiling check's job, after the profiling check", async () => {
    await readyApplication();
    push({ "src/note.ts": "export const note = 1;\n" }, "second");
    const job = { id: 0, kind: "profiling.check", payload: "{}", attempts: 1 } as never;
    await jobHandlers(world.db, config)["profiling.check"]!({ slot: new Date(0).toISOString() }, { job, signal: new AbortController().signal });
    expect(shown().status).toBe("building");
  });
});
