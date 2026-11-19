import child_process from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns";
import { type JsonObject, parseCanonical } from "@repo-facts/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRun } from "@/lib/runs/run-records";
import { transitionRun, transitionTarget } from "@/lib/runs/transitions";
import type { Db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { evaluationReleasesOf, findingDocument, findingsOf, getEvaluation } from "@/lib/evaluations/evaluation-records";
import { finalizeEvaluation, runEvaluationRelease } from "@/lib/evaluations/jobs";
import { EVALUATE_RELEASE, EvaluationStartError, startEvaluation } from "@/lib/evaluations/start";
import { GitRunner } from "@/lib/git/runner";
import { type Assessment, updateAssessment } from "@/lib/assessments/assessment-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { type StandardRelease, createStandard, insertRelease } from "@/lib/standards/standard-records";
import { buildAssessment, buildSource } from "../support/builders";
import { createTestDb, withSharedFileDb } from "../support/db";
import { manifest } from "../support/profiles";
import { publishStandard, seedRun } from "../support/scenarios";
import { control, standardDocument } from "../support/standards";

const NPM = { "package.json": manifest({ name: "npm-app", version: "1.0.0" }), "package-lock.json": '{ "lockfileVersion": 3, "packages": { "": { "name": "npm-app" } } }\n' };
const PNPM = { "package.json": manifest({ name: "pnpm-app", version: "1.0.0", packageManager: "pnpm@9.1.0" }) };

const manager = (name: string) => ({ op: "contains", selector: "repository.package_managers", mode: "all", values: [name] });

describe("Evaluation pipeline", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  function select(assessment: Assessment, releases: StandardRelease[]): Assessment {
    return updateAssessment(db, assessment.publicId, assessment.lockVersion, { name: assessment.name, objective: assessment.objective, selectionMode: "all", standardReleasePublicIds: releases.map((release) => release.publicId) });
  }

  async function scenario() {
    const npm = buildSource(db, { name: "npm-app" });
    const pnpm = buildSource(db, { name: "pnpm-app" });
    const assessment = buildAssessment(db);
    const run = await seedRun(db, assessment, [npm, pnpm], [NPM, PNPM]);
    return { assessment, run };
  }

  const summaryOf = (publicId: string) => parseCanonical(getEvaluation(db, publicId).summary!) as JsonObject;

  describe("starting", () => {
    it("pins the selected Releases by digest, records coverage gaps, and enqueues one job per Release in one transaction", async () => {
      const failing = buildSource(db, { name: "billing" });
      const { assessment } = await scenario();
      const partial = await seedRun(db, assessment, [buildSource(db, { name: "orders" }), failing], [NPM, "failed"]);
      const [a, b] = [publishStandard(db, "Tooling A", [control({ key: "uses-pnpm", condition: manager("pnpm") })]), publishStandard(db, "Tooling B", [control({ key: "uses-npm", condition: manager("npm") })])];
      const updated = select(assessment, [a!, b!]);

      const token = crypto.randomUUID();
      const { evaluation, releases, duplicate } = startEvaluation(db, updated.publicId, partial.publicId, token);
      expect(duplicate).toBe(false);
      // The Releases read Profile v1; the Assessment's v2 Profiles extend it.
      expect(evaluation).toMatchObject({ state: "queued", evaluatorVersion: "1", profileSchemaVersion: 2, relationshipSchemaVersion: 1 });
      expect(releases.map((release) => release.releaseDigest)).toEqual([a!.digest, b!.digest]);
      expect(parseCanonical(evaluation.coverageGaps)).toEqual([{ target: expect.any(String), source: { public_id: failing.publicId, name: "billing" }, state: "failed", reason: "source_unavailable" }]);
      expect(db.select().from(jobs).all().filter((job) => job.kind === EVALUATE_RELEASE).map((job) => job.idempotencyKey)).toEqual([`${EVALUATE_RELEASE}:${evaluation.publicId}:0`, `${EVALUATE_RELEASE}:${evaluation.publicId}:1`]);

      // Repeating the submission returns the same Evaluation and enqueues nothing new.
      expect(startEvaluation(db, updated.publicId, partial.publicId, token)).toMatchObject({ duplicate: true, evaluation: { id: evaluation.id } });
      expect(db.select().from(jobs).all().filter((job) => job.kind === EVALUATE_RELEASE)).toHaveLength(2);
    });

    it("refuses unfinished Assessments, Assessments without Profiles, missing selections, and incompatible Releases, creating nothing", async () => {
      const { assessment, run } = await scenario();
      const expectRefusal = (assessmentId: string, runId: string, problem: RegExp) => {
        const error = (() => {
          try {
            startEvaluation(db, assessmentId, runId, crypto.randomUUID());
          } catch (caught) {
            return caught;
          }
          return null;
        })();
        expect(error).toBeInstanceOf(EvaluationStartError);
        expect((error as EvaluationStartError).problems.join(" ")).toMatch(problem);
      };

      expectRefusal(assessment.publicId, run.publicId, /Select at least one published Standard Release/);
      const selected = select(assessment, [publishStandard(db, "Tooling", [control({ key: "uses-pnpm", condition: manager("pnpm") })])]);
      const failedOnly = await (async () => {
        const source = buildSource(db, { name: "down" });
        const { run, targets } = createRun(db, { assessment: selected, launchToken: crypto.randomUUID(), surveyorRelease: "0.1.0", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, sources: [source] });
        transitionTarget(db, transitionTarget(db, targets[0]!, "acquiring"), "failed", { failureCode: "source_unavailable", failureMessage: "x" });
        return transitionRun(db, transitionRun(db, run, "finalizing"), "failed");
      })();
      expectRefusal(selected.publicId, failedOnly.publicId, /is failed.*no Repository Profile/);

      // A Release that reads only Profile v2 cannot evaluate an Assessment from Surveyor release 0.1.0, with Profile v1.
      const v2Only = select(selected, [publishStandard(db, "Design system", [control({ key: "uses-pnpm", condition: manager("pnpm") })], { profileVersions: [2] })]);
      const v1 = createRun(db, { assessment: v2Only, launchToken: crypto.randomUUID(), surveyorRelease: "0.1.0", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, sources: [buildSource(db, { name: "earlier" })] }).run;
      expectRefusal(v2Only.publicId, v1.publicId, /supports Repository Profile v2, but the Assessment has v1/);
      expect(db.select().from(jobs).all().filter((job) => job.kind === EVALUATE_RELEASE)).toEqual([]);
    });
  });

  describe("jobs and finalization", () => {
    it("evaluate each Release independently, keeping contradictory expectations as separate Findings, and finalize once", async () => {
      const { assessment, run } = await scenario();
      const pnpmRelease = publishStandard(db, "Prefers pnpm", [control({ key: "package-manager", condition: manager("pnpm") })]);
      const npmRelease = publishStandard(db, "Prefers npm", [control({ key: "package-manager", condition: manager("npm") })]);
      const selected = select(assessment, [pnpmRelease, npmRelease]);
      const { evaluation } = startEvaluation(db, selected.publicId, run.publicId, crypto.randomUUID());

      await drainJobs(db, jobHandlers(db));
      const done = getEvaluation(db, evaluation.publicId);
      expect(done).toMatchObject({ state: "complete", resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });

      const pinned = evaluationReleasesOf(db, evaluation.id);
      const outcomes = (release: StandardRelease) =>
        Object.fromEntries(findingsOf(db, evaluation.id, { evaluationReleaseIds: [pinned.find((item) => item.releaseDigest === release.digest)!.id] }).map((finding) => [String((findingDocument(finding).subject as JsonObject).name), finding.outcome]));
      // The same Control key in two Releases stays two independent Findings per repository.
      expect(outcomes(pnpmRelease)).toEqual({ "npm-app": "gap", "pnpm-app": "meets" });
      expect(outcomes(npmRelease)).toEqual({ "npm-app": "meets", "pnpm-app": "gap" });

      // Releases are pinned in the Initiative's order, by Standard name.
      const summary = summaryOf(evaluation.publicId);
      expect((summary.releases as JsonObject[]).map((release) => [release.standard, release.conclusion, (release.counts as JsonObject).gap])).toEqual([
        ["Prefers npm", "gaps", 1],
        ["Prefers pnpm", "gaps", 1],
      ]);
      expect(summary.combined).toMatchObject({ counts: { meets: 2, gap: 2, indeterminate: 0, not_applicable: 0 }, conclusion: "gaps" });
    });

    it("write one result when a job runs again or two connections run it at once, and finalize deterministically", async () => {
      await withSharedFileDb(async (shared, other) => {
        // The suite's helpers read its database.
        db = shared;
        const { assessment, run } = await scenario();
        const selected = select(assessment, [publishStandard(db, "Tooling", [control({ key: "uses-pnpm", condition: manager("pnpm") })])]);
        const { evaluation } = startEvaluation(db, selected.publicId, run.publicId, crypto.randomUUID());

        await Promise.all([runEvaluationRelease(db, { evaluation: evaluation.publicId, position: 0 }), runEvaluationRelease(other, { evaluation: evaluation.publicId, position: 0 })]);
        await runEvaluationRelease(db, { evaluation: evaluation.publicId, position: 0 });
        // The last Release hands the Evaluation to its finalizer.
        expect(getEvaluation(db, evaluation.publicId).state).toBe("finalizing");
        const first = finalizeEvaluation(db, evaluation.publicId);
        const again = finalizeEvaluation(other, evaluation.publicId);

        expect(findingsOf(db, evaluation.id)).toHaveLength(2);
        expect(first).toMatchObject({ state: "complete", resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });
        expect(again).toMatchObject({ state: "complete", resultDigest: first.resultDigest, summary: first.summary });
      });
    });

    it("fail a Release whose Controls exceed the evaluation limits, and fail the Evaluation with the reason", async () => {
      const { assessment, run } = await scenario();
      let deep: JsonObject = { op: "always" };
      for (let level = 0; level < 9; level++) deep = { op: "not", item: deep };
      // Written directly, as validation would never publish it.
      const { standard } = createStandard(db, { name: "Too deep", purpose: "Limits" });
      const release = insertRelease(db, { standard, document: standardDocument([control({ key: "deep", condition: deep })]), draftLockVersion: 0 });
      const selected = select(assessment, [release]);
      const { evaluation } = startEvaluation(db, selected.publicId, run.publicId, crypto.randomUUID());

      await drainJobs(db, jobHandlers(db));
      expect(getEvaluation(db, evaluation.publicId)).toMatchObject({ state: "failed", failureReason: expect.stringContaining("nest at most 8 levels") });
      expect(findingsOf(db, evaluation.id)).toEqual([]);
    });
  });

  describe("reuse and summaries", () => {
    let traps: ReturnType<typeof vi.spyOn>[] = [];
    afterEach(() => {
      for (const trap of traps) trap.mockRestore();
      traps = [];
    });

    it("reuse one Assessment after only the Release selection changes, without Git, processes, DNS, or the network", async () => {
      const { assessment, run } = await scenario();
      const first = startEvaluation(db, select(assessment, [publishStandard(db, "Tooling A", [control({ key: "uses-pnpm", condition: manager("pnpm") })])]).publicId, run.publicId, crypto.randomUUID()).evaluation;
      await drainJobs(db, jobHandlers(db));

      traps = [
        vi.spyOn(GitRunner.prototype as unknown as { run: () => never }, "run"),
        vi.spyOn(child_process, "spawn"),
        vi.spyOn(dns, "lookup"),
        vi.spyOn(globalThis, "fetch"),
      ];
      const current = (await import("@/lib/assessments/assessment-records")).getAssessment(db, assessment.publicId);
      const second = startEvaluation(db, select(current, [publishStandard(db, "Tooling B", [control({ key: "uses-npm", condition: manager("npm") })])]).publicId, run.publicId, crypto.randomUUID()).evaluation;
      await drainJobs(db, jobHandlers(db));

      for (const trap of traps) expect(trap).not.toHaveBeenCalled();
      expect(getEvaluation(db, second.publicId)).toMatchObject({ state: "complete", runId: run.id });
      // The first Evaluation keeps its own Releases and Findings.
      expect((summaryOf(first.publicId).releases as JsonObject[]).map((release) => release.standard)).toEqual(["Tooling A"]);
      expect((summaryOf(second.publicId).releases as JsonObject[]).map((release) => release.standard)).toEqual(["Tooling B"]);
    });

    it("never fold Indeterminate or Not applicable into Gap, and never conclude conformance under uncertainty", async () => {
      const assessment = buildAssessment(db);
      const partial = await seedRun(db, assessment, [buildSource(db, { name: "pnpm-app" }), buildSource(db, { name: "billing" })], [PNPM, "failed"]);
      const selected = select(assessment, [publishStandard(db, "Tooling", [control({ key: "uses-pnpm", condition: manager("pnpm") }), control({ key: "typescript-only", applicability: { op: "contains", selector: "repository.languages", mode: "any", values: ["TypeScript"] }, condition: { op: "always" } })])]);
      const { evaluation } = startEvaluation(db, selected.publicId, partial.publicId, crypto.randomUUID());
      await drainJobs(db, jobHandlers(db));

      const summary = summaryOf(evaluation.publicId);
      expect(summary.combined).toEqual({ counts: { gap: 0, indeterminate: 2, meets: 1, not_applicable: 1 }, severities: expect.any(Object), conclusion: "undetermined" });
      expect(summary.coverage_gaps).toBe(1);
      expect((summary.subjects as JsonObject[]).map((subject) => [subject.name, subject.conclusion])).toEqual([
        ["billing", "undetermined"],
        ["pnpm-app", "conforms"],
      ]);
    });

    it("produce identical normalized results for identical inputs", async () => {
      const { assessment, run } = await scenario();
      const selected = select(assessment, [publishStandard(db, "Tooling", [control({ key: "uses-pnpm", condition: manager("pnpm") })])]);
      const runs = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const { evaluation } = startEvaluation(db, selected.publicId, run.publicId, crypto.randomUUID());
        await drainJobs(db, jobHandlers(db));
        runs.push(getEvaluation(db, evaluation.publicId));
      }
      expect(runs[1]!.resultDigest).toBe(runs[0]!.resultDigest);
      expect(runs[1]!.summary).toBe(runs[0]!.summary);
      expect(findingsOf(db, runs[1]!.id).map((finding) => finding.digest)).toEqual(findingsOf(db, runs[0]!.id).map((finding) => finding.digest));
    });
  });
});
