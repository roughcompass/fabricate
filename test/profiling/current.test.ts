import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { launchRun } from "@/lib/runs/launcher";
import { type RepositorySource, getSource, updateSource } from "@/lib/catalog/source-records";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { requestPreparation } from "@/lib/previews/preparation";
import { currentProfile, currentProfiles } from "@/lib/profiling/current";
import { repositoryProfiling } from "@/lib/profiling/versions";
import { surveyRepository } from "@/lib/surveys/background";
import { currentRecipe, latestSurvey, requestSurvey } from "@/lib/surveys/records";
import { registerLocalSource, useAcquisitionWorld } from "../support/acquisition";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import type { Repo } from "../support/git-fixture";
import { manifest, sha1 } from "../support/profiles";
import { seedRun } from "../support/scenarios";

describe("a repository's current Profile", () => {
  const world = useAcquisitionWorld("current-profile");
  let work: Repo;
  let web: RepositorySource;
  beforeEach(() => {
    work = world.fixture.repo("fleet/web");
    work.write("package.json", manifest({ name: "web", version: "1.0.0" })).commit("first");
    web = registerLocalSource(world.db, world.config, "web", work.path);
  });

  /** Runs every queued job through the worker's handlers with +config+. */
  const run = (config: FrontendRegistryConfig = world.config) => drainJobs(world.db, jobHandlers(world.db, config));
  /** Surveys web's configured reference in the background, to the end. */
  async function surveyInBackground(): Promise<void> {
    await surveyRepository(world.db, getSource(world.db, web.publicId), "manual", { config: world.config });
    await run();
  }
  /** Launches a Run of an Assessment over web, as it's configured now, and runs it to the end. */
  async function runAssessment(): Promise<void> {
    const initiative = buildInitiative(world.db, { sources: [getSource(world.db, web.publicId)] });
    launchRun(world.db, initiative.publicId, crypto.randomUUID(), world.config);
    await run();
  }

  it("is undefined until a survey of the configured reference succeeds", async () => {
    expect(currentProfile(world.db, web.id)).toBeUndefined();
    await surveyInBackground();
    expect(currentProfile(world.db, web.id)).toMatchObject({ version: 1, commit: work.head(), survey: { trigger: "manual", state: "succeeded" } });
  });

  /**
   * Commits to a feature branch and runs a Run on it to the end: the Run
   * launched while web named the branch, and web names its default branch
   * again before the target resolves. Returns the branch's commit.
   */
  async function runOnBranch(): Promise<string> {
    work.git("checkout", "--quiet", "-b", "feature");
    const feature = work.write("feature.txt", "feature\n").commit("feature");
    work.checkout("main");
    const named = updateSource(world.db, web.publicId, web.lockVersion, { gitRef: "feature" });
    launchRun(world.db, buildInitiative(world.db, { sources: [named] }).publicId, crypto.randomUUID(), world.config);
    updateSource(world.db, web.publicId, named.lockVersion, { gitRef: null });
    await run();
    return feature;
  }

  it("stays put when a Run surveys a branch other than the configured reference", async () => {
    await surveyInBackground();
    const feature = await runOnBranch();

    expect(latestSurvey(world.db, web.id)).toMatchObject({ number: 2, trigger: "run", commitSha: feature, reference: "refs/heads/feature", fromConfiguredReference: false, state: "succeeded" });
    expect(currentProfile(world.db, web.id)).toMatchObject({ version: 1, survey: { trigger: "manual" } });
  });

  it("becomes a branch's survey once the configured reference moves to its commit, without surveying it again", async () => {
    await surveyInBackground();
    const feature = await runOnBranch();
    // The branch is merged: main now names the commit the Run surveyed.
    work.git("merge", "--quiet", "--ff-only", "feature");

    const result = await surveyRepository(world.db, getSource(world.db, web.publicId), "check", { config: world.config });

    expect(result).toMatchObject({ status: "current", survey: { number: 2, commitSha: feature } });
    expect(currentProfile(world.db, web.id)).toMatchObject({ version: 2, commit: feature });
  });

  it("becomes a Run's survey of a newer commit of the configured reference", async () => {
    await surveyInBackground();
    const newer = work.write("README.md", "two\n").commit("second");
    await runAssessment();

    expect(currentProfile(world.db, web.id)).toMatchObject({ version: 2, commit: newer, survey: { trigger: "run", fromConfiguredReference: true } });
  });

  it("becomes a preview's survey of a newer commit of the configured reference", async () => {
    await surveyInBackground();
    const newer = work.write("README.md", "two\n").commit("second");
    const config = withOverrides(world.config, { previews: { enabled: true, trustedSources: [web.canonicalUrl] } });
    // web names no reference, so its default branch is the configured one.
    await requestPreparation(world.db, web.publicId, { kind: "ref", name: null }, { config });
    await run(config);

    expect(latestSurvey(world.db, web.id)).toMatchObject({ number: 2, trigger: "preview", commitSha: newer, reference: "refs/heads/main", state: "succeeded" });
    expect(currentProfile(world.db, web.id)).toMatchObject({ version: 2, commit: newer });
  });

  it("stays the older survey's Profile when the newest survey failed, which the Repository page shows", async () => {
    await surveyInBackground();
    work.write("README.md", "two\n").commit("second");
    await surveyRepository(world.db, getSource(world.db, web.publicId), "check", { config: world.config });
    // A worker on another recipe can't reproduce the survey's, so it fails.
    await run(withOverrides(world.config, { analysis: { maxFiles: 7 } }));

    expect(latestSurvey(world.db, web.id)).toMatchObject({ number: 2, trigger: "commit", state: "failed", failureCode: "analysis_failed" });
    expect(currentProfile(world.db, web.id)).toMatchObject({ version: 1 });
    expect(repositoryProfiling(world.db, web.id)).toMatchObject({ current: { version: 1 }, latest: { version: 2, failure: { code: "analysis_failed" } }, count: 2 });
  });
});

