import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getAssessment, targetsOf } from "@/lib/assessments/assessment-records";
import { launchAssessment } from "@/lib/assessments/launcher";
import { finalizeAssessment, processTarget } from "@/lib/assessments/orchestration";
import { requestCancellation } from "@/lib/assessments/transitions";
import { cancelRun, requestFinalization } from "@/lib/assessments/waiting";
import { type RepositorySource, insertSource } from "@/lib/catalog/source-records";
import { withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { JOB_PRIORITIES, jobs, repositoryProfiles, surveys } from "@/lib/db/schema";
import { jobPayload } from "@/lib/jobs/queue";
import { NonRetryableError, drainJobs } from "@/lib/jobs/worker";
import { jobHandlers } from "@/lib/jobs/registry";
import { profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { surveyRepository } from "@/lib/surveys/background";
import { type Survey, surveyById } from "@/lib/surveys/records";
import { RUN_SURVEY } from "@/lib/surveys/run";
import { registerLocalSource, useAcquisitionWorld } from "../support/acquisition";
import { buildInitiative } from "../support/builders";
import { withSharedFileDb } from "../support/db";

describe("Assessment orchestration", () => {
  const world = useAcquisitionWorld("orchestration");

  function source(name: string, files: Record<string, string> = { "package.json": `{ "name": "${name}", "version": "1.0.0" }\n` }): RepositorySource {
    const work = world.fixture.repo(`fleet/${name}`);
    for (const [file, content] of Object.entries(files)) work.write(file, content);
    work.commit();
    return registerLocalSource(world.db, world.config, name, work.path);
  }

  function launch(sources: RepositorySource[], database: Db = world.db) {
    const initiative = buildInitiative(database, { sources });
    return launchAssessment(database, initiative.publicId, crypto.randomUUID(), world.config).assessment;
  }

  const run = (handlersConfig = world.config, limit?: number) => drainJobs(world.db, jobHandlers(world.db, handlersConfig), limit ? { limit } : {});
  const states = (assessmentId: number) => Object.fromEntries(targetsOf(world.db, assessmentId).map((target) => [target.sourceName, target.state]));
  const allSurveys = () => world.db.select().from(surveys).all();
  const surveyJobs = () => world.db.select().from(jobs).where(eq(jobs.kind, RUN_SURVEY)).all();
  const jobOf = (survey: Survey) => surveyJobs().find((job) => jobPayload(job).survey === survey.publicId)!;

  describe("target jobs", () => {
    it("assess every target independently: a failed source neither blocks the others nor erases their Profiles", async () => {
      const [orders, billing, missing] = [source("orders"), source("billing"), source("gone")];
      fs.rmSync(path.join(world.fixture.root, "fleet/gone"), { recursive: true, force: true });
      const assessment = launch([orders, billing, missing]);

      await run();
      const done = getAssessment(world.db, assessment.publicId);
      expect(done.state).toBe("complete_with_issues");
      expect(states(done.id)).toEqual({ billing: "complete", gone: "failed", orders: "complete" });
      expect(targetsOf(world.db, done.id).find((target) => target.sourceName === "gone")).toMatchObject({ failureCode: "source_unavailable" });
      expect(profilesOf(world.db, done.id).map(({ target }) => target.sourceName).sort()).toEqual(["billing", "orders"]);
      const map = mapDocument(mapOf(world.db, done.id)!) as unknown as MapDocument;
      expect(map.coverage.gaps).toEqual([expect.objectContaining({ source: expect.objectContaining({ name: "gone" }), state: "failed", reason: "source_unavailable" })]);
    });

    it("record how each target resolved and the survey of its commit, started by the Run under its recipe", async () => {
      const orders = source("orders");
      const assessment = launch([orders]);
      await run();

      const [target] = targetsOf(world.db, assessment.id);
      const survey = surveyById(world.db, target!.surveyId!);
      expect(target).toMatchObject({ state: "complete", refKind: "default_branch", resolvedRef: "refs/heads/main", resolvedAt: expect.any(Date) });
      expect(survey).toMatchObject({
        repositorySourceId: orders.id,
        state: "succeeded",
        trigger: "run",
        requestedByAssessmentId: assessment.id,
        reference: "refs/heads/main",
        fromConfiguredReference: true,
        surveyorRelease: assessment.detectorRelease,
        configurationDigest: assessment.configurationDigest,
        profileSchemaVersion: assessment.profileSchemaVersion,
      });
      expect(profilesOf(world.db, assessment.id).map(({ profile }) => profile.surveyId)).toEqual([survey.id]);
    });

    it("normalize an analysis failure to one target, with a stable code and no effect on others' records", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      // A worker whose analysis limits differ from the launch's cannot reproduce the recorded configuration.
      await run(withOverrides(world.config, { analysis: { maxFiles: 7 } }));

      const done = getAssessment(world.db, assessment.publicId);
      expect(done).toMatchObject({ state: "failed", failureReason: expect.stringContaining("analysis_failed") });
      for (const target of targetsOf(world.db, done.id)) expect(target).toMatchObject({ state: "failed", failureCode: "analysis_failed", failureMessage: expect.stringContaining("recorded configuration") });
      expect(profilesOf(world.db, done.id)).toEqual([]);
      // Each failure is its survey's, kept for a retry under the same key.
      expect(allSurveys().map((survey) => [survey.state, survey.failureCode])).toEqual([
        ["failed", "analysis_failed"],
        ["failed", "analysis_failed"],
      ]);
    });
  });

  describe("shared surveys", () => {
    it("two Runs on one commit share one survey and one Profile, and both complete", async () => {
      const web = source("web");
      const [first, second] = [launch([web]), launch([web])];
      await run();

      expect(getAssessment(world.db, first.publicId).state).toBe("complete");
      expect(getAssessment(world.db, second.publicId).state).toBe("complete");
      expect(allSurveys()).toEqual([expect.objectContaining({ state: "succeeded", trigger: "run", requestedByAssessmentId: first.id })]);
      expect(surveyJobs()).toHaveLength(1);
      expect(world.db.select().from(repositoryProfiles).all()).toHaveLength(1);
      const [[a], [b]] = [profilesOf(world.db, first.id), profilesOf(world.db, second.id)];
      expect(a!.profile.id).toBe(b!.profile.id);
    });

    it("a Run on a commit already surveyed completes at once, without surveying it again", async () => {
      const web = source("web");
      launch([web]);
      await run();

      const later = launch([web]);
      await run();
      expect(getAssessment(world.db, later.publicId).state).toBe("complete");
      expect(allSurveys()).toHaveLength(1);
      expect(surveyJobs()).toHaveLength(1);
      expect(profilesOf(world.db, later.id)).toHaveLength(1);
    });

    it("a Run joining a queued background survey raises its job to the Run's priority, ahead of other background work", async () => {
      const [other, web] = [source("other"), source("web")];
      const queuedFirst = await surveyRepository(world.db, other, "added", { config: world.config });
      const background = await surveyRepository(world.db, web, "added", { config: world.config });
      expect(jobOf(background.survey).priority).toBe(JOB_PRIORITIES.background);

      const assessment = launch([web]);
      await run(world.config, 2); // the coordinator and the target, which joins the background survey
      expect(targetsOf(world.db, assessment.id)[0]).toMatchObject({ state: "analyzing", surveyId: background.survey.id });
      expect(jobOf(background.survey).priority).toBe(JOB_PRIORITIES.normal);
      expect(jobOf(queuedFirst.survey).priority).toBe(JOB_PRIORITIES.background);

      // It's claimed before the background survey queued ahead of it.
      const [next] = await run(world.config, 1);
      expect(jobPayload(next!).survey).toBe(background.survey.publicId);
      expect(getAssessment(world.db, assessment.publicId).state).toBe("finalizing");

      await run();
      expect(getAssessment(world.db, assessment.publicId).state).toBe("complete");
      // The Run used the background survey rather than starting its own.
      expect(allSurveys().filter((survey) => survey.repositorySourceId === web.id)).toEqual([expect.objectContaining({ id: background.survey.id, trigger: "added", requestedByAssessmentId: null, state: "succeeded" })]);
    });

    it("an unreachable remote fails its own target with its own code, and creates no survey", async () => {
      const unreachable = insertSource(world.db, { name: "unreachable", cloneUrl: "https://127.0.0.1:1/acme/orders.git", canonicalUrl: "https://127.0.0.1:1/acme/orders" });
      const orders = source("orders");
      const assessment = launch([unreachable, orders]);
      await run();

      expect(getAssessment(world.db, assessment.publicId).state).toBe("complete_with_issues");
      expect(targetsOf(world.db, assessment.id).find((target) => target.sourceName === "unreachable")).toMatchObject({
        state: "failed",
        failureCode: "source_unavailable",
        refKind: null,
        resolvedRef: null,
        surveyId: null,
      });
      expect(allSurveys().map((survey) => survey.repositorySourceId)).toEqual([orders.id]);
    });
  });

  describe("finalization", () => {
    it("derives complete when every target contributes a Profile, and writes the map once", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      await run();
      const done = getAssessment(world.db, assessment.publicId);
      expect(done.state).toBe("complete");
      const map = mapOf(world.db, done.id)!;
      expect(finalizeAssessment(world.db, assessment.publicId).state).toBe("complete");
      expect(mapOf(world.db, done.id)!.id).toBe(map.id);
    });

    it("waits for every target, and refuses to finalize an Assessment that is not finalizing", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      await run(world.config, 2); // the coordinator and one target, which then waits on its survey
      const partial = getAssessment(world.db, assessment.publicId);
      expect(partial.state).toBe("analyzing");
      requestFinalization(world.db, partial.id);
      expect(getAssessment(world.db, assessment.publicId).state).toBe("analyzing");
      expect(() => finalizeAssessment(world.db, assessment.publicId)).toThrow(NonRetryableError);
      await run();
      expect(getAssessment(world.db, assessment.publicId).state).toBe("complete");
    });

    it("finalizes once when two connections race to finalize", async () => {
      await withSharedFileDb(async (shared, other) => {
        // The suite's helpers read the world's database.
        world.db = shared;
        const assessment = launch([source("orders"), source("billing")]);
        const coordinator = jobHandlers(world.db, world.config);
        await drainJobs(world.db, Object.fromEntries(Object.entries(coordinator).filter(([kind]) => kind !== "assessment.finalize")));
        expect(getAssessment(world.db, assessment.publicId).state).toBe("finalizing");

        const [first, second] = [finalizeAssessment(world.db, assessment.publicId), finalizeAssessment(other, assessment.publicId)];
        expect(first.state).toBe("complete");
        expect(second).toMatchObject({ state: "complete", id: first.id, finishedAt: first.finishedAt });
        expect(mapOf(other, first.id)).toBeDefined();
      });
    });
  });

  describe("cancellation", () => {
    it("before acquisition: no target resolves or joins a survey, and the Assessment is canceled", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      requestCancellation(world.db, assessment.id);
      await run();

      const done = getAssessment(world.db, assessment.publicId);
      expect(done.state).toBe("canceled");
      expect(states(done.id)).toEqual({ billing: "canceled", orders: "canceled" });
      for (const target of targetsOf(world.db, done.id)) expect(target).toMatchObject({ refKind: null, surveyId: null });
      expect(allSurveys()).toEqual([]);
    });

    it("during an Assessment: completed Profiles stay, waiting targets are canceled, their surveys run on, and it is never finalized as complete", async () => {
      const assessment = launch([source("orders"), source("billing"), source("reports")]);
      const byState = () => Object.values(states(assessment.id)).sort();
      await run(world.config, 5); // the coordinator, every target, and the first survey
      expect(byState()).toEqual(["analyzing", "analyzing", "complete"]);

      cancelRun(world.db, assessment.id);
      expect(byState()).toEqual(["canceled", "canceled", "complete"]);
      await run();

      const done = getAssessment(world.db, assessment.publicId);
      expect(done.state).toBe("canceled");
      expect(profilesOf(world.db, done.id)).toHaveLength(1);
      // The completed Profile remains reviewable in the map.
      expect((mapDocument(mapOf(world.db, done.id)!) as unknown as MapDocument).coverage.contributors).toHaveLength(1);
      // Surveys run to completion, because their Profiles stay reusable.
      expect(allSurveys().map((survey) => survey.state)).toEqual(["succeeded", "succeeded", "succeeded"]);
    });

    it("while waiting: a target waiting on its survey is canceled at once, and the survey's Profile isn't the Run's", async () => {
      const assessment = launch([source("orders")]);
      await run(world.config, 2); // the coordinator and the target, which then waits on its survey
      const [waiting] = targetsOf(world.db, assessment.id);
      expect(waiting).toMatchObject({ state: "analyzing", surveyId: expect.any(Number) });

      cancelRun(world.db, assessment.id);
      expect(getAssessment(world.db, assessment.publicId).state).toBe("finalizing");
      // A target job run again leaves a canceled target as it is.
      expect((await processTarget(world.db, waiting!.publicId, { config: world.config })).state).toBe("canceled");
      await run();

      expect(getAssessment(world.db, assessment.publicId).state).toBe("canceled");
      expect(profilesOf(world.db, assessment.id)).toEqual([]);
      expect(surveyById(world.db, waiting!.surveyId!).state).toBe("succeeded");
    });

    it("while resolving: a target canceled before its commit is known joins no survey", async () => {
      const assessment = launch([source("orders")]);
      const [target] = targetsOf(world.db, assessment.id);

      // The job passes the check before resolving, then awaits ls-remote.
      const pending = processTarget(world.db, target!.publicId, { config: world.config });
      await new Promise((resolve) => setImmediate(resolve));
      cancelRun(world.db, assessment.id);

      expect(await pending).toMatchObject({ state: "canceled", surveyId: null });
      expect(allSurveys()).toEqual([]);
      expect(getAssessment(world.db, assessment.publicId).state).toBe("finalizing");
    });

    it("of one of two Runs waiting on one survey: that target is canceled, the survey keeps running, and the other Run continues when it finishes", async () => {
      const web = source("web");
      const [canceled, continuing] = [launch([web]), launch([web])];
      await run(world.config, 4); // both coordinators and both targets
      const [survey] = allSurveys();
      expect(survey).toMatchObject({ state: "queued" });
      expect(states(canceled.id)).toEqual({ web: "analyzing" });
      expect(states(continuing.id)).toEqual({ web: "analyzing" });

      cancelRun(world.db, canceled.id);
      expect(states(canceled.id)).toEqual({ web: "canceled" });
      expect(states(continuing.id)).toEqual({ web: "analyzing" });
      expect(surveyById(world.db, survey!.id).state).toBe("queued");
      expect(jobOf(survey!).state).toBe("queued");

      await run();
      expect(surveyById(world.db, survey!.id).state).toBe("succeeded");
      expect(getAssessment(world.db, canceled.publicId).state).toBe("canceled");
      expect(getAssessment(world.db, continuing.publicId).state).toBe("complete");
      expect(profilesOf(world.db, canceled.id)).toEqual([]);
      expect(profilesOf(world.db, continuing.id).map(({ profile }) => profile.surveyId)).toEqual([survey!.id]);
    });
  });
});
