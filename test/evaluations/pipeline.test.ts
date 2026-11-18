import child_process from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type JsonObject, type MemoryFile, parseCanonical } from "@repo-facts/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Assessment, createAssessment, recordSnapshot } from "@/lib/assessments/assessment-records";
import { transitionAssessment, transitionTarget } from "@/lib/assessments/transitions";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type Db, migrateDatabase, openDatabase } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { evaluationReleasesOf, findingDocument, findingsOf, getEvaluation } from "@/lib/evaluations/evaluation-records";
import { finalizeEvaluation, runEvaluationRelease } from "@/lib/evaluations/jobs";
import { EVALUATE_RELEASE, EvaluationStartError, startEvaluation } from "@/lib/evaluations/start";
import { GitRunner } from "@/lib/git/runner";
import { type Initiative, updateInitiative } from "@/lib/initiatives/initiative-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { insertProfile } from "@/lib/profiles/profile-records";
import { profileProblems } from "@/lib/profiles/schema";
import { finalizeRelationshipMap } from "@/lib/relationships/finalize";
import { publishDraft } from "@/lib/standards/publish";
import { type StandardRelease, createStandard, insertRelease, saveDraft } from "@/lib/standards/standard-records";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { manifest, memoryProfile, sha1 } from "../support/profiles";

const NPM = { "package.json": manifest({ name: "npm-app", version: "1.0.0" }), "package-lock.json": '{ "lockfileVersion": 3, "packages": { "": { "name": "npm-app" } } }\n' };
const PNPM = { "package.json": manifest({ name: "pnpm-app", version: "1.0.0", packageManager: "pnpm@9.1.0" }) };

const control = (key: string, condition: JsonObject, severity = "high"): JsonObject => ({ key, title: key, rationale: "Consistent tooling", severity, subject: "repository", applicability: { op: "always" }, condition, guidance: null });
const manager = (name: string) => ({ op: "contains", selector: "repository.package_managers", mode: "all", values: [name] });

