import fs from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { editRepository, registerRepository } from "@/lib/repositories/registration";
import { SourceBoundary } from "@/lib/repositories/source-boundary";
import { type Repository, getRepository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { JOB_PRIORITIES, runs, assessments, jobs, surveys } from "@/lib/db/schema";
import { jobPayload } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { CHECK_PROFILES, checkProfiles, runScheduledProfileCheck, scheduleProfileChecks } from "@/lib/profiling/check";
import { currentProfile } from "@/lib/profiling/current";
import { profileOfSurvey } from "@/lib/profiles/profile-records";
import { REQUEST_SURVEY, surveyRepository, surveyRequestFailure } from "@/lib/surveys/background";
import { currentRecipe, latestSurvey, moveSurvey, requestSurvey, surveyById } from "@/lib/surveys/records";
import { queueSurvey, RUN_SURVEY } from "@/lib/surveys/run";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { buildRepository } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import type { Repo } from "../support/git-fixture";
import { manifest, sha1 } from "../support/profiles";

const jobsOf = (db: Db, kind: string) => db.select().from(jobs).where(eq(jobs.kind, kind)).orderBy(asc(jobs.id)).all();
const surveysOf = (db: Db, repository: Repository) => db.select().from(surveys).where(eq(surveys.repositoryId, repository.id)).orderBy(asc(surveys.number)).all();

describe("the scheduled check", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  /** A survey of +source+ under the current recipe, queued with its job. */
  const survey = (repository: Repository) => {
    const { survey: queued } = requestSurvey(db, { repositoryId: repository.id, commitSha: sha1(`commit:${repository.name}`), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", ...currentRecipe(getConfig()) });
    queueSurvey(db, queued);
    return queued;
  };

  it("requests a background survey of every repository whose newest survey isn't queued or running", () => {
    const orders = buildRepository(db, { name: "orders" });
    const ledger = buildRepository(db, { name: "ledger" });
    const billing = buildRepository(db, { name: "billing" });
    const web = buildRepository(db, { name: "web" });
    survey(ledger);
    moveSurvey(db, survey(billing), "running", { attempts: 1 });
    const running = moveSurvey(db, survey(web), "running", { attempts: 1 });
    moveSurvey(db, running, "failed", { failureCode: "analysis_failed", failureMessage: "Surveyor stopped" });

    const surveyJobs = jobsOf(db, RUN_SURVEY).length;
    expect(checkProfiles(db, "2026-11-18T09:00:00.000Z")).toEqual({ checked: 4, requested: 2 });
    const requests = jobsOf(db, REQUEST_SURVEY);
    expect(requests.map((job) => jobPayload(job))).toEqual([
      { repository: orders.publicId, trigger: "check" },
      { repository: web.publicId, trigger: "check" },
    ]);
    // Each is its own background job, which fails alone when its reference can't be read.
    for (const job of requests) expect(job).toMatchObject({ priority: JOB_PRIORITIES.background, maxAttempts: 1, state: "queued" });
    // The check reads no reference itself, and starts no survey.
    expect(jobsOf(db, RUN_SURVEY)).toHaveLength(surveyJobs);
  });

  it("fails a survey whose job was lost first, so its repository is requested again", () => {
    const orders = buildRepository(db, { name: "orders" });
    const lost = moveSurvey(db, survey(orders), "running", { attempts: 1 });
    rawRun(db, "update jobs set state = 'failed', last_error = 'worker stopped', finished_at = 0 where idempotency_key = ?", `${RUN_SURVEY}:${lost.publicId}:1`);

    expect(checkProfiles(db, "2026-11-18T09:00:00.000Z")).toEqual({ checked: 1, requested: 1 });
    expect(surveyById(db, lost.id)).toMatchObject({ state: "failed", failureCode: "analysis_failed", failureMessage: expect.stringContaining("worker stopped") });
  });

  it("requests each repository once per slot, however often the slot is checked", () => {
    buildRepository(db, { name: "orders" });
    buildRepository(db, { name: "ledger" });

    checkProfiles(db, "2026-11-18T09:00:00.000Z");
    checkProfiles(db, "2026-11-18T09:00:00.000Z");
    expect(jobsOf(db, REQUEST_SURVEY)).toHaveLength(2);
    checkProfiles(db, "2026-11-18T10:00:00.000Z");
    expect(jobsOf(db, REQUEST_SURVEY)).toHaveLength(4);
  });

  it("schedules one check per slot, however many workers start", () => {
    const config = withOverrides(getConfig(), { profiling: { checkMinutes: 60 } });
    const now = new Date(Date.UTC(2026, 10, 17, 9, 30));
    scheduleProfileChecks(db, config, now);
    scheduleProfileChecks(db, config, now);
    expect(db.select().from(jobs).all().map((job) => [job.kind, job.runAfter.toISOString()])).toEqual([
      [CHECK_PROFILES, now.toISOString()],
      [CHECK_PROFILES, "2026-11-17T10:00:00.000Z"],
    ]);
  });

  it("queues the next slot's check before checking, and reports what it requested", () => {
    buildRepository(db, { name: "orders" });
    const config = withOverrides(getConfig(), { profiling: { checkMinutes: 60 } });
    const log: string[] = [];

    const result = runScheduledProfileCheck(db, config, { now: new Date(Date.UTC(2026, 10, 17, 9, 30)), log: (message) => log.push(message) });

    expect(result).toEqual({ checked: 1, requested: 1 });
    expect(jobsOf(db, CHECK_PROFILES).map((job) => job.runAfter.toISOString())).toEqual(["2026-11-17T10:00:00.000Z"]);
    expect(jobsOf(db, REQUEST_SURVEY).map((job) => job.idempotencyKey)).toEqual([expect.stringContaining("check:2026-11-17T09:00:00.000Z")]);
    expect(log).toEqual(["profiling check: 1 repositories, 1 survey requests queued"]);
  });
});

describe("background surveying", () => {
  const world = useAcquisitionWorld("background-survey");
  let work: Repo;
  beforeEach(() => {
    work = world.fixture.repo("fleet/web");
    work.write("package.json", manifest({ name: "web", version: "1.0.0" })).commit("first");
  });

  /** Runs queued jobs, at most +limit+, through the worker's handlers with +config+. */
  const run = (config: FrontendRegistryConfig = world.config, limit?: number) => drainJobs(world.db, jobHandlers(world.db, config), limit ? { limit } : {});
  const register = (name = "web", location = work.path, gitRef: string | null = null) => registerLocalRepository(world.db, world.config, name, location, gitRef);
  /** The repository as stored now, with its current survey. */
  const fresh = (repository: Repository) => getRepository(world.db, repository.publicId);
  const queued = (kind: string) => world.db.select().from(jobs).where(and(eq(jobs.kind, kind), eq(jobs.state, "queued"))).all();

  it("queues a background survey of the configured reference when a repository is added, and creates no Run", async () => {
    const repository = registerRepository(world.db, { name: "web", cloneUrl: work.url, gitRef: "" }, new SourceBoundary(world.config));
    expect(queued(REQUEST_SURVEY)).toEqual([expect.objectContaining({ priority: JOB_PRIORITIES.background })]);

    // The request reads the reference and queues the survey.
    await run(world.config, 1);
    expect(surveysOf(world.db, repository)).toEqual([
      expect.objectContaining({ number: 1, state: "queued", trigger: "added", commitSha: work.head(), reference: "refs/heads/main", fromConfiguredReference: true, requestedByRunId: null, ...currentRecipe(world.config) }),
    ]);
    expect(queued(RUN_SURVEY)).toEqual([expect.objectContaining({ priority: JOB_PRIORITIES.background })]);

    await run();
    expect(currentProfile(world.db, repository.id)).toMatchObject({ version: 1, commit: work.head() });
    expect(world.db.select().from(runs).all()).toEqual([]);
    expect(world.db.select().from(assessments).all()).toEqual([]);
  });

  it("surveys a new commit of the configured reference that the scheduled check finds", async () => {
    const repository = register();
    const first = work.head();
    checkProfiles(world.db, "2026-11-18T09:00:00.000Z");
    await run();
    expect(surveysOf(world.db, repository).map((survey) => [survey.number, survey.trigger, survey.commitSha, survey.state])).toEqual([[1, "added", first, "succeeded"]]);

    const second = work.write("README.md", "two\n").commit("second");
    checkProfiles(world.db, "2026-11-18T10:00:00.000Z");
    await run(world.config, 1);
    expect(latestSurvey(world.db, repository.id)).toMatchObject({ number: 2, trigger: "commit", commitSha: second, state: "queued", fromConfiguredReference: true });
    // The earlier survey stays current until the new one succeeds.
    expect(currentProfile(world.db, repository.id)).toMatchObject({ version: 1, commit: first });

    await run();
    expect(currentProfile(world.db, repository.id)).toMatchObject({ version: 2, commit: second });
  });

  it("surveys a repository again under a new recipe when the Frontend Registry starts with one, keeping the earlier survey and its Profile", async () => {
    const ordersWork = world.fixture.repo("fleet/orders");
    ordersWork.write("package.json", manifest({ name: "orders", version: "1.0.0" })).commit("first");
    const [web, orders] = [register(), register("orders", ordersWork.path)];
    for (const repository of [web, orders]) await surveyRepository(world.db, repository, "added", { config: world.config });
    await run();
    const before = currentProfile(world.db, web.id)!;

    const upgraded = withOverrides(world.config, { analysis: { maxFiles: world.config.analysis.maxFiles + 1 } });
    expect(currentRecipe(upgraded).configurationDigest).not.toBe(before.survey.configurationDigest);
    scheduleProfileChecks(world.db, upgraded);
    await run(upgraded);

    for (const repository of [web, orders]) {
      const [earlier, later] = surveysOf(world.db, repository);
      expect(later).toMatchObject({ number: 2, trigger: "recipe", commitSha: earlier!.commitSha, state: "succeeded", ...currentRecipe(upgraded) });
      expect(earlier).toMatchObject({ number: 1, state: "succeeded", ...currentRecipe(world.config) });
      expect(currentProfile(world.db, repository.id)).toMatchObject({ version: 2 });
    }
    expect(profileOfSurvey(world.db, before.survey.id)?.id).toBe(before.profile.id);
  });

  it("queues nothing when an operator re-profiles a repository whose commit and recipe haven't changed", async () => {
    const repository = register();
    const first = await surveyRepository(world.db, repository, "added", { config: world.config });
    expect(first).toMatchObject({ status: "queued", survey: { number: 1 } });
    // Asking again while it waits joins it.
    expect(await surveyRepository(world.db, fresh(repository), "manual", { config: world.config })).toMatchObject({ status: "active", survey: { id: first.survey.id } });
    await run();
    const jobCount = world.db.select().from(jobs).all().length;

    const again = await surveyRepository(world.db, fresh(repository), "manual", { config: world.config });
    expect(again).toMatchObject({ status: "current", survey: { id: first.survey.id, state: "succeeded" } });
    expect(surveysOf(world.db, repository)).toHaveLength(1);
    expect(world.db.select().from(jobs).all()).toHaveLength(jobCount);

    // Once the reference moves, Re-profile surveys the new commit.
    const next = work.write("README.md", "two\n").commit("second");
    expect(await surveyRepository(world.db, fresh(repository), "manual", { config: world.config })).toMatchObject({ status: "queued", survey: { number: 2, trigger: "manual", commitSha: next } });
  });

  it("creates no survey when the repository can't be reached", async () => {
    const repository = register();
    fs.rmSync(work.path, { recursive: true, force: true });

    const error = await surveyRepository(world.db, repository, "added", { config: world.config }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AcquisitionError);
    expect(error).toMatchObject({ code: "source_unavailable" });
    expect(surveysOf(world.db, repository)).toEqual([]);
    expect(world.db.select().from(jobs).all()).toEqual([]);
  });

  it("records why a reference couldn't be read on its request, until a later request reads it", async () => {
    const repository = register("web", work.path, "missing");
    checkProfiles(world.db, "2026-11-18T09:00:00.000Z");
    await run();

    expect(surveysOf(world.db, repository)).toEqual([]);
    expect(jobsOf(world.db, REQUEST_SURVEY)).toEqual([expect.objectContaining({ state: "failed" })]);
    expect(surveyRequestFailure(world.db, repository, latestSurvey(world.db, repository.id))).toEqual({ message: expect.stringContaining("no branch or tag named missing"), at: expect.any(Date) });

    // Editing the reference requests a survey that reads it.
    const edited = editRepository(world.db, repository.publicId, repository.lockVersion, { name: "web", cloneUrl: work.url, gitRef: "main" }, new SourceBoundary(world.config));
    await run();
    expect(surveysOf(world.db, edited)).toEqual([expect.objectContaining({ number: 1, trigger: "edited", reference: "refs/heads/main", state: "succeeded" })]);
    expect(surveyRequestFailure(world.db, edited, latestSurvey(world.db, edited.id))).toBeNull();
  });
});
