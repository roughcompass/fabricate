import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { targetsOf } from "@/lib/assessments/assessment-records";
import { COORDINATE_ASSESSMENT, launchAssessment } from "@/lib/assessments/launcher";
import { ScopeResolutionError } from "@/lib/assessments/scope-resolver";
import type { Db } from "@/lib/db/client";
import { assessmentTargets, assessments, jobs } from "@/lib/db/schema";
import { DETECTOR_RELEASE, detectorConfiguration } from "@repo-facts/bundle";
import { parseCanonical, sha256 } from "@repo-facts/contract";
import { getConfig } from "@/lib/config";
import { selectedReleases } from "@/lib/initiatives/initiative-records";
import { jobPayload } from "@/lib/jobs/queue";
import { drainJobs } from "@/lib/jobs/worker";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";

describe("assessment launch", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const counts = () => ({
    assessments: db.select().from(assessments).all().length,
    targets: db.select().from(assessmentTargets).all().length,
    jobs: db.select().from(jobs).all().length,
  });

  it("commits the immutable scope and its coordinator job together", async () => {
    buildSource(db, { name: "orders", gitRef: "main" });
    buildSource(db, { name: "billing" });
    const initiative = buildInitiative(db);

    const { assessment, targets, duplicate } = launchAssessment(db, initiative.publicId, crypto.randomUUID());

    expect(duplicate).toBe(false);
    expect(targets.map((target) => [target.sourceName, target.gitRef])).toEqual([
      ["billing", null],
      ["orders", "main"],
    ]);
    // The pinned bundle's version is the detector release, and its configuration digest is the Assessment's.
    const bundle = detectorConfiguration(getConfig().analysis);
    expect(assessment).toMatchObject({ state: "queued", detectorRelease: DETECTOR_RELEASE, configurationDigest: bundle.digest });
    expect(sha256(assessment.configuration)).toBe(bundle.digest);
    expect(parseCanonical(assessment.configuration)).toEqual(bundle.configuration);
    expect(parseCanonical(assessment.configuration)).toMatchObject({ schema: "repo_facts.detector_configuration", release: DETECTOR_RELEASE });

    const [job] = db.select().from(jobs).all();
    expect(job).toMatchObject({ kind: COORDINATE_ASSESSMENT, state: "queued" });
    expect(jobPayload(job!)).toEqual({ assessment: assessment.publicId });

    // Draining with the inline test queue runs exactly the committed job.
    const ran: string[] = [];
    await drainJobs(db, { [COORDINATE_ASSESSMENT]: (payload) => void ran.push(String(payload.assessment)) });
    expect(ran).toEqual([assessment.publicId]);
  });

  it("is valid without a selected Standard Release", () => {
    buildSource(db);
    const initiative = buildInitiative(db);

    expect(selectedReleases(db, initiative.id)).toEqual([]);
    expect(launchAssessment(db, initiative.publicId, crypto.randomUUID()).assessment.state).toBe("queued");
  });

  it("creates nothing and enqueues nothing when the scope cannot be resolved", () => {
    // An Assessment of all Repositories, while the catalog has none.
    const initiative = buildInitiative(db);

    let error: unknown;
    try {
      launchAssessment(db, initiative.publicId, crypto.randomUUID());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ScopeResolutionError);
    expect((error as ScopeResolutionError).problems.map((problem) => problem.message)).toEqual([expect.stringMatching(/The scope is empty/)]);
    expect(counts()).toEqual({ assessments: 0, targets: 0, jobs: 0 });
  });

  it("returns the existing assessment when the same launch is submitted twice", () => {
    buildSource(db);
    const initiative = buildInitiative(db);
    const token = crypto.randomUUID();

    const first = launchAssessment(db, initiative.publicId, token);
    const second = launchAssessment(db, initiative.publicId, token);

    expect(second).toMatchObject({ duplicate: true });
    expect(second.assessment.id).toBe(first.assessment.id);
    expect(counts()).toEqual({ assessments: 1, targets: 1, jobs: 1 });
    expect(targetsOf(db, first.assessment.id)).toHaveLength(1);
  });

  it("starts a new assessment for a new launch token", () => {
    buildSource(db);
    const initiative = buildInitiative(db);
    launchAssessment(db, initiative.publicId, crypto.randomUUID());
    launchAssessment(db, initiative.publicId, "not-a-token");

    expect(counts()).toEqual({ assessments: 2, targets: 2, jobs: 2 });
  });
});