describe("Evaluation pipeline", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  /** Publishes a Standard with +controls+ and returns its Release. */
  function publish(name: string, ...controls: JsonObject[]): StandardRelease {
    return publishFor([1], name, ...controls);
  }

  /** Publishes a Standard that declares +profileVersions+ of the Repository Profile. */
  function publishFor(profileVersions: number[], name: string, ...controls: JsonObject[]): StandardRelease {
    const { standard, draft } = createStandard(db, { name, purpose: `${name} expectations` });
    const saved = saveDraft(db, draft, draft.lockVersion, { schema: "fabricate.standard", schema_version: 1, input_schemas: { repository_profile: profileVersions, relationship_map: [1] }, controls });
    return publishDraft(db, standard.publicId, saved.lockVersion);
  }

  function select(initiative: Initiative, releases: StandardRelease[]): Initiative {
    return updateInitiative(db, initiative.publicId, initiative.lockVersion, { name: initiative.name, objective: initiative.objective, selectionMode: "all", standardReleasePublicIds: releases.map((release) => release.publicId) });
  }

  /** A finished Assessment whose targets end as +outcomes+: a file tree, or a failure. */
  async function assessed(initiative: Initiative, sources: RepositorySource[], outcomes: (Readonly<Record<string, MemoryFile>> | "failed")[]): Promise<Assessment> {
    const { assessment, targets } = createAssessment(db, {
      initiative,
      launchToken: crypto.randomUUID(),
      detectorRelease: (await import("@repo-facts/bundle")).DETECTOR_RELEASE,
      configuration: (await import("@repo-facts/bundle")).detectorConfiguration((await import("@/lib/config")).getConfig().analysis).configuration,
      profileSchemaVersion: 2,
      relationshipSchemaVersion: 1,
      sources,
    });
    for (const [index, outcome] of outcomes.entries()) {
      const target = targets.find((item) => item.sourcePublicId === sources[index]!.publicId)!;
      const acquiring = transitionTarget(db, target, "acquiring");
      if (outcome === "failed") {
        transitionTarget(db, acquiring, "failed", { failureCode: "remote_unavailable", failureMessage: "unreachable" });
        continue;
      }
      const snapshot = recordSnapshot(db, acquiring, { commitSha: sha1(`commit:${target.publicId}`), treeSha: sha1(`tree:${target.publicId}`), refKind: "default_branch", resolvedRef: "refs/heads/main", acquisitionMetadata: {} });
      const analyzing = transitionTarget(db, acquiring, "analyzing");
      const { document } = await memoryProfile(outcome, { public_id: target.sourcePublicId, name: target.sourceName }, snapshot.commitSha);
      insertProfile(db, { assessment, target: analyzing, snapshot, document, validate: profileProblems });
      transitionTarget(db, analyzing, "complete");
    }
    const finalizing = transitionAssessment(db, assessment, "finalizing");
    finalizeRelationshipMap(db, finalizing);
    return transitionAssessment(db, finalizing, outcomes.includes("failed") ? "complete_with_issues" : "complete");
  }

  async function scenario() {
    const npm = buildSource(db, { name: "npm-app" });
    const pnpm = buildSource(db, { name: "pnpm-app" });
    const initiative = buildInitiative(db);
    const assessment = await assessed(initiative, [npm, pnpm], [NPM, PNPM]);
    return { initiative, assessment };
  }

  const summaryOf = (publicId: string) => parseCanonical(getEvaluation(db, publicId).summary!) as JsonObject;

  describe("starting", () => {
    it("pins the selected Releases by digest, records coverage gaps, and enqueues one job per Release in one transaction", async () => {
      const failing = buildSource(db, { name: "billing" });
      const { initiative } = await scenario();
      const partial = await assessed(initiative, [buildSource(db, { name: "orders" }), failing], [NPM, "failed"]);
      const [a, b] = [publish("Tooling A", control("uses-pnpm", manager("pnpm"))), publish("Tooling B", control("uses-npm", manager("npm")))];
      const updated = select(initiative, [a!, b!]);

      const token = crypto.randomUUID();
      const { evaluation, releases, duplicate } = startEvaluation(db, updated.publicId, partial.publicId, token);
      expect(duplicate).toBe(false);
      // The Releases read Profile v1; the Assessment's v2 Profiles extend it.
      expect(evaluation).toMatchObject({ state: "queued", evaluatorVersion: "1", profileSchemaVersion: 2, relationshipSchemaVersion: 1 });
      expect(releases.map((release) => release.releaseDigest)).toEqual([a!.digest, b!.digest]);
      expect(parseCanonical(evaluation.coverageGaps)).toEqual([{ target: expect.any(String), source: { public_id: failing.publicId, name: "billing" }, state: "failed", reason: "remote_unavailable" }]);
      expect(db.select().from(jobs).all().filter((job) => job.kind === EVALUATE_RELEASE).map((job) => job.idempotencyKey)).toEqual([`${EVALUATE_RELEASE}:${evaluation.publicId}:0`, `${EVALUATE_RELEASE}:${evaluation.publicId}:1`]);

      // Repeating the submission returns the same Evaluation and enqueues nothing new.
      expect(startEvaluation(db, updated.publicId, partial.publicId, token)).toMatchObject({ duplicate: true, evaluation: { id: evaluation.id } });
      expect(db.select().from(jobs).all()).toHaveLength(2);
    });

    it("refuses unfinished Assessments, Assessments without Profiles, missing selections, and incompatible Releases, creating nothing", async () => {
      const { initiative, assessment } = await scenario();
      const expectRefusal = (initiativeId: string, assessmentId: string, problem: RegExp) => {
        const error = (() => {
          try {
            startEvaluation(db, initiativeId, assessmentId, crypto.randomUUID());
          } catch (caught) {
            return caught;
          }
          return null;
        })();
        expect(error).toBeInstanceOf(EvaluationStartError);
        expect((error as EvaluationStartError).problems.join(" ")).toMatch(problem);
      };

      expectRefusal(initiative.publicId, assessment.publicId, /Select at least one published Standard Release/);
      const selected = select(initiative, [publish("Tooling", control("uses-pnpm", manager("pnpm")))]);
      const failedOnly = await (async () => {
        const source = buildSource(db, { name: "down" });
        const { assessment: run, targets } = createAssessment(db, { initiative: selected, launchToken: crypto.randomUUID(), detectorRelease: "0.1.0", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, sources: [source] });
        transitionTarget(db, transitionTarget(db, targets[0]!, "acquiring"), "failed", { failureCode: "remote_unavailable", failureMessage: "x" });
        return transitionAssessment(db, transitionAssessment(db, run, "finalizing"), "failed");
      })();
      expectRefusal(selected.publicId, failedOnly.publicId, /is failed.*no Repository Profile/);

      // A Release that reads only Profile v2 cannot evaluate an Assessment from detector release 0.1.0, with Profile v1.
      const v2Only = select(selected, [publishFor([2], "Design system", control("uses-pnpm", manager("pnpm")))]);
      const v1 = createAssessment(db, { initiative: v2Only, launchToken: crypto.randomUUID(), detectorRelease: "0.1.0", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, sources: [buildSource(db, { name: "earlier" })] }).assessment;
      expectRefusal(v2Only.publicId, v1.publicId, /supports Repository Profile v2, but the Assessment has v1/);
      expect(db.select().from(jobs).all().filter((job) => job.kind === EVALUATE_RELEASE)).toEqual([]);
    });
  });

  describe("jobs and finalization", () => {
    it("evaluate each Release independently, keeping contradictory expectations as separate Findings, and finalize once", async () => {
      const { initiative, assessment } = await scenario();
      const pnpmRelease = publish("Prefers pnpm", control("package-manager", manager("pnpm")));
      const npmRelease = publish("Prefers npm", control("package-manager", manager("npm")));
      const selected = select(initiative, [pnpmRelease, npmRelease]);
      const { evaluation } = startEvaluation(db, selected.publicId, assessment.publicId, crypto.randomUUID());

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
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-race-"));
      const file = path.join(directory, "fabricate.sqlite3");
      db = openDatabase(file);
      migrateDatabase(db);
      const other = openDatabase(file);
      try {
        const { initiative, assessment } = await scenario();
        const selected = select(initiative, [publish("Tooling", control("uses-pnpm", manager("pnpm")))]);
        const { evaluation } = startEvaluation(db, selected.publicId, assessment.publicId, crypto.randomUUID());

        await Promise.all([runEvaluationRelease(db, { evaluation: evaluation.publicId, position: 0 }), runEvaluationRelease(other, { evaluation: evaluation.publicId, position: 0 })]);
        await runEvaluationRelease(db, { evaluation: evaluation.publicId, position: 0 });
        // The last Release hands the Evaluation to its finalizer.
        expect(getEvaluation(db, evaluation.publicId).state).toBe("finalizing");
        const first = finalizeEvaluation(db, evaluation.publicId);
        const again = finalizeEvaluation(other, evaluation.publicId);

        expect(findingsOf(db, evaluation.id)).toHaveLength(2);
        expect(first).toMatchObject({ state: "complete", resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });
        expect(again).toMatchObject({ state: "complete", resultDigest: first.resultDigest, summary: first.summary });
      } finally {
        other.$client.close();
        db.$client.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    it("fail a Release whose Controls exceed the evaluation limits, and fail the Evaluation with the reason", async () => {
      const { initiative, assessment } = await scenario();
      let deep: JsonObject = { op: "always" };
      for (let level = 0; level < 9; level++) deep = { op: "not", item: deep };
      // Written directly, as validation would never publish it.
      const { standard } = createStandard(db, { name: "Too deep", purpose: "Limits" });
      const release = insertRelease(db, { standard, document: { schema: "fabricate.standard", schema_version: 1, input_schemas: { repository_profile: [1], relationship_map: [1] }, controls: [control("deep", deep)] }, draftLockVersion: 0 });
      const selected = select(initiative, [release]);
      const { evaluation } = startEvaluation(db, selected.publicId, assessment.publicId, crypto.randomUUID());

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
      const { initiative, assessment } = await scenario();
      const first = startEvaluation(db, select(initiative, [publish("Tooling A", control("uses-pnpm", manager("pnpm")))]).publicId, assessment.publicId, crypto.randomUUID()).evaluation;
      await drainJobs(db, jobHandlers(db));

      traps = [
        vi.spyOn(GitRunner.prototype as unknown as { run: () => never }, "run"),
        vi.spyOn(child_process, "spawn"),
        vi.spyOn(dns, "lookup"),
        vi.spyOn(globalThis, "fetch"),
      ];
      const current = (await import("@/lib/initiatives/initiative-records")).getInitiative(db, initiative.publicId);
      const second = startEvaluation(db, select(current, [publish("Tooling B", control("uses-npm", manager("npm")))]).publicId, assessment.publicId, crypto.randomUUID()).evaluation;
      await drainJobs(db, jobHandlers(db));

      for (const trap of traps) expect(trap).not.toHaveBeenCalled();
      expect(getEvaluation(db, second.publicId)).toMatchObject({ state: "complete", assessmentId: assessment.id });
      // The first Evaluation keeps its own Releases and Findings.
      expect((summaryOf(first.publicId).releases as JsonObject[]).map((release) => release.standard)).toEqual(["Tooling A"]);
      expect((summaryOf(second.publicId).releases as JsonObject[]).map((release) => release.standard)).toEqual(["Tooling B"]);
    });

    it("never fold Indeterminate or Not applicable into Gap, and never conclude conformance under uncertainty", async () => {
      const initiative = buildInitiative(db);
      const partial = await assessed(initiative, [buildSource(db, { name: "pnpm-app" }), buildSource(db, { name: "billing" })], [PNPM, "failed"]);
      const selected = select(initiative, [publish("Tooling", control("uses-pnpm", manager("pnpm")), { ...control("typescript-only", { op: "always" }), applicability: { op: "contains", selector: "repository.languages", mode: "any", values: ["TypeScript"] } })]);
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
      const { initiative, assessment } = await scenario();
      const selected = select(initiative, [publish("Tooling", control("uses-pnpm", manager("pnpm")))]);
      const runs = [];
      for (let run = 0; run < 2; run++) {
        const { evaluation } = startEvaluation(db, selected.publicId, assessment.publicId, crypto.randomUUID());
        await drainJobs(db, jobHandlers(db));
        runs.push(getEvaluation(db, evaluation.publicId));
      }
      expect(runs[1]!.resultDigest).toBe(runs[0]!.resultDigest);
      expect(runs[1]!.summary).toBe(runs[0]!.summary);
      expect(findingsOf(db, runs[1]!.id).map((finding) => finding.digest)).toEqual(findingsOf(db, runs[0]!.id).map((finding) => finding.digest));
    });
  });
});
