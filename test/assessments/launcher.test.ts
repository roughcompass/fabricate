import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { configurationOf, targetsOf } from "@/lib/assessments/assessment-records";
import { COORDINATE_ASSESSMENT, launchAssessment } from "@/lib/assessments/launcher";
import { ScopeResolutionError } from "@/lib/assessments/scope-resolver";
import { setSourceEnabled } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { assessmentTargets, assessments, jobs } from "@/lib/db/schema";
import { DETECTOR_RELEASE } from "@/lib/detectors/bundle";
import { sha256 } from "@/lib/documents/canonical-json";
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
    expect(assessment).toMatchObject({ state: "queued", detectorRelease: DETECTOR_RELEASE, configurationDigest: sha256(assessment.configuration) });
    expect(configurationOf(assessment).release).toBe(DETECTOR_RELEASE);

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
    const [orders, billing] = [buildSource(db, { name: "orders" }), buildSource(db, { name: "billing" })];
    const initiative = buildInitiative(db, { sources: [orders, billing] });
    setSourceEnabled(db, orders.publicId, false);
    setSourceEnabled(db, billing.publicId, false);

    let error: unknown;
    try {
      launchAssessment(db, initiative.publicId, crypto.randomUUID());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ScopeResolutionError);
    expect((error as ScopeResolutionError).problems.map((problem) => problem.sourceName)).toEqual(["billing", "orders"]);
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
