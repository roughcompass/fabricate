import { type JsonObject, sha256 } from "@repo-facts/contract";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { StaleRecordError, ValidationError } from "@/lib/db/errors";
import { selectedReleases, updateInitiative } from "@/lib/initiatives/initiative-records";
import { standardDigest } from "@/lib/standards/canonical";
import { previewPublication, publishDraft, reviseRelease } from "@/lib/standards/publish";
import * as standardRecords from "@/lib/standards/standard-records";
import { createStandard, draftDocument, draftOf, getStandard, releaseDocument, releasesOf, saveDraft } from "@/lib/standards/standard-records";
import { buildInitiative } from "../support/builders";
import { createTestDb, rawRun, withSharedFileDb } from "../support/db";
import { captureValidation } from "../support/validation";
import { sampleStandard } from "../support/standards";

describe("publication", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  function draftWith(document: JsonObject, name = "Engineering baseline") {
    const { standard, draft } = createStandard(db, { name, purpose: "Shared expectations for fleet repositories" });
    return { standard, draft: saveDraft(db, draft, draft.lockVersion, document) };
  }

  it("publishes a valid draft as an immutable, canonical Release with its digest, and consumes the draft", () => {
    const { standard, draft } = draftWith(sampleStandard());
    const preview = previewPublication(db, standard.publicId)!;
    expect(preview).toMatchObject({ issues: [], controls: 8, draft: { lockVersion: draft.lockVersion } });

    const release = publishDraft(db, standard.publicId, draft.lockVersion);
    const document = releaseDocument(release);

    expect(release).toMatchObject({ version: 1, draftLockVersion: draft.lockVersion, digest: sha256(release.document), profileSchemaVersions: [1], relationshipSchemaVersions: [1] });
    expect(release.digest).toBe(preview.digest);
    expect(release.digest).toBe(standardDigest(document));
    expect(document.standard).toEqual({ name: "Engineering baseline", purpose: "Shared expectations for fleet repositories" });
    // Controls are stored in canonical key order.
    expect((document.controls as { key: string }[]).map((control) => control.key)).toEqual([...(sampleStandard().controls as { key: string }[]).map((control) => control.key)].sort());
    expect(draftOf(db, standard.id)).toBeUndefined();
  });

  it("refuses an invalid draft with every validation error and creates no Release", () => {
    const { standard, draft } = draftWith({ ...sampleStandard(), controls: [] });
    const error = captureValidation(() => publishDraft(db, standard.publicId, draft.lockVersion));

    expect(error.issues).toEqual([{ field: "controls", message: "Add at least one Control" }]);
    expect(releasesOf(db, standard.id)).toEqual([]);
    expect(draftOf(db, standard.id)).toBeDefined();
  });

  it("refuses to publish a draft that changed after it was reviewed", () => {
    const { standard, draft } = draftWith(sampleStandard());
    saveDraft(db, draft, draft.lockVersion, { ...sampleStandard(), controls: (sampleStandard().controls as JsonObject[]).slice(0, 1) });

    expect(() => publishDraft(db, standard.publicId, draft.lockVersion)).toThrow(StaleRecordError);
    expect(releasesOf(db, standard.id)).toEqual([]);
  });

  it("creates at most one Release when two publications of one draft race, from separate connections", () =>
    withSharedFileDb((first, second) => {
      const { standard, draft } = createStandard(first, { name: "Race", purpose: "Concurrency" });
      const saved = saveDraft(first, draft, draft.lockVersion, sampleStandard());
      // Both operators reviewed the same draft version.
      const outcomes = [first, second].map((connection) => {
        try {
          return publishDraft(connection, standard.publicId, saved.lockVersion).version;
        } catch (error) {
          return (error as Error).name;
        }
      });

      expect(outcomes).toEqual([1, "StaleRecordError"]);
      expect(releasesOf(second, getStandard(second, standard.publicId).id)).toHaveLength(1);
    }));

  it("revises a Release in a new draft without changing any published Release", () => {
    const { standard, draft } = draftWith(sampleStandard());
    const v1 = publishDraft(db, standard.publicId, draft.lockVersion);

    const revision = reviseRelease(db, v1.publicId);
    expect(revision.basedOnReleaseId).toBe(v1.id);
    const content = draftDocument(revision);
    expect(content.standard).toBeUndefined();
    expect(content.controls).toEqual(releaseDocument(v1).controls);
    expect(() => reviseRelease(db, v1.publicId)).toThrow(ValidationError);

    const edited = saveDraft(db, revision, revision.lockVersion, { ...content, controls: (content.controls as JsonObject[]).slice(0, 2) });
    const v2 = publishDraft(db, standard.publicId, edited.lockVersion);
    expect(v2.version).toBe(2);
    expect(releasesOf(db, standard.id).map((release) => release.version)).toEqual([2, 1]);
    expect(releaseDocument(v1).controls).toHaveLength(8);
    expect(releaseDocument(v2).controls).toHaveLength(2);
  });

  it("never updates or deletes a published Release, including one an Initiative selects", () => {
    const { standard, draft } = draftWith(sampleStandard());
    const release = publishDraft(db, standard.publicId, draft.lockVersion);
    const initiative = buildInitiative(db);
    updateInitiative(db, initiative.publicId, initiative.lockVersion, { name: initiative.name, objective: initiative.objective, selectionMode: "all", standardReleasePublicIds: [release.publicId] });
    expect(selectedReleases(db, initiative.id).map((selected) => selected.release.id)).toEqual([release.id]);

    expect(() => rawRun(db, "update standard_releases set document = ? where id = ?", "{}", release.id)).toThrow(/immutable/);
    expect(() => rawRun(db, "delete from standard_releases where id = ?", release.id)).toThrow(/retained/);
    // The data-access layer offers no way to change a Release.
    expect(Object.keys(standardRecords).filter((name) => /^(update|delete|save|set)Release/i.test(name))).toEqual([]);
  });
});
