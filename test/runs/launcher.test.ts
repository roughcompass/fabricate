import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { targetsOf } from "@/lib/runs/run-records";
import { COORDINATE_RUN, launchRun } from "@/lib/runs/launcher";
import { ScopeResolutionError } from "@/lib/runs/scope-resolver";
import type { Db } from "@/lib/db/client";
import { runTargets, runs, jobs } from "@/lib/db/schema";
import { detectorConfiguration } from "@repo-facts/bundle";
import { SURVEYOR_RELEASE } from "@/lib/surveys/surveyor-release";
import { parseCanonical, sha256 } from "@repo-facts/contract";
import { getConfig } from "@/lib/config";
import { selectedReleases } from "@/lib/assessments/assessment-records";
import { jobPayload } from "@/lib/jobs/queue";
import { drainJobs } from "@/lib/jobs/worker";
import { buildAssessment, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";

describe("assessment launch", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const counts = () => ({
    runs: db.select().from(runs).all().length,
    targets: db.select().from(runTargets).all().length,
    jobs: db.select().from(jobs).all().length,
  });

  it("commits the immutable scope and its coordinator job together", async () => {
    buildRepository(db, { name: "orders", gitRef: "main" });
    buildRepository(db, { name: "billing" });
    const assessment = buildAssessment(db);

    const { run, targets, duplicate } = launchRun(db, assessment.publicId, crypto.randomUUID());

    expect(duplicate).toBe(false);
    expect(targets.map((target) => [target.repositoryName, target.gitRef])).toEqual([
      ["billing", null],
      ["orders", "main"],
    ]);
    // The pinned bundle's version is the Surveyor release, and its configuration digest is the Assessment's.
    const bundle = detectorConfiguration(getConfig().analysis);
    expect(run).toMatchObject({ state: "queued", surveyorRelease: SURVEYOR_RELEASE, configurationDigest: bundle.digest });
    expect(sha256(run.configuration)).toBe(bundle.digest);
    expect(parseCanonical(run.configuration)).toEqual(bundle.configuration);
    expect(parseCanonical(run.configuration)).toMatchObject({ schema: "repo_facts.detector_configuration", release: SURVEYOR_RELEASE });

    const [job] = db.select().from(jobs).all();
    expect(job).toMatchObject({ kind: COORDINATE_RUN, state: "queued" });
    expect(jobPayload(job!)).toEqual({ assessment: run.publicId });

    // Draining with the inline test queue runs exactly the committed job.
    const ran: string[] = [];
    await drainJobs(db, { [COORDINATE_RUN]: (payload) => void ran.push(String(payload.assessment)) });
    expect(ran).toEqual([run.publicId]);
  });

  it("is valid without a selected Standard Release", () => {
    buildRepository(db);
    const assessment = buildAssessment(db);

    expect(selectedReleases(db, assessment.id)).toEqual([]);
    expect(launchRun(db, assessment.publicId, crypto.randomUUID()).run.state).toBe("queued");
  });

  it("creates nothing and enqueues nothing when the scope cannot be resolved", () => {
    // An Assessment of all Repositories, while there are none.
    const assessment = buildAssessment(db);

    let error: unknown;
    try {
      launchRun(db, assessment.publicId, crypto.randomUUID());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ScopeResolutionError);
    expect((error as ScopeResolutionError).problems.map((problem) => problem.message)).toEqual([expect.stringMatching(/The scope is empty/)]);
    expect(counts()).toEqual({ runs: 0, targets: 0, jobs: 0 });
  });

  it("returns the existing assessment when the same launch is submitted twice", () => {
    buildRepository(db);
    const assessment = buildAssessment(db);
    const token = crypto.randomUUID();

    const first = launchRun(db, assessment.publicId, token);
    const second = launchRun(db, assessment.publicId, token);

    expect(second).toMatchObject({ duplicate: true });
    expect(second.run.id).toBe(first.run.id);
    expect(counts()).toEqual({ runs: 1, targets: 1, jobs: 1 });
    expect(targetsOf(db, first.run.id)).toHaveLength(1);
  });

  it("starts a new assessment for a new launch token", () => {
    buildRepository(db);
    const assessment = buildAssessment(db);
    launchRun(db, assessment.publicId, crypto.randomUUID());
    launchRun(db, assessment.publicId, "not-a-token");

    expect(counts()).toEqual({ runs: 2, targets: 2, jobs: 2 });
  });
});
