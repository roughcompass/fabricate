import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { StaleRecordError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { sha256 } from "@repo-facts/contract";
import { createAssessment, selectedReleases, updateAssessment } from "@/lib/assessments/assessment-records";
import {
  blankDraftDocument,
  createStandard,
  deleteDraft,
  draftDocument,
  draftOf,
  releaseLabel,
  releasesOf,
  saveDraft,
  startDraftFromRelease,
  updateStandardMetadata,
} from "@/lib/standards/standard-records";
import { buildAssessment, buildRelease } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { captureValidation } from "../support/validation";

describe("standard records", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("creates a Standard with one blank editable draft", () => {
    const { standard, draft } = createStandard(db, { name: " Frontend   baseline ", purpose: "Consistent UI builds" });

    expect(isPublicId(standard.publicId, "std")).toBe(true);
    expect(standard.name).toBe("Frontend baseline");
    expect(draftDocument(draft)).toEqual(blankDraftDocument());
    expect(draftOf(db, standard.id)).toEqual({ standardId: standard.id, document: draft.document, lockVersion: 0, savedAt: standard.createdAt, basedOnReleaseId: null });
  });

  it("requires a name and purpose and rejects a case-insensitive duplicate name", () => {
    createStandard(db, { name: "Frontend", purpose: "UI" });

    expect(captureValidation(() => createStandard(db, { name: "", purpose: " " })).issues.map((issue) => issue.field)).toEqual(["name", "purpose"]);
    expect(captureValidation(() => createStandard(db, { name: "FRONTEND", purpose: "Again" })).messagesFor("name")).toEqual(["A Standard named Frontend already exists"]);
  });

  it("allows only one active draft per Standard", () => {
    const { standard, draft } = createStandard(db, { name: "One draft", purpose: "Test" });

    // A draft's columns exist together, and only a draft revises a Release.
    expect(() => rawRun(db, "update standards set draft_lock_version = null where id = ?", standard.id)).toThrow(/CHECK constraint failed/);

    const release = buildRelease(db, { standard });
    expect(() => startDraftFromRelease(db, release)).toThrow(/already has a draft/);
    deleteDraft(db, draft);
    expect(startDraftFromRelease(db, release).basedOnReleaseId).toBe(release.id);
  });

  it("saves draft documents with optimistic locking", () => {
    const { draft } = createStandard(db, { name: "Locked", purpose: "Test" });
    const saved = saveDraft(db, draft, 0, { ...blankDraftDocument(), controls: [{ key: "has-ci" }] });

    expect(saved.lockVersion).toBe(1);
    expect(draftDocument(saved).controls).toEqual([{ key: "has-ci" }]);
    expect(() => saveDraft(db, draft, 0, blankDraftDocument())).toThrow(StaleRecordError);
    expect(captureValidation(() => saveDraft(db, saved, 1, ["not", "a", "document"])).messagesFor("document")).toHaveLength(1);
  });

  it("publishes multiple Releases with increasing versions and content digests", () => {
    const { standard } = createStandard(db, { name: "Versioned", purpose: "Test" });
    const first = buildRelease(db, { standard });
    const second = buildRelease(db, { standard });

    expect([first.version, second.version]).toEqual([1, 2]);
    expect(isPublicId(first.publicId, "rel")).toBe(true);
    expect(first.digest).toBe(sha256(first.document));
    // New drafts declare the current Profile version.
    expect(first.profileSchemaVersions).toEqual([3]);
    expect(releasesOf(db, standard.id).map((release) => release.version)).toEqual([2, 1]);
    expect(releaseLabel(standard, second)).toBe("Versioned v2");
  });

  it("uses optimistic locking for Standard metadata", () => {
    const { standard } = createStandard(db, { name: "Meta", purpose: "Test" });
    updateStandardMetadata(db, standard.publicId, 0, { name: "Meta 2", purpose: "Changed" });

    expect(() => updateStandardMetadata(db, standard.publicId, 0, { name: "Stale", purpose: "x" })).toThrow(StaleRecordError);
  });

  describe("Initiative Release selections", () => {
    it("selects published Releases from several Standards independently", () => {
      const first = buildRelease(db);
      const second = buildRelease(db);
      const assessment = createAssessment(db, { name: "Two Standards", selectionMode: "all", standardReleasePublicIds: [first.publicId, second.publicId] });

      expect(selectedReleases(db, assessment.id).map((selection) => selection.release.id).sort()).toEqual([first.id, second.id].sort());
    });

    it("rejects a draft Standard and an unknown Release with one message each", () => {
      const { standard } = createStandard(db, { name: "Draft only", purpose: "Not yet published" });
      const error = captureValidation(() =>
        createAssessment(db, { name: "Draft", selectionMode: "all", standardReleasePublicIds: [standard.publicId, "rel_unknownunknownu"] }),
      );

      expect(error.messagesFor("standardReleases")).toEqual([
        "Draft only is a draft Standard; select one of its published Releases",
        "rel_unknownunknownu is not a published Standard Release",
      ]);
    });

    it("replaces selections on update and allows none", () => {
      const first = buildRelease(db);
      const second = buildRelease(db);
      const assessment = buildAssessment(db);
      updateAssessment(db, assessment.publicId, 0, { name: assessment.name, selectionMode: "all", standardReleasePublicIds: [first.publicId] });
      updateAssessment(db, assessment.publicId, 1, { name: assessment.name, selectionMode: "all", standardReleasePublicIds: [second.publicId] });

      expect(selectedReleases(db, assessment.id).map((selection) => selection.release.id)).toEqual([second.id]);
      updateAssessment(db, assessment.publicId, 2, { name: assessment.name, selectionMode: "all", standardReleasePublicIds: [] });
      expect(selectedReleases(db, assessment.id)).toEqual([]);
    });
  });

  describe("database rules", () => {
    it("never changes or deletes a published Release", () => {
      const release = buildRelease(db);

      expect(() => rawRun(db, "update standard_releases set document = '{}' where id = ?", release.id)).toThrow(/immutable/);
      expect(() => rawRun(db, "delete from standard_releases where id = ?", release.id)).toThrow(/retained/);
    });

    it("rejects a duplicate version, a malformed digest, and a non-object draft document", () => {
      const release = buildRelease(db);
      const { standard } = createStandard(db, { name: "Raw", purpose: "Test" });
      const insert = (version: number, digest: string) =>
        rawRun(
          db,
          "insert into standard_releases (public_id, standard_id, version, document_schema_version, document, digest, profile_schema_versions, relationship_schema_versions, draft_lock_version, published_at, created_at) values ('rel_aaaaaaaaaaaaaaaa', ?, ?, 1, '{}', ?, '[1]', '[1]', 0, 0, 0)",
          release.standardId,
          version,
          digest,
        );

      expect(() => insert(1, "a".repeat(64))).toThrow(/UNIQUE constraint failed/);
      expect(() => insert(9, "short")).toThrow(/CHECK constraint failed/);
      expect(() => rawRun(db, "update standards set draft_document = '[]' where id = ?", standard.id)).toThrow(/CHECK constraint failed/);
    });

    it("rejects repointing a Release selection", () => {
      const release = buildRelease(db);
      const assessment = createAssessment(db, { name: "Selector", selectionMode: "all", standardReleasePublicIds: [release.publicId] });

      expect(() => rawRun(db, "update initiative_standard_releases set standard_release_id = ? where initiative_id = ?", buildRelease(db).id, assessment.id)).toThrow(
        /cannot be changed in place/,
      );
    });
  });
});