/** The SQL of every statement +read+ prepares on +db+, with what it returned. */
function statementsOf<T>(db: Db, read: () => T): { result: T; statements: string[] } {
  const statements: string[] = [];
  const prepare = db.$client.prepare.bind(db.$client);
  db.$client.prepare = ((source: string) => {
    statements.push(source);
    return prepare(source);
  }) as typeof db.$client.prepare;
  try {
    return { result: read(), statements };
  } finally {
    db.$client.prepare = prepare;
  }
}

describe("reading current Profiles", () => {
  let db: Db;
  let orders: RepositorySource;
  beforeEach(() => {
    db = createTestDb();
    orders = buildSource(db, { name: "orders" });
  });

  const profiled = (name: string) => ({ "package.json": manifest({ name, version: "1.0.0" }) });

  it("reads several repositories, or every one, in one query", async () => {
    const billing = buildSource(db, { name: "billing" });
    const ledger = buildSource(db, { name: "ledger" });
    await seedRun(db, buildInitiative(db, { sources: [orders, billing, ledger] }), [orders, billing, ledger], [profiled("orders"), profiled("billing"), "failed"]);

    const some = statementsOf(db, () => currentProfiles(db, [orders.id, ledger.id]));
    const every = statementsOf(db, () => currentProfiles(db));

    expect([...some.result.keys()]).toEqual([orders.id]);
    expect([...every.result.keys()].sort()).toEqual([orders.id, billing.id].sort());
    expect([...some.statements, ...every.statements]).toHaveLength(2);
    expect(currentProfiles(db, [])).toEqual(new Map());
  });

  it("reads what the Repository page shows in two queries, however many versions there are", async () => {
    for (let index = 0; index < 3; index++) await seedRun(db, buildInitiative(db, { sources: [orders] }), [orders], [profiled("orders")]);
    requestSurvey(db, { repositorySourceId: orders.id, commitSha: sha1("commit:queued"), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "manual", ...currentRecipe(getConfig()) });

    const { result, statements } = statementsOf(db, () => repositoryProfiling(db, orders.id));

    expect(result).toMatchObject({ current: { version: 3 }, latest: { version: 4, survey: { state: "queued" } }, count: 4 });
    expect(statements).toHaveLength(2);
  });
});
