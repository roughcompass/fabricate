import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAssessment } from "@/lib/assessments/assessment-records";
import { assessmentStatus, evaluationStatus } from "@/lib/assessments/status";
import { requestCancellation, transitionTarget } from "@/lib/assessments/transitions";
import { createEvaluation } from "@/lib/evaluations/evaluation-records";
import { transitionEvaluation } from "@/lib/evaluations/transitions";
import { buildAssessment, buildInitiative, buildRelease, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";

describe("progress status", () => {
  it("reports Assessment and target states with failure codes only, and changes version when any state moves", () => {
    const db = createTestDb();
    const secretUrl = "https://git.example.com/acme/private-orders.git";
    const { assessment, targets } = buildAssessment(db, { sources: [buildSource(db, { name: "orders", cloneUrl: secretUrl }), buildSource(db, { name: "billing" })] });
    const before = assessmentStatus(db, assessment);
    expect(before).toMatchObject({ terminal: false, assessment: { state: "queued", cancel_requested: false }, targets: [{ state: "pending", failure: null, profile: false }, { state: "pending" }] });

    const orders = targets.find((target) => target.sourceName === "orders")!;
    transitionTarget(db, transitionTarget(db, orders, "acquiring"), "failed", { failureCode: "authentication_failed", failureMessage: `Could not read from ${secretUrl} with token t0ps3cret` });
    requestCancellation(db, assessment.id);
    const after = assessmentStatus(db, getAssessment(db, assessment.publicId));

    expect(after.version).not.toBe(before.version);
    expect(after.assessment.cancel_requested).toBe(true);
    expect(after.targets.find((target) => target.name === "orders")).toMatchObject({ state: "failed", failure: "authentication_failed" });
    const text = JSON.stringify(after);
    expect(text).not.toContain("private-orders");
    expect(text).not.toContain("t0ps3cret");
  });

  it("reports an Evaluation and each pinned Release's state", () => {
    const db = createTestDb();
    const initiative = buildInitiative(db);
    const { assessment } = buildAssessment(db, { initiative, sources: [buildSource(db)] });
    const { evaluation } = createEvaluation(db, { initiative, assessment, launchToken: crypto.randomUUID(), evaluatorVersion: "1", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, coverageGaps: [], releases: [buildRelease(db), buildRelease(db)] });
    const queued = evaluationStatus(db, evaluation);
    expect(queued).toMatchObject({ terminal: false, evaluation: { state: "queued" }, releases: [{ position: 0, state: "pending" }, { position: 1, state: "pending" }] });

    const failed = transitionEvaluation(db, evaluation, "failed", { failureReason: "stopped" });
    expect(evaluationStatus(db, failed)).toMatchObject({ terminal: true, evaluation: { state: "failed" } });
    expect(evaluationStatus(db, failed).version).not.toBe(queued.version);
    // An Assessment with a running Evaluation is not terminal for polling.
    expect(assessmentStatus(db, assessment).evaluations).toEqual([{ id: evaluation.publicId, state: "failed" }]);
  });
});
