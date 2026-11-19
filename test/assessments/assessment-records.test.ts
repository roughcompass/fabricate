import { parseCanonical } from "@repo-facts/contract";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AssessmentTarget,
  createAssessment,
  findAssessmentByLaunchToken,
  internalRefFor,
  recordSnapshot,
  snapshotOf,
  targetsOf,
} from "@/lib/assessments/assessment-records";
import { detectorConfiguration } from "@repo-facts/bundle";
import { dump, sha256 } from "@repo-facts/contract";
import { getSource, updateSource } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { deleteInitiative } from "@/lib/initiatives/initiative-records";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";

const sha = (seed: string) => crypto.createHash("sha1").update(seed).digest("hex");

describe("assessment records", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("creates an assessment with target copies in scope order", () => {
    const first = buildSource(db, { name: "orders", gitRef: "main" });
    const second = buildSource(db, { name: "billing" });
    const { assessment, targets } = buildAssessment(db, { sources: [first, second] });

    expect(isPublicId(assessment.publicId, "asm")).toBe(true);
    expect(assessment.state).toBe("queued");
    expect(targets.map((target) => [target.position, target.sourceName, target.gitRef, target.state])).toEqual([
      [0, "orders", "main", "pending"],
      [1, "billing", null, "pending"],
    ]);
    expect(targets[0]).toMatchObject({ sourcePublicId: first.publicId, cloneUrl: first.cloneUrl, canonicalUrl: first.canonicalUrl });
  });

  it("records the detector configuration canonically with its digest", () => {
    const { assessment } = buildAssessment(db, { sources: [buildSource(db)] });

    const bundle = detectorConfiguration(getConfig().analysis);
    expect(assessment.configuration).toBe(dump(bundle.configuration));
    expect(assessment.configurationDigest).toBe(sha256(assessment.configuration));
    expect(assessment.configurationDigest).toBe(bundle.digest);
    expect(parseCanonical(assessment.configuration)).toEqual(bundle.configuration);
  });

  it("keeps copied source configuration when the catalog changes afterward", () => {
    const source = buildSource(db, { name: "orders", gitRef: "main" });
    const { assessment } = buildAssessment(db, { sources: [source] });

    updateSource(db, source.publicId, 0, { name: "orders-ui", cloneUrl: "https://git.example.com/acme/orders-ui.git", canonicalUrl: "https://git.example.com/acme/orders-ui", gitRef: "release" });

    expect(targetsOf(db, assessment.id)[0]).toMatchObject({
      sourceName: "orders",
      cloneUrl: "https://git.example.com/acme/orders.git",
      gitRef: "main",
    });

    const { targets } = buildAssessment(db, { sources: [getSource(db, source.publicId)] });
    expect(targets[0]).toMatchObject({ sourceName: "orders-ui", gitRef: "release" });
  });

  it("finds an assessment by its launch token and rejects a reused token", () => {
    const initiative = buildInitiative(db);
    const source = buildSource(db);
    const input = { initiative, launchToken: crypto.randomUUID(), detectorRelease: "test", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, sources: [source] };
    const { assessment } = createAssessment(db, input);

    expect(findAssessmentByLaunchToken(db, initiative.id, input.launchToken)?.id).toBe(assessment.id);
    expect(() => createAssessment(db, input)).toThrow(/UNIQUE constraint failed: assessments.launch_token/);
  });

  it("requires a scope, a detector release, and a UUID launch token", () => {
    const error = (() => {
      try {
        createAssessment(db, { initiative: buildInitiative(db), launchToken: "again", detectorRelease: " ", configuration: {}, profileSchemaVersion: 1, relationshipSchemaVersion: 1, sources: [] });
      } catch (caught) {
        return caught as ValidationError;
      }
    })();

    expect(error?.issues.map((issue) => issue.field).sort()).toEqual(["detectorRelease", "launchToken", "sources"]);
  });

  it("retains an initiative that has assessments", () => {
    const initiative = buildInitiative(db);
    buildAssessment(db, { initiative, sources: [buildSource(db)] });

    expect(() => deleteInitiative(db, initiative.publicId)).toThrow(/retained/);
    const unassessed = buildInitiative(db);
    deleteInitiative(db, unassessed.publicId);
  });

  describe("source snapshots", () => {
    let target: AssessmentTarget;
    beforeEach(() => {
      target = buildAssessment(db, { sources: [buildSource(db)] }).targets[0]!;
      rawRun(db, "update assessment_targets set state = 'acquiring' where id = ?", target.id);
    });

    const snapshot = { commitSha: sha("commit"), treeSha: sha("tree"), refKind: "branch" as const, resolvedRef: "refs/heads/main", acquisitionMetadata: { requested_ref: "main" } };

    it("records the pinned commit under an internal ref", () => {
      const recorded = recordSnapshot(db, target, snapshot);

      expect(isPublicId(recorded.publicId, "snp")).toBe(true);
      expect(recorded.internalRef).toBe(internalRefFor(recorded.publicId));
      expect(recorded.acquisitionMetadata).toBe('{"requested_ref":"main"}');
      expect(snapshotOf(db, target.id)?.commitSha).toBe(snapshot.commitSha);
    });

    it("rejects malformed object ids before writing", () => {
      expect(() => recordSnapshot(db, target, { ...snapshot, commitSha: "ABC", treeSha: sha("x").toUpperCase() })).toThrow(ValidationError);
    });

    it("allows exactly one snapshot per target", () => {
      recordSnapshot(db, target, snapshot);
      expect(() => recordSnapshot(db, target, snapshot)).toThrow(/UNIQUE constraint failed/);
    });

    it("rejects a snapshot for a target that is not acquiring", () => {
      const pending = buildAssessment(db, { sources: [buildSource(db)] }).targets[0]!;
      expect(() => recordSnapshot(db, pending, snapshot)).toThrow(/recorded for its acquiring target/);
    });

    it("never changes or deletes a snapshot", () => {
      const recorded = recordSnapshot(db, target, snapshot);

      expect(() => rawRun(db, "update source_snapshots set commit_sha = ? where id = ?", sha("other"), recorded.id)).toThrow(/immutable/);
      expect(() => rawRun(db, "delete from source_snapshots where id = ?", recorded.id)).toThrow(/retained/);
    });
  });

  describe("database rules", () => {
    it("rejects changes to copied scope configuration", () => {
      const { targets } = buildAssessment(db, { sources: [buildSource(db)] });

      for (const assignment of ["source_name = 'renamed'", "clone_url = 'https://evil.example.com/x'", "git_ref = 'other'", "position = 7", "canonical_url = 'x'"]) {
        expect(() => rawRun(db, `update assessment_targets set ${assignment} where id = ?`, targets[0]!.id)).toThrow(/scope snapshot cannot change/);
      }
    });

    it("rejects targets added after the assessment was created", () => {
      const { assessment } = buildAssessment(db, { sources: [buildSource(db)] });
      const source = buildSource(db);

      expect(() =>
        rawRun(
          db,
          "insert into assessment_targets (public_id, assessment_id, repository_source_id, position, source_public_id, source_name, clone_url, canonical_url, created_at, updated_at) values ('tgt_aaaaaaaaaaaaaaaa', ?, ?, 1, ?, 'late', 'u', 'u', ?, ?)",
          assessment.id,
          source.id,
          source.publicId,
          assessment.createdAt.getTime() + 1,
          assessment.createdAt.getTime() + 1,
        ),
      ).toThrow(/scope is frozen/);
    });

    it("rejects changes to recorded assessment inputs and deletion", () => {
      const { assessment } = buildAssessment(db, { sources: [buildSource(db)] });

      expect(() => rawRun(db, "update assessments set detector_release = 'other' where id = ?", assessment.id)).toThrow(/recorded inputs/);
      expect(() => rawRun(db, "update assessments set configuration = '{}' where id = ?", assessment.id)).toThrow(/recorded inputs/);
      expect(() => rawRun(db, "delete from assessments where id = ?", assessment.id)).toThrow(/retained/);
    });

    it("requires a failure code exactly for failed targets and a supported state", () => {
      const { targets } = buildAssessment(db, { sources: [buildSource(db)] });
      const id = targets[0]!.id;

      expect(() => rawRun(db, "update assessment_targets set failure_code = 'timeout' where id = ?", id)).toThrow(/CHECK constraint failed/);
      expect(() => rawRun(db, "update assessment_targets set state = 'failed' where id = ?", id)).toThrow(/CHECK constraint failed/);
      // The transition trigger rejects an unknown state before the CHECK constraint runs.
      expect(() => rawRun(db, "update assessment_targets set state = 'exploded' where id = ?", id)).toThrow(/state transition is not allowed/);
    });
  });
});
