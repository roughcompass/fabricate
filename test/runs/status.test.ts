import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { getRun } from "@/lib/runs/run-records";
import { runStatus, evaluationStatus } from "@/lib/runs/status";
import { requestCancellation, transitionTarget } from "@/lib/runs/transitions";
import { createEvaluation } from "@/lib/evaluations/evaluation-records";
import { transitionEvaluation } from "@/lib/evaluations/transitions";
import { buildRun, buildAssessment, buildRelease, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";

describe("progress status", () => {
  it("reports Assessment and target states with failure codes only, and changes version when any state moves", () => {
    const db = createTestDb();
    const secretUrl = "https://git.example.com/acme/private-orders.git";
    const { run, targets } = buildRun(db, { repositories: [buildRepository(db, { name: "orders", cloneUrl: secretUrl }), buildRepository(db, { name: "billing" })] });
    const before = runStatus(db, run);
    expect(before).toMatchObject({ terminal: false, run: { state: "queued", cancel_requested: false }, targets: [{ state: "pending", failure: null, profile: false }, { state: "pending" }] });

    const orders = targets.find((target) => target.repositoryName === "orders")!;
    transitionTarget(db, transitionTarget(db, orders, "acquiring"), "failed", { failureCode: "authentication_failed", failureMessage: `Could not read from ${secretUrl} with token t0ps3cret` });
    requestCancellation(db, run.id);
    const after = runStatus(db, getRun(db, run.publicId));

    expect(after.version).not.toBe(before.version);
    expect(after.run.cancel_requested).toBe(true);
    expect(after.targets.find((target) => target.name === "orders")).toMatchObject({ state: "failed", failure: "authentication_failed" });
    const text = JSON.stringify(after);
    expect(text).not.toContain("private-orders");
    expect(text).not.toContain("t0ps3cret");
  });

  it("reports an Evaluation and each pinned Release's state", () => {
    const db = createTestDb();
    const assessment = buildAssessment(db);
    const { run } = buildRun(db, { assessment, repositories: [buildRepository(db)] });
    const { evaluation } = createEvaluation(db, { assessment, run, launchToken: crypto.randomUUID(), evaluatorVersion: "1", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, coverageGaps: [], releases: [buildRelease(db), buildRelease(db)] });
    const queued = evaluationStatus(db, evaluation);
    expect(queued).toMatchObject({ terminal: false, evaluation: { state: "queued" }, releases: [{ position: 0, state: "pending" }, { position: 1, state: "pending" }] });

    const failed = transitionEvaluation(db, evaluation, "failed", { failureReason: "stopped" });
    expect(evaluationStatus(db, failed)).toMatchObject({ terminal: true, evaluation: { state: "failed" } });
    expect(evaluationStatus(db, failed).version).not.toBe(queued.version);
    // An Assessment with a running Evaluation is not terminal for polling.
    expect(runStatus(db, run).evaluations).toEqual([{ id: evaluation.publicId, state: "failed" }]);
  });
});
