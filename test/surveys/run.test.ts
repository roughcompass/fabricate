import fs from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { mirrorPath, surveyRefFor } from "@/lib/acquisition/mirror";
import { getRun, getTarget } from "@/lib/runs/run-records";
import { processTarget } from "@/lib/runs/orchestration";
import { type Repository, repositoryById } from "@/lib/repositories/repository-records";
import { withOverrides } from "@/lib/config";
import { dependencyFacts, jobs, surveys } from "@/lib/db/schema";
import { GitRunner } from "@/lib/git/runner";
import { drainJobs } from "@/lib/jobs/worker";
import { jobHandlers } from "@/lib/jobs/registry";
import { profileDocument, profileOfSurvey } from "@/lib/profiles/profile-records";
import { SnapshotReader } from "@/lib/snapshot/reader";
import { surveyRepository } from "@/lib/surveys/background";
import { type SurveyRequest, currentRecipe, getSurvey, requestSurvey, surveyById } from "@/lib/surveys/records";
import { RUN_SURVEY, queueSurvey, runSurvey } from "@/lib/surveys/run";
import { acquire, registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { buildRun } from "../support/builders";
import { type BareRepo, type Repo, git } from "../support/git-fixture";
import { manifest } from "../support/profiles";

describe("the survey job", () => {
  const world = useAcquisitionWorld("survey-run");
  let work: Repo;
  let remote: BareRepo;
  let head: string;

  beforeEach(() => {
    work = world.fixture.repo("work/web");
    head = work.write("package.json", manifest({ name: "web", version: "1.0.0", dependencies: { react: "^19.0.0" } })).commit();
    remote = world.fixture.bare("remotes/web.git", { from: work });
  });

  const register = (gitRef: string | null = null) => registerLocalRepository(world.db, world.config, "web", remote.path, gitRef);
  const drain = () => drainJobs(world.db, jobHandlers(world.db, world.config));
  const surveyJobs = () => world.db.select().from(jobs).where(eq(jobs.kind, RUN_SURVEY)).all();

  /** Requests a survey of +commitSha+ of +source+ under the worker's recipe unless +overrides+ say otherwise, and queues its job. */
  function request(repository: Repository, commitSha: string, overrides: Partial<SurveyRequest> = {}) {
    const { survey } = requestSurvey(world.db, { repositoryId: repository.id, commitSha, reference: "refs/heads/main", fromConfiguredReference: true, trigger: "manual", ...currentRecipe(world.config), ...overrides });
    queueSurvey(world.db, survey);
    return survey;
  }

  /** A Run over +source+ whose target has resolved its reference and waits on the survey of its commit. */
  async function waitingRun(repository: Repository) {
    const { run, targets } = buildRun(world.db, { repositories: [repository] });
    const target = await processTarget(world.db, targets[0]!.publicId, { config: world.config });
    expect(target).toMatchObject({ state: "analyzing", surveyId: expect.any(Number) });
    return { run, target };
  }

  describe("success", () => {
    it("pins the commit, stores and projects its Profile, and makes it the Repository's current survey", async () => {
      const web = register();
      const background = await surveyRepository(world.db, web, "added", { config: world.config });
      expect(background).toMatchObject({ status: "queued", survey: { state: "queued", commitSha: head, trigger: "added" } });
      await drain();

      const survey = getSurvey(world.db, background.survey.publicId);
      expect(survey).toMatchObject({ state: "succeeded", attempts: 1, failureCode: null, finishedAt: expect.any(Date), internalRef: surveyRefFor(survey.publicId), treeSha: remote.rev(`${head}^{tree}`) });
      expect(git(mirrorPath(world.config.repositoryStorage, web.publicId), ["rev-parse", survey.internalRef!]).trim()).toBe(head);
      const profile = profileOfSurvey(world.db, survey.id)!;
      expect(profileDocument(profile)).toMatchObject({ commit: head, detector_release: survey.surveyorRelease, detector_configuration_digest: survey.configurationDigest });
      expect(world.db.select().from(dependencyFacts).where(eq(dependencyFacts.profileId, profile.id)).all().map((row) => row.packageName)).toContain("react");
      expect(repositoryById(world.db, web.id).currentSurveyId).toBe(survey.id);
      expect(surveyJobs().map((job) => [job.idempotencyKey, job.state])).toEqual([[`survey.run:${survey.publicId}:1`, "succeeded"]]);

      // A survey already finished stays as it is.
      expect(await runSurvey(world.db, survey.publicId, { config: world.config })).toEqual(survey);
    });

    it("doesn't make a survey of another reference the Repository's current one", async () => {
      const web = register();
      const survey = request(web, head, { reference: "refs/heads/feature", fromConfiguredReference: false });
      await drain();

      expect(getSurvey(world.db, survey.publicId).state).toBe("succeeded");
      expect(repositoryById(world.db, web.id).currentSurveyId).toBeNull();
    });
  });

  describe("failure", () => {
    it("fails with invalid_ref when the remote doesn't have its commit, and fails the target waiting on it", async () => {
      const unpushed = work.write("late.txt", "late\n").commit("late");
      const web = register(unpushed);
      const { run, target } = await waitingRun(web);
      await drain();

      const survey = surveyById(world.db, target.surveyId!);
      expect(survey).toMatchObject({ state: "failed", attempts: 1, failureCode: "invalid_ref", failureMessage: expect.stringContaining(unpushed), internalRef: null, finishedAt: expect.any(Date) });
      expect(getTarget(world.db, target.publicId)).toMatchObject({ state: "failed", failureCode: "invalid_ref", failureMessage: survey.failureMessage });
      expect(getRun(world.db, run.publicId).state).toBe("failed");
      expect(profileOfSurvey(world.db, survey.id)).toBeUndefined();
      expect(repositoryById(world.db, web.id).currentSurveyId).toBeNull();
    });

    it("fails as unavailable when the remote is gone, and fails every target waiting on it", async () => {
      const web = register();
      const [first, second] = [await waitingRun(web), await waitingRun(web)];
      expect(second.target.surveyId).toBe(first.target.surveyId);
      fs.rmSync(remote.path, { recursive: true, force: true });
      await drain();

      expect(surveyById(world.db, first.target.surveyId!)).toMatchObject({ state: "failed", failureCode: "source_unavailable" });
      for (const { run, target } of [first, second]) {
        expect(getTarget(world.db, target.publicId)).toMatchObject({ state: "failed", failureCode: "source_unavailable" });
        expect(getRun(world.db, run.publicId).state).toBe("failed");
      }
    });

    it("fails with analysis_failed when the worker's recipe isn't the survey's", async () => {
      const web = register();
      // A worker whose analysis limits differ from the request's has another configuration digest.
      const survey = request(web, head, currentRecipe(withOverrides(world.config, { analysis: { maxFiles: 7 } })));
      await drain();

      // The commit was pinned; Surveyor refused to run.
      expect(getSurvey(world.db, survey.publicId)).toMatchObject({ state: "failed", failureCode: "analysis_failed", failureMessage: expect.stringContaining("recorded configuration"), internalRef: surveyRefFor(survey.publicId) });
      expect(profileOfSurvey(world.db, survey.id)).toBeUndefined();
    });

    it("leaves the survey running when the worker stops, and the job's next run resumes it", async () => {
      const web = register();
      const survey = request(web, head);
      const stopping = new AbortController();
      stopping.abort();

      await expect(runSurvey(world.db, survey.publicId, { config: world.config, signal: stopping.signal })).rejects.toMatchObject({ code: "canceled" });
      expect(getSurvey(world.db, survey.publicId)).toMatchObject({ state: "running", attempts: 1 });
      await drain();
      expect(getSurvey(world.db, survey.publicId)).toMatchObject({ state: "succeeded", attempts: 1 });
    });
  });

  describe("retry", () => {
    it("retries a failed survey under the same key, as the next attempt of its job", async () => {
      const unpushed = work.write("late.txt", "late\n").commit("late");
      const web = register();
      const survey = request(web, unpushed, { reference: unpushed, fromConfiguredReference: false });
      await drain();
      expect(getSurvey(world.db, survey.publicId)).toMatchObject({ state: "failed", attempts: 1, failureCode: "invalid_ref" });

      work.git("push", "--quiet", remote.path, `${unpushed}:refs/heads/late`);
      const retried = requestSurvey(world.db, { repositoryId: web.id, commitSha: unpushed, reference: "refs/heads/late", fromConfiguredReference: false, trigger: "manual", ...currentRecipe(world.config) });
      // The same survey, queued again; its latest failure stays until it succeeds.
      expect(retried).toMatchObject({ queued: true, survey: { id: survey.id, state: "queued", attempts: 1, failureCode: "invalid_ref", finishedAt: null } });
      expect(queueSurvey(world.db, retried.survey).idempotencyKey).toBe(`survey.run:${survey.publicId}:2`);
      await drain();

      expect(getSurvey(world.db, survey.publicId)).toMatchObject({ state: "succeeded", attempts: 2, failureCode: null, failureMessage: null, reference: unpushed });
      expect(world.db.select().from(surveys).all()).toHaveLength(1);
      expect(surveyJobs().map((job) => [job.idempotencyKey, job.state])).toEqual([
        [`survey.run:${survey.publicId}:1`, "succeeded"],
        [`survey.run:${survey.publicId}:2`, "succeeded"],
      ]);
    });
  });

  describe("a survey reference", () => {
    it("opens through SnapshotReader, which still refuses refs that aren't pins", async () => {
      const web = register();
      const { survey } = await acquire(world.db, world.config, web);
      const runner = new GitRunner({ config: world.config });
      const gitDir = mirrorPath(world.config.repositoryStorage, web.publicId);
      const open = (ref: string) => SnapshotReader.open(runner, gitDir, ref, survey.commitSha, world.config.analysis);

      const reader = await open(surveyRefFor(survey.publicId));
      expect(reader.commitSha).toBe(head);
      expect(reader.files().map((entry) => entry.path)).toEqual(["package.json"]);

      // Each of these names the commit too, but isn't a pin.
      for (const ref of ["refs/heads/main", `refs/fabricate/incoming/${survey.publicId}`, "refs/fabricate/snapshots/prf_aaaaaaaaaaaaaaaa", `${surveyRefFor(survey.publicId)}0`]) {
        git(gitDir, ["update-ref", ref, head]);
        await expect(open(ref)).rejects.toMatchObject({ code: "command_rejected" });
      }
    });
  });
});
