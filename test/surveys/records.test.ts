import { detectorConfiguration } from "@repo-facts/bundle";
import { SURVEYOR_RELEASE } from "@/lib/surveys/surveyor-release";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { surveyRefFor } from "@/lib/acquisition/mirror";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { TransitionError } from "@/lib/db/errors";
import { JOB_PRIORITIES, repositorySources, surveys } from "@/lib/db/schema";
import { CURRENT_VERSION } from "@/lib/documents/schemas";
import { insertProfile } from "@/lib/profiles/profile-records";
import { currentRecipe, moveSurvey, pinSurvey, type Recipe, recordConfiguredResolution, requestSurvey, type Survey, surveyOfKey, type SurveyRequest, updateCurrentSurvey } from "@/lib/surveys/records";
import { finishSurvey, queueSurvey } from "@/lib/surveys/run";
import { buildAssessment, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { manifest, memoryProfile, sha1 } from "../support/profiles";
import { findVersion } from "@/lib/profiling/versions";

const A = sha1("commit:a");
const B = sha1("commit:b");
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 18, 9, minutes));

describe("surveys", () => {
  let db: Db;
  let web: RepositorySource;
  let recipe: Recipe;
  beforeEach(() => {
    db = createTestDb();
    web = buildSource(db, { name: "web" });
    recipe = currentRecipe(getConfig());
  });

  /**
   * Requests the survey of +commitSha+ of +source+, a background one of its
   * configured reference unless +overrides+ say otherwise, recording that
   * reference's resolution as background surveying does.
   */
  const request = (source: RepositorySource, commitSha: string, overrides: Partial<SurveyRequest> = {}) => {
    const requested = requestSurvey(db, { repositorySourceId: source.id, commitSha, reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", ...recipe, ...overrides });
    if (overrides.fromConfiguredReference !== false) recordConfiguredResolution(db, source.id, commitSha, overrides.resolvedAt ?? new Date());
    return requested;
  };

  /** Runs +survey+ to a Profile of its commit, or to a failure, as the survey job does. */
  async function finish(survey: Survey, outcome: "succeeded" | "failed" = "succeeded"): Promise<Survey> {
    const running = pinSurvey(db, moveSurvey(db, survey, "running", { attempts: survey.attempts + 1 }), { treeSha: null, internalRef: surveyRefFor(survey.publicId) });
    if (outcome === "failed") return finishSurvey(db, running, { failure: { code: "analysis_failed", message: "Surveyor stopped" } });
    const { document } = await memoryProfile({ "package.json": manifest({ name: "web", version: "1.0.0" }) }, { public_id: web.publicId, name: "web" }, survey.commitSha);
    return finishSurvey(db, running, { document });
  }

  const currentSurveyId = (source: RepositorySource) => db.select({ id: repositorySources.currentSurveyId }).from(repositorySources).where(eq(repositorySources.id, source.id)).get()!.id;

  describe("records", () => {
    it("records the recipe this worker surveys with: the Surveyor release, configuration digest, and profile schema version", () => {
      expect(recipe).toEqual({ surveyorRelease: SURVEYOR_RELEASE, configurationDigest: detectorConfiguration(getConfig().analysis).digest, profileSchemaVersion: CURRENT_VERSION.repositoryProfile });
    });

    it("finds the one survey of a repository, commit, and recipe, whoever asks for it", () => {
      const first = request(web, A);
      expect(first).toMatchObject({ queued: true, survey: { number: 1, state: "queued", trigger: "added", attempts: 0, requestedByAssessmentId: null, ...recipe } });

      // A Run asking for the same key joins the background survey as it is.
      const { assessment } = buildAssessment(db, { sources: [web] });
      expect(request(web, A, { trigger: "run", requestedByAssessmentId: assessment.id })).toEqual({ survey: first.survey, queued: false });
      expect(surveyOfKey(db, web.id, A, recipe)?.id).toBe(first.survey.id);

      // Another commit, or the same commit under another recipe, is another survey.
      const upgraded = currentRecipe(withOverrides(getConfig(), { analysis: { maxFiles: 7 } }));
      expect(request(web, B).survey).toMatchObject({ number: 2, commitSha: B });
      expect(request(web, A, upgraded).survey).toMatchObject({ number: 3, commitSha: A, configurationDigest: upgraded.configurationDigest });
      expect(db.select().from(surveys).all()).toHaveLength(3);
    });

    it("reuses a successful survey without running it again", async () => {
      const succeeded = await finish(request(web, A).survey);

      expect(request(web, A, { trigger: "manual" })).toEqual({ survey: succeeded, queued: false });
    });

    it("retries a failed survey under its key and number, rather than adding one", async () => {
      const { survey } = request(web, A);
      const firstJob = queueSurvey(db, survey);
      await finish(survey, "failed");

      const retried = request(web, A, { trigger: "manual" });
      // It keeps its reason and its latest failure until it succeeds.
      expect(retried).toMatchObject({ queued: true, survey: { id: survey.id, number: 1, trigger: "added", state: "queued", attempts: 1, failureCode: "analysis_failed", finishedAt: null } });
      // The retry is its next attempt, with a job of its own.
      expect(queueSurvey(db, retried.survey).id).not.toBe(firstJob.id);

      expect(await finish(retried.survey)).toMatchObject({ state: "succeeded", attempts: 2, failureCode: null, failureMessage: null });
      expect(db.select().from(surveys).all()).toHaveLength(1);
    });

    it("raises a queued survey's job to the priority of a Run that joins it", () => {
      const { survey } = request(web, A);
      const background = queueSurvey(db, survey, JOB_PRIORITIES.background);

      expect(queueSurvey(db, survey, JOB_PRIORITIES.normal)).toMatchObject({ id: background.id, priority: JOB_PRIORITIES.normal });
      // A later background request doesn't lower it again.
      expect(queueSurvey(db, survey, JOB_PRIORITIES.background)).toMatchObject({ id: background.id, priority: JOB_PRIORITIES.normal });
    });

    it("numbers each repository's surveys 1, 2, 3 in the order they're created", async () => {
      const orders = buildSource(db, { name: "orders" });
      await finish(request(web, A).survey, "failed");
      request(orders, A);
      request(web, B);
      // A retry keeps its number.
      request(web, A);

      expect([1, 2, 3].map((number) => findVersion(db, web.id, number)?.commit)).toEqual([A, B, undefined]);
      expect(findVersion(db, orders.id, 1)?.commit).toBe(A);
    });
  });

  describe("the current pointer", () => {
    it("moves to each successful survey of the configured reference resolved later than the current one", async () => {
      const first = await finish(request(web, A, { resolvedAt: at(0) }).survey);
      expect(currentSurveyId(web)).toBe(first.id);

      const second = await finish(request(web, B, { resolvedAt: at(1) }).survey);
      expect(currentSurveyId(web)).toBe(second.id);
    });

    it("never moves to a survey of a branch", async () => {
      await finish(request(web, A, { reference: "refs/heads/feature", fromConfiguredReference: false, trigger: "run" }).survey);
      expect(currentSurveyId(web)).toBeNull();

      const main = await finish(request(web, B, { resolvedAt: at(0) }).survey);
      await finish(request(web, sha1("commit:c"), { reference: "refs/heads/feature", fromConfiguredReference: false, resolvedAt: at(1) }).survey);
      expect(currentSurveyId(web)).toBe(main.id);
    });

    it("stays on a newer commit when a survey of an older one finishes after it", async () => {
      const older = request(web, A, { resolvedAt: at(0) }).survey;
      const newer = await finish(request(web, B, { resolvedAt: at(1) }).survey);
      await finish(older);

      expect(currentSurveyId(web)).toBe(newer.id);
    });

    it("stays on the older survey when a newer one fails, or hasn't finished", async () => {
      const older = await finish(request(web, A, { resolvedAt: at(0) }).survey);
      const failed = await finish(request(web, B, { resolvedAt: at(1) }).survey, "failed");
      const queued = request(web, sha1("commit:c"), { resolvedAt: at(2) }).survey;
      updateCurrentSurvey(db, failed);
      updateCurrentSurvey(db, queued);

      expect(currentSurveyId(web)).toBe(older.id);
    });

    it("can only name one of the repository's own successful surveys of its configured reference", async () => {
      const orders = buildSource(db, { name: "orders" });
      const queued = request(web, A).survey;
      const branch = await finish(request(web, B, { fromConfiguredReference: false }).survey);
      const others = (await finish(request(orders, A).survey)).id;
      const rejected = /the current survey is a successful survey of the commit the configured reference names/;

      for (const id of [queued.id, branch.id, others]) expect(() => rawRun(db, "update repository_sources set current_survey_id = ? where id = ?", id, web.id)).toThrow(rejected);
    });
  });

  describe("the database", () => {
    /** Inserts a survey of +commitSha+ of web numbered +number+, bypassing the records. */
    const insert = (commitSha: string, number: number) =>
      rawRun(
        db,
        `insert into surveys (public_id, repository_source_id, number, commit_sha, reference, from_configured_reference, resolved_at, surveyor_release, configuration_digest, profile_schema_version, trigger, created_at)
         values (?, ?, ?, ?, 'refs/heads/main', 1, 0, ?, ?, ?, 'manual', 0)`,
        `srv_${sha1(`${commitSha}:${number}`).slice(0, 16)}`,
        web.id,
        number,
        commitSha,
        recipe.surveyorRelease,
        recipe.configurationDigest,
        recipe.profileSchemaVersion,
      );

    it("rejects a second survey of a key, and a number other than the repository's next", () => {
      request(web, A);

      expect(() => insert(A, 2)).toThrow(/UNIQUE constraint failed: surveys\.repository_source_id, surveys\.commit_sha/);
      expect(() => insert(B, 3)).toThrow(/takes its Repository's next number/);
      expect(() => insert(B, 1)).toThrow(/takes its Repository's next number/);
      insert(B, 2);
      expect(findVersion(db, web.id, 2)?.commit).toBe(B);
    });

    it("allows only the survey state machine's transitions, and nothing after success", async () => {
      const queued = request(web, A).survey;
      const running = moveSurvey(db, request(web, B).survey, "running", { attempts: 1 });
      const failed = await finish(request(web, sha1("commit:c")).survey, "failed");
      const succeeded = await finish(request(web, sha1("commit:d")).survey);
      const move = (survey: Survey, state: string) => () => rawRun(db, "update surveys set state = ?, finished_at = 1, failure_code = 'analysis_failed' where id = ?", state, survey.id);

      expect(move(queued, "succeeded")).toThrow(/state transition is not allowed/);
      expect(move(running, "queued")).toThrow(/state transition is not allowed/);
      expect(move(failed, "running")).toThrow(/state transition is not allowed/);
      expect(move(failed, "succeeded")).toThrow(/state transition is not allowed/);
      expect(move(succeeded, "failed")).toThrow(/a terminal survey cannot change/);
      expect(() => rawRun(db, "update surveys set attempts = 5 where id = ?", succeeded.id)).toThrow(/a terminal survey cannot change/);
      // The records check the same machine before writing.
      expect(() => moveSurvey(db, queued, "succeeded", {})).toThrow(TransitionError);
      expect(() => moveSurvey(db, succeeded, "queued", {})).toThrow(TransitionError);
    });

    it("keeps a survey's identity, commit, recipe, and pin, and never deletes it", async () => {
      const failed = await finish(request(web, A).survey, "failed");
      const fixed = /keeps its Repository, number, commit, and recipe/;

      const changes = [
        ["commit_sha", B],
        ["number", 2],
        ["surveyor_release", "0.0.0"],
        ["configuration_digest", "f".repeat(64)],
        ["trigger", "manual"],
      ] as const;
      for (const [column, value] of changes) expect(() => rawRun(db, `update surveys set ${column} = ? where id = ?`, value, failed.id)).toThrow(fixed);
      expect(() => rawRun(db, "update surveys set internal_ref = ? where id = ?", surveyRefFor("srv_aaaaaaaaaaaaaaaa"), failed.id)).toThrow(/a pinned commit stays pinned/);
      expect(() => rawRun(db, "delete from surveys where id = ?", failed.id)).toThrow(/retained/);
    });

    it("writes a Profile only while its survey runs", async () => {
      const queued = request(web, A).survey;
      const { document } = await memoryProfile({ "package.json": manifest({ name: "web", version: "1.0.0" }) }, { public_id: web.publicId, name: "web" }, A);

      expect(() => insertProfile(db, { survey: queued, document })).toThrow(/a Profile is written by its running survey/);
      const succeeded = await finish(queued);
      expect(() => insertProfile(db, { survey: succeeded, document })).toThrow(/a Profile is written by its running survey/);
    });
  });
});
