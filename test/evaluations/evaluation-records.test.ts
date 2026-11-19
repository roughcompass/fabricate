import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { RunTarget } from "@/lib/runs/run-records";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import type { JsonObject } from "@repo-facts/contract";
import {
  type Evaluation,
  type EvaluationRelease,
  coverageGapsOf,
  createEvaluation,
  evaluationReleasesOf,
  findingDocument,
  findingsOf,
  insertFinding,
} from "@/lib/evaluations/evaluation-records";
import type { StandardRelease } from "@/lib/standards/standard-records";
import { buildRun, buildRelease, buildRepository } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";

const findingDocumentFor = (controlKey: string, subjectKey: string, outcome = "meets", severity = "medium", type = "repository"): JsonObject => ({
  schema: "fabricate.finding",
  schema_version: 1,
  control: { key: controlKey, severity, title: controlKey },
  subject: { type, key: subjectKey },
  outcome,
});

describe("evaluation records", () => {
  let db: Db;
  let first: StandardRelease;
  let second: StandardRelease;
  let target: RunTarget;
  let evaluation: Evaluation;
  let pinned: EvaluationRelease[];

  beforeEach(() => {
    db = createTestDb();
    first = buildRelease(db);
    second = buildRelease(db);
    const built = buildRun(db, { repositories: [buildRepository(db)] });
    target = built.targets[0]!;
    rawRun(db, "update assessments set state = 'acquiring' where id = ?", built.run.id);
    ({ evaluation, releases: pinned } = createEvaluation(db, {
      assessment: { id: built.run.assessmentId } as never,
      run: built.run,
      launchToken: crypto.randomUUID(),
      evaluatorVersion: "test",
      configuration: { schema: "fabricate.evaluator_configuration" },
      profileSchemaVersion: 1,
      relationshipSchemaVersion: 1,
      coverageGaps: [{ target: "tgt_x", type: "target_failed" }],
      releases: [second, first],
    }));
  });

  const beginEvaluating = () => {
    rawRun(db, "update evaluations set state = 'evaluating' where id = ?", evaluation.id);
    rawRun(db, "update evaluation_releases set state = 'evaluating' where evaluation_id = ?", evaluation.id);
  };

  it("pins each Release by identity and published digest in order", () => {
    expect(isPublicId(evaluation.publicId, "evl")).toBe(true);
    expect(pinned.map((release) => [release.position, release.standardReleaseId, release.releaseDigest])).toEqual([
      [0, second.id, second.digest],
      [1, first.id, first.digest],
    ]);
    expect(evaluationReleasesOf(db, evaluation.id).map((release) => release.state)).toEqual(["pending", "pending"]);
    expect(coverageGapsOf(evaluation)).toEqual([{ target: "tgt_x", type: "target_failed" }]);
  });

  it("rejects duplicate pinned Releases and an empty selection", () => {
    const base = { assessment: { id: evaluation.assessmentId } as never, run: { id: evaluation.runId } as never, evaluatorVersion: "test", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, coverageGaps: [] };

    expect(() => createEvaluation(db, { ...base, launchToken: crypto.randomUUID(), releases: [first, first] })).toThrow(ValidationError);
    expect(() => createEvaluation(db, { ...base, launchToken: crypto.randomUUID(), releases: [] })).toThrow(ValidationError);
  });

  it("writes Findings whose indexed columns come from the document", () => {
    beginEvaluating();
    const finding = insertFinding(db, { evaluation, evaluationRelease: pinned[0]!, target, position: 0, document: findingDocumentFor("has-ci", target.publicId, "gap", "high") });

    expect(isPublicId(finding.publicId, "fnd")).toBe(true);
    expect(finding).toMatchObject({ controlKey: "has-ci", subjectKey: target.publicId, outcome: "gap", severity: "high", standardReleaseId: second.id });
    expect(findingDocument(finding)).toEqual(findingDocumentFor("has-ci", target.publicId, "gap", "high"));
    expect(findingsOf(db, evaluation.id, { outcomes: ["gap"], severities: ["high"] }).map((row) => row.id)).toEqual([finding.id]);
  });

  it("keeps overlapping Controls from different Releases as separate Findings", () => {
    beginEvaluating();
    insertFinding(db, { evaluation, evaluationRelease: pinned[1]!, target, position: 0, document: findingDocumentFor("has-ci", target.publicId, "meets") });
    insertFinding(db, { evaluation, evaluationRelease: pinned[0]!, target, position: 0, document: findingDocumentFor("has-ci", target.publicId, "gap") });

    expect(findingsOf(db, evaluation.id).map((finding) => [finding.standardReleaseId, finding.outcome])).toEqual([
      [second.id, "gap"],
      [first.id, "meets"],
    ]);
  });

  it("rejects a duplicate Finding for the same Release, Control, and subject", () => {
    beginEvaluating();
    const input = { evaluation, evaluationRelease: pinned[0]!, target, position: 0, document: findingDocumentFor("has-ci", target.publicId) };
    insertFinding(db, input);

    expect(() => insertFinding(db, { ...input, position: 1 })).toThrow(/UNIQUE constraint failed/);
  });

  it("rejects documents with unsupported outcomes, severities, or subjects", () => {
    beginEvaluating();
    const error = (() => {
      try {
        insertFinding(db, { evaluation, evaluationRelease: pinned[0]!, position: 0, document: findingDocumentFor("", "x", "pass", "urgent", "galaxy") });
      } catch (caught) {
        return caught as ValidationError;
      }
    })();

    expect(error?.issues.map((issue) => issue.field).sort()).toEqual(["control.key", "control.severity", "outcome", "subject.type"]);
  });

  describe("database rules", () => {
    it("rejects a pinned digest that does not match the published Release", () => {
      const other = buildRelease(db);
      rawRun(db, "update evaluations set state = 'evaluating' where id = ?", evaluation.id);

      expect(() =>
        rawRun(db, "insert into evaluation_releases (evaluation_id, standard_release_id, release_digest, position, created_at, updated_at) values (?, ?, ?, 9, ?, ?)", evaluation.id, other.id, "0".repeat(64), evaluation.createdAt.getTime(), evaluation.createdAt.getTime()),
      ).toThrow(/pinned/);
    });

    it("rejects Releases added after the Evaluation was created and changes to pinned inputs", () => {
      const other = buildRelease(db);
      const later = evaluation.createdAt.getTime() + 1;

      expect(() =>
        rawRun(db, "insert into evaluation_releases (evaluation_id, standard_release_id, release_digest, position, created_at, updated_at) values (?, ?, ?, 9, ?, ?)", evaluation.id, other.id, other.digest, later, later),
      ).toThrow(/pinned when the Evaluation is created/);
      expect(() => rawRun(db, "update evaluation_releases set release_digest = ? where id = ?", "f".repeat(64), pinned[0]!.id)).toThrow(/pinned inputs/);
      expect(() => rawRun(db, "update evaluations set evaluator_version = 'other' where id = ?", evaluation.id)).toThrow(/pinned inputs/);
      expect(() => rawRun(db, "update evaluations set coverage_gaps = '[]' where id = ?", evaluation.id)).toThrow(/pinned inputs/);
    });

    it("rejects Findings before evaluation starts and after it is finalized", () => {
      const input = { evaluation, evaluationRelease: pinned[0]!, target, position: 0, document: findingDocumentFor("has-ci", target.publicId) };
      expect(() => insertFinding(db, input)).toThrow(/after the Evaluation is finalized/);

      beginEvaluating();
      rawRun(db, "update evaluation_releases set state = 'complete' where id = ?", pinned[0]!.id);
      expect(() => insertFinding(db, input)).toThrow(/after the Evaluation is finalized/);
    });

    it("never changes or deletes a Finding", () => {
      beginEvaluating();
      const finding = insertFinding(db, { evaluation, evaluationRelease: pinned[0]!, target, position: 0, document: findingDocumentFor("has-ci", target.publicId) });

      expect(() => rawRun(db, "update findings set outcome = 'meets' where id = ?", finding.id)).toThrow(/immutable/);
      expect(() => rawRun(db, "delete from findings where id = ?", finding.id)).toThrow(/retained/);
    });

    it("rejects a Finding whose Release does not match its pinned Release", () => {
      beginEvaluating();
      const finding = insertFinding(db, { evaluation, evaluationRelease: pinned[0]!, target, position: 0, document: findingDocumentFor("a", target.publicId) });

      expect(() =>
        rawRun(
          db,
          "insert into findings (public_id, evaluation_id, evaluation_release_id, standard_release_id, assessment_target_id, control_key, subject_type, subject_key, outcome, severity, position, document_schema_version, document, digest, created_at) select 'fnd_aaaaaaaaaaaaaaaa', evaluation_id, evaluation_release_id, ?, assessment_target_id, 'b', subject_type, subject_key, outcome, severity, 1, 1, document, digest, 0 from findings where id = ?",
          first.id,
          finding.id,
        ),
      ).toThrow(/must match its pinned Release/);
    });

    it("requires a summary and result digest before an Evaluation is complete", () => {
      rawRun(db, "update evaluations set state = 'evaluating' where id = ?", evaluation.id);
      rawRun(db, "update evaluations set state = 'finalizing' where id = ?", evaluation.id);
      expect(() => rawRun(db, "update evaluations set state = 'complete' where id = ?", evaluation.id)).toThrow(/CHECK constraint failed/);
    });
  });
});
