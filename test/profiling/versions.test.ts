import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { surveyRefFor } from "@/lib/acquisition/mirror";
import { launchRun } from "@/lib/runs/launcher";
import { registerRepository } from "@/lib/repositories/registration";
import { SourceBoundary } from "@/lib/repositories/source-boundary";
import type { Repository } from "@/lib/repositories/repository-records";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { type SurveyTrigger, runs } from "@/lib/db/schema";
import { listAssessments } from "@/lib/assessments/assessment-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { requestPreparation } from "@/lib/previews/preparation";
import { checkProfiles } from "@/lib/profiling/check";
import { currentProfile } from "@/lib/profiling/current";
import { TRIGGER_LABELS, findVersion, isActive, profileSummaries, profilingActivity, repositoryProfiling, versionCount, versionsOf } from "@/lib/profiling/versions";
import { profileOfSurvey } from "@/lib/profiles/profile-records";
import { surveyRepository } from "@/lib/surveys/background";
import { type Survey, currentRecipe, moveSurvey, pinSurvey, recordConfiguredResolution, requestSurvey } from "@/lib/surveys/records";
import { finishSurvey } from "@/lib/surveys/run";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { buildAssessment, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { manifest, memoryProfile, sha1 } from "../support/profiles";

let commits = 0;

interface SurveyOptions {
  trigger?: SurveyTrigger;
  /** Where it ends: with a Profile by default, failed, or still on its way. */
  end?: "succeeded" | "failed" | "queued" | "running";
  fromConfiguredReference?: boolean;
}

/** A survey of a new commit of +repository+ under the current recipe, driven to +end+ as the survey job would. */
async function survey(db: Db, repository: Repository, options: SurveyOptions = {}): Promise<Survey> {
  const commitSha = sha1(`commit:${repository.publicId}:${++commits}`);
  const { survey: queued } = requestSurvey(db, {
    repositoryId: repository.id,
    commitSha,
    reference: options.fromConfiguredReference === false ? "refs/heads/feature" : "refs/heads/main",
    fromConfiguredReference: options.fromConfiguredReference ?? true,
    trigger: options.trigger ?? "manual",
    ...currentRecipe(getConfig()),
  });
  // Background surveying records which commit the configured reference names.
  if (options.fromConfiguredReference !== false) recordConfiguredResolution(db, repository.id, commitSha, new Date());
  const end = options.end ?? "succeeded";
  if (end === "queued") return queued;
  const running = pinSurvey(db, moveSurvey(db, queued, "running", { attempts: 1 }), { treeSha: sha1(`tree:${commitSha}`), internalRef: surveyRefFor(queued.publicId) });
  if (end === "running") return running;
  if (end === "failed") return finishSurvey(db, running, { failure: { code: "source_unavailable", message: "The repository could not be reached" } });
  const { document } = await memoryProfile({ "package.json": manifest({ name: repository.name, version: "1.0.0" }) }, { public_id: repository.publicId, name: repository.name }, commitSha);
  return finishSurvey(db, running, { document });
}

describe("profile versions", () => {
  let db: Db;
  let orders: Repository;
  beforeEach(() => {
    db = createTestDb();
    orders = buildRepository(db, { name: "orders" });
  });

  it("numbers a fifth survey 5, and versions 1 to 4 keep their numbers and addresses", async () => {
    await survey(db, orders, { trigger: "added" });
    await survey(db, orders, { trigger: "commit", end: "failed" });
    await survey(db, orders, { trigger: "manual" });
    await survey(db, orders, { trigger: "preview", fromConfiguredReference: false });
    const before = [1, 2, 3, 4].map((number) => findVersion(db, orders.id, number)!.survey.publicId);

    const fifth = await survey(db, orders, { trigger: "commit" });

    expect(fifth.number).toBe(5);
    expect(versionsOf(db, orders.id).map((version) => version.version)).toEqual([5, 4, 3, 2, 1]);
    expect([1, 2, 3, 4].map((number) => findVersion(db, orders.id, number)!.survey.publicId)).toEqual(before);
    expect(findVersion(db, orders.id, 5)!.survey.publicId).toBe(fifth.publicId);
  });

  it("numbers each repository's surveys on their own", async () => {
    const ledger = buildRepository(db, { name: "ledger" });
    await survey(db, orders);
    await survey(db, ledger);
    await survey(db, orders);

    expect(versionsOf(db, orders.id).map((version) => version.version)).toEqual([2, 1]);
    expect(versionsOf(db, ledger.id).map((version) => version.version)).toEqual([1]);
  });

  it("shows each version's state, commit, Profile, and failure, and pages newest first", async () => {
    const first = await survey(db, orders);
    const failed = await survey(db, orders, { end: "failed" });
    await survey(db, orders, { end: "running" });
    await survey(db, orders, { end: "queued" });

    const versions = versionsOf(db, orders.id);
    expect(versions.map((version) => [version.version, version.survey.state, version.profile !== null, version.failure?.code ?? null, isActive(version)])).toEqual([
      [4, "queued", false, null, true],
      [3, "running", false, null, true],
      [2, "failed", false, "source_unavailable", false],
      [1, "succeeded", true, null, false],
    ]);
    expect(versions[3]).toMatchObject({ commit: first.commitSha, profile: { publicId: profileOfSurvey(db, first.id)!.publicId } });
    expect(findVersion(db, orders.id, 2)).toMatchObject({ commit: failed.commitSha, failure: { code: "source_unavailable", message: "The repository could not be reached" } });

    expect(versionCount(db, orders.id)).toBe(4);
    expect(versionsOf(db, orders.id, 2, 1).map((version) => version.version)).toEqual([3, 2]);
    for (const missing of [0, 5, 1.5, -1]) expect(findVersion(db, orders.id, missing)).toBeUndefined();
    expect(versionCount(db, buildRepository(db, { name: "ledger" }).id)).toBe(0);
  });

  it("shows the newest successful survey of the configured reference as current, apart from the newest version", async () => {
    await survey(db, orders);
    await survey(db, orders, { end: "failed" });
    await survey(db, orders, { end: "queued" });

    expect(repositoryProfiling(db, orders.id)).toMatchObject({ current: { version: 1 }, latest: { version: 3, survey: { state: "queued" } }, count: 3 });
    expect(repositoryProfiling(db, buildRepository(db, { name: "ledger" }).id)).toEqual({ current: undefined, latest: undefined, count: 0 });
  });

  it("summarizes every repository's newest version and current Profile", async () => {
    const ledger = buildRepository(db, { name: "ledger" });
    const shop = buildRepository(db, { name: "shop" });
    buildRepository(db, { name: "billing" });
    await survey(db, orders);
    await survey(db, orders, { end: "queued" });
    await survey(db, ledger, { end: "queued" });
    // A survey of a branch is a version, but never current.
    await survey(db, shop, { trigger: "preview", fromConfiguredReference: false });

    const summaries = profileSummaries(db);
    expect(summaries.size).toBe(3);
    expect(summaries.get(orders.id)).toMatchObject({ latest: { version: 2, state: "queued", profiled: false }, current: { version: 1, profilePublicId: expect.stringMatching(/^prf_/) } });
    expect(summaries.get(ledger.id)).toMatchObject({ latest: { version: 1, state: "queued", profiled: false }, current: null });
    expect(summaries.get(shop.id)).toMatchObject({ latest: { version: 1, state: "succeeded", profiled: true }, current: null });
  });

  it("counts surveys running and waiting, and changes its version as each one moves", async () => {
    const ledger = buildRepository(db, { name: "ledger" });
    expect(profilingActivity(db)).toMatchObject({ profiling: 0, queued: 0 });
    const waiting = await survey(db, orders, { end: "queued" });
    await survey(db, ledger, { end: "queued" });
    const queued = profilingActivity(db);
    expect(queued).toMatchObject({ profiling: 0, queued: 2 });

    const running = moveSurvey(db, waiting, "running", { attempts: 1 });
    const started = profilingActivity(db);
    expect(started).toMatchObject({ profiling: 1, queued: 1 });
    expect(started.version).not.toBe(queued.version);

    finishSurvey(db, running, { failure: { code: "source_unavailable", message: "The repository could not be reached" } });
    expect(profilingActivity(db)).toMatchObject({ profiling: 0, queued: 1 });
  });
});

describe("background profiling", () => {
  const world = useAcquisitionWorld("profile-versions");

  it("surveys repositories without any Assessment or Run", async () => {
    const work = world.fixture.repo("fleet/web");
    work.write("package.json", manifest({ name: "web", version: "1.0.0" })).commit("first");
    const web = registerLocalRepository(world.db, world.config, "web", work.path);
    await surveyRepository(world.db, web, "added", { config: world.config });
    await drainJobs(world.db, jobHandlers(world.db, world.config));

    expect(currentProfile(world.db, web.id)).toMatchObject({ version: 1 });
    expect(listAssessments(world.db)).toEqual([]);
    expect(world.db.select().from(runs).all()).toEqual([]);
  });

  it("names what started each version: adding the repository, a new commit, a Run of an Assessment, and a preview", async () => {
    const work = world.fixture.repo("fleet/web");
    work.write("package.json", manifest({ name: "web", version: "1.0.0" })).commit("first");
    const web = registerRepository(world.db, { name: "web", cloneUrl: work.url, gitRef: "" }, new SourceBoundary(world.config));
    const config = withOverrides(world.config, { previews: { enabled: true, trustedSources: [web.canonicalUrl] } });
    const drain = () => drainJobs(world.db, jobHandlers(world.db, config));
    await drain();

    work.write("README.md", "two\n").commit("second");
    checkProfiles(world.db, "2026-11-18T09:00:00.000Z");
    await drain();

    work.write("README.md", "three\n").commit("third");
    const assessment = buildAssessment(world.db, { name: "Checkout platform migration", repositories: [web] });
    const { run } = launchRun(world.db, assessment.publicId, crypto.randomUUID(), config);
    await drain();

    work.git("checkout", "--quiet", "-b", "feature");
    const feature = work.write("feature.txt", "feature\n").commit("feature");
    work.checkout("main");
    await requestPreparation(world.db, web.publicId, { kind: "ref", name: "feature" }, { config });
    await drain();

    const versions = versionsOf(world.db, web.id);
    expect(versions.map((version) => [version.version, version.trigger, TRIGGER_LABELS[version.trigger], version.survey.state])).toEqual([
      [4, "preview", "Preview", "succeeded"],
      [3, "run", "Assessment Run", "succeeded"],
      [2, "commit", "New commit", "succeeded"],
      [1, "added", "Added", "succeeded"],
    ]);
    expect(versions.map((version) => version.requestedBy)).toEqual([null, { runPublicId: run.publicId, name: "Checkout platform migration" }, null, null]);
    expect(versions[0]).toMatchObject({ commit: feature, survey: { reference: "refs/heads/feature", fromConfiguredReference: false } });
    // The preview's survey of a branch is a version, but the Run's survey of the reference stays current.
    expect(currentProfile(world.db, web.id)?.version).toBe(3);
  });
});
