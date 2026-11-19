import { parseCanonical } from "@repo-facts/contract";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { type Run, type RunTarget, createRun, findRunByLaunchToken, linkSurvey, targetsOf } from "@/lib/runs/run-records";
import { runById } from "@/lib/runs/lookups";
import { transitionTarget } from "@/lib/runs/transitions";
import { detectorConfiguration } from "@repo-facts/bundle";
import { dump, sha256 } from "@repo-facts/contract";
import { type Repository, getRepository, updateRepository } from "@/lib/repositories/repository-records";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { deleteAssessment } from "@/lib/assessments/assessment-records";
import { type Survey, requestSurvey } from "@/lib/surveys/records";
import { buildRun, buildAssessment, buildRepository } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";

const sha = (seed: string) => crypto.createHash("sha1").update(seed).digest("hex");

describe("assessment records", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("creates an assessment with target copies in scope order", () => {
    const first = buildRepository(db, { name: "orders", gitRef: "main" });
    const second = buildRepository(db, { name: "billing" });
    const { run, targets } = buildRun(db, { repositories: [first, second] });

    expect(isPublicId(run.publicId, "asm")).toBe(true);
    expect(run.state).toBe("queued");
    expect(targets.map((target) => [target.position, target.repositoryName, target.gitRef, target.state])).toEqual([
      [0, "orders", "main", "pending"],
      [1, "billing", null, "pending"],
    ]);
    expect(targets[0]).toMatchObject({ repositoryPublicId: first.publicId, cloneUrl: first.cloneUrl, canonicalUrl: first.canonicalUrl });
  });

  it("records the detector configuration canonically with its digest", () => {
    const { run } = buildRun(db, { repositories: [buildRepository(db)] });

    const bundle = detectorConfiguration(getConfig().analysis);
    expect(run.configuration).toBe(dump(bundle.configuration));
    expect(run.configurationDigest).toBe(sha256(run.configuration));
    expect(run.configurationDigest).toBe(bundle.digest);
    expect(parseCanonical(run.configuration)).toEqual(bundle.configuration);
  });

  it("keeps copied source configuration when the catalog changes afterward", () => {
    const repository = buildRepository(db, { name: "orders", gitRef: "main" });
    const { run } = buildRun(db, { repositories: [repository] });

    updateRepository(db, repository.publicId, 0, { name: "orders-ui", cloneUrl: "https://git.example.com/acme/orders-ui.git", canonicalUrl: "https://git.example.com/acme/orders-ui", gitRef: "release" });

    expect(targetsOf(db, run.id)[0]).toMatchObject({
      repositoryName: "orders",
      cloneUrl: "https://git.example.com/acme/orders.git",
      gitRef: "main",
    });

    const { targets } = buildRun(db, { repositories: [getRepository(db, repository.publicId)] });
    expect(targets[0]).toMatchObject({ repositoryName: "orders-ui", gitRef: "release" });
  });

  it("finds an assessment by its launch token and rejects a reused token", () => {
    const assessment = buildAssessment(db);
    const repository = buildRepository(db);
    const input = { assessment, launchToken: crypto.randomUUID(), surveyorRelease: "test", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, repositories: [repository] };
    const { run } = createRun(db, input);

    expect(findRunByLaunchToken(db, assessment.id, input.launchToken)?.id).toBe(run.id);
    expect(() => createRun(db, input)).toThrow(/UNIQUE constraint failed: assessments.launch_token/);
  });

  it("requires a scope, a Surveyor release, and a UUID launch token", () => {
    const error = (() => {
      try {
        createRun(db, { assessment: buildAssessment(db), launchToken: "again", surveyorRelease: " ", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, repositories: [] });
      } catch (caught) {
        return caught as ValidationError;
      }
    })();

    expect(error?.issues.map((issue) => issue.field).sort()).toEqual(["launchToken", "sources", "surveyorRelease"]);
  });

  it("retains an initiative that has assessments", () => {
    const assessment = buildAssessment(db);
    buildRun(db, { assessment, repositories: [buildRepository(db)] });

    expect(() => deleteAssessment(db, assessment.publicId)).toThrow(/retained/);
    const unassessed = buildAssessment(db);
    deleteAssessment(db, unassessed.publicId);
  });

  describe("survey links", () => {
    let repository: Repository;
    let target: RunTarget;
    let survey: Survey;
    beforeEach(() => {
      repository = buildRepository(db);
      const { run, targets } = buildRun(db, { repositories: [repository] });
      target = transitionTarget(db, targets[0]!, "acquiring");
      survey = surveyOf(repository, sha("commit"), run);
    });

    /** A survey of +commitSha+ of +repository+, as a Run under +assessment+'s recipe requests it. */
    const surveyOf = (repository: Repository, commitSha: string, run: Run) =>
      requestSurvey(db, {
        repositoryId: repository.id,
        commitSha,
        reference: "refs/heads/main",
        fromConfiguredReference: true,
        trigger: "run",
        requestedByRunId: run.id,
        surveyorRelease: run.surveyorRelease,
        configurationDigest: run.configurationDigest,
        profileSchemaVersion: run.profileSchemaVersion,
      }).survey;
    const resolution = { refKind: "branch" as const, resolvedRef: "refs/heads/main" };

    it("records how the target resolved and the survey it waits on, and moves it to analyzing", () => {
      const linked = linkSurvey(db, target, { ...resolution, surveyId: survey.id });

      expect(linked).toMatchObject({ state: "analyzing", refKind: "branch", resolvedRef: "refs/heads/main", resolvedAt: expect.any(Date), surveyId: survey.id });
      expect(targetsOf(db, target.runId)[0]).toEqual(linked);
    });

    it("keeps the resolution and the survey once linked", () => {
      linkSurvey(db, target, { ...resolution, surveyId: survey.id });
      const other = surveyOf(repository, sha("other"), runById(db, target.runId));

      for (const assignment of ["ref_kind = 'tag'", "resolved_ref = 'refs/heads/other'", "resolved_at = 0", `survey_id = ${other.id}`, "survey_id = NULL"]) {
        expect(() => rawRun(db, `update assessment_targets set ${assignment} where id = ?`, target.id)).toThrow(/resolves its reference and links its survey once/);
      }
    });

    it("links only a survey of the target's own Repository", () => {
      const elsewhere = surveyOf(buildRepository(db), sha("commit"), runById(db, target.runId));

      expect(() => linkSurvey(db, target, { ...resolution, surveyId: elsewhere.id })).toThrow(/a target links a survey of its own Repository/);
      expect(() => rawRun(db, "update assessment_targets set ref_kind = 'branch', resolved_ref = 'refs/heads/main', resolved_at = 0, survey_id = ? where id = ?", elsewhere.id, target.id)).toThrow(
        /a target links a survey of its own Repository/,
      );
      expect(targetsOf(db, target.runId)[0]).toMatchObject({ state: "acquiring", refKind: null, surveyId: null });
    });

    it("needs a resolution to link a survey, and a survey to complete", () => {
      expect(() => rawRun(db, "update assessment_targets set survey_id = ? where id = ?", survey.id, target.id)).toThrow(/CHECK constraint failed/);
      expect(() => rawRun(db, "update assessment_targets set ref_kind = 'branch' where id = ?", target.id)).toThrow(/CHECK constraint failed/);

      rawRun(db, "update assessment_targets set state = 'analyzing' where id = ?", target.id);
      expect(() => rawRun(db, "update assessment_targets set state = 'complete' where id = ?", target.id)).toThrow(/CHECK constraint failed/);
    });
  });

  describe("database rules", () => {
    it("rejects changes to copied scope configuration", () => {
      const { targets } = buildRun(db, { repositories: [buildRepository(db)] });

      for (const assignment of ["source_name = 'renamed'", "clone_url = 'https://evil.example.com/x'", "git_ref = 'other'", "position = 7", "canonical_url = 'x'"]) {
        expect(() => rawRun(db, `update assessment_targets set ${assignment} where id = ?`, targets[0]!.id)).toThrow(/scope snapshot cannot change/);
      }
    });

    it("rejects targets added after the assessment was created", () => {
      const { run } = buildRun(db, { repositories: [buildRepository(db)] });
      const repository = buildRepository(db);

      expect(() =>
        rawRun(
          db,
          "insert into assessment_targets (public_id, assessment_id, repository_source_id, position, source_public_id, source_name, clone_url, canonical_url, created_at, updated_at) values ('tgt_aaaaaaaaaaaaaaaa', ?, ?, 1, ?, 'late', 'u', 'u', ?, ?)",
          run.id,
          repository.id,
          repository.publicId,
          run.createdAt.getTime() + 1,
          run.createdAt.getTime() + 1,
        ),
      ).toThrow(/scope is frozen/);
    });

    it("rejects changes to recorded assessment inputs and deletion", () => {
      const { run } = buildRun(db, { repositories: [buildRepository(db)] });

      expect(() => rawRun(db, "update assessments set detector_release = 'other' where id = ?", run.id)).toThrow(/recorded inputs/);
      expect(() => rawRun(db, "update assessments set configuration = '{}' where id = ?", run.id)).toThrow(/recorded inputs/);
      expect(() => rawRun(db, "delete from assessments where id = ?", run.id)).toThrow(/retained/);
    });

    it("requires a failure code exactly for failed targets and a supported state", () => {
      const { targets } = buildRun(db, { repositories: [buildRepository(db)] });
      const id = targets[0]!.id;

      expect(() => rawRun(db, "update assessment_targets set failure_code = 'timeout' where id = ?", id)).toThrow(/CHECK constraint failed/);
      expect(() => rawRun(db, "update assessment_targets set state = 'failed' where id = ?", id)).toThrow(/CHECK constraint failed/);
      // The transition trigger rejects an unknown state before the CHECK constraint runs.
      expect(() => rawRun(db, "update assessment_targets set state = 'exploded' where id = ?", id)).toThrow(/state transition is not allowed/);
    });
  });
});
