import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { type AssessmentTarget, type SourceSnapshot, recordSnapshot } from "@/lib/assessments/assessment-records";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { sha256 } from "@repo-facts/contract";
import { DocumentIntegrityError, prepareDocument, readDocument } from "@/lib/documents/digested";
import { profileDocument, insertProfile, profilesOf } from "@/lib/profiles/profile-records";
import { insertRelationshipMap, mapDocument } from "@/lib/relationships/map-records";
import { releaseDocument } from "@/lib/standards/standard-records";
import { buildAssessment, buildRelease, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { captureValidation } from "../support/validation";

const sha1 = (seed: string) => crypto.createHash("sha1").update(seed).digest("hex");

describe("digested documents", () => {
  it("rejects a document with the wrong schema, an unsupported version, or a non-object value", () => {
    expect(captureValidation(() => prepareDocument("repositoryProfile", { schema: "fabricate.finding", schema_version: 1 })).issues[0]?.message).toMatch(
      /must declare schema fabricate.repository_profile/,
    );
    expect(captureValidation(() => prepareDocument("repositoryProfile", { schema: "fabricate.repository_profile", schema_version: 99 })).issues[0]?.message).toMatch(
      /not supported/,
    );
    expect(() => prepareDocument("finding", [1, 2])).toThrow(ValidationError);
  });

  it("rejects noncanonical text and non-integer numbers", () => {
    expect(captureValidation(() => prepareDocument("standard", '{"schema_version":1, "schema":"fabricate.standard"}')).issues[0]?.message).toBe(
      "Documents must be canonical JSON",
    );
    expect(captureValidation(() => prepareDocument("standard", { schema: "fabricate.standard", schema_version: 1, weight: 0.5 })).issues[0]?.message).toMatch(/safe integer/);
  });

  it("accepts canonical text and returns the digest of its bytes", () => {
    const text = '{"schema":"fabricate.standard","schema_version":1}';
    const prepared = prepareDocument("standard", text);

    expect(prepared).toMatchObject({ text, digest: sha256(text), schemaVersion: 1 });
  });

  it("detects digest mismatches and noncanonical stored text on read", () => {
    const text = '{"schema":"fabricate.standard","schema_version":1}';
    const noncanonical = '{"schema_version":1,"schema":"fabricate.standard"}';

    expect(() => readDocument("standard", { document: text.replace("1", "2"), digest: sha256(text) }, "Release")).toThrow(DocumentIntegrityError);
    expect(() => readDocument("standard", { document: noncanonical, digest: sha256(noncanonical) }, "Release")).toThrow(/not canonical/);
  });

  describe("stored results", () => {
    let db: Db;
    let target: AssessmentTarget;
    let snapshot: SourceSnapshot;
    let assessment: ReturnType<typeof buildAssessment>["assessment"];

    const profileBody = (overrides: Record<string, unknown> = {}) => ({
      schema: "fabricate.repository_profile",
      schema_version: 1,
      detector_release: assessment.detectorRelease,
      detector_configuration_digest: assessment.configurationDigest,
      commit: snapshot.commitSha,
      categories: {},
      ...overrides,
    });

    beforeEach(() => {
      db = createTestDb();
      const built = buildAssessment(db, { sources: [buildSource(db)] });
      assessment = built.assessment;
      target = built.targets[0]!;
      rawRun(db, "update assessment_targets set state = 'acquiring' where id = ?", target.id);
      snapshot = recordSnapshot(db, target, { commitSha: sha1("c"), treeSha: sha1("t"), refKind: "default_branch", resolvedRef: "refs/heads/main", acquisitionMetadata: {} });
      rawRun(db, "update assessment_targets set state = 'analyzing' where id = ?", target.id);
    });

    it("stores one immutable Profile per snapshot and keeps __proto__ keys inert", () => {
      // An object literal's __proto__ sets the prototype, so the hostile key comes from parsed JSON text.
      const document = JSON.parse(JSON.stringify(profileBody()).replace('"categories":{}', '"categories":{"__proto__":{"polluted":true}}'));
      const profile = insertProfile(db, { assessment, target, snapshot, document });

      expect(profile.digest).toBe(sha256(profile.document));
      const stored = profileDocument(profile) as Record<string, Record<string, unknown>>;
      expect(Object.keys(stored.categories!)).toEqual(["__proto__"]);
      expect(Object.prototype).not.toHaveProperty("polluted");
      expect(profilesOf(db, assessment.id).map((row) => row.profile.id)).toEqual([profile.id]);

      expect(() => insertProfile(db, { assessment, target, snapshot, document })).toThrow(/UNIQUE constraint failed/);
      expect(() => rawRun(db, "update repository_profiles set document = '{}' where id = ?", profile.id)).toThrow(/immutable/);
      expect(() => rawRun(db, "delete from repository_profiles where id = ?", profile.id)).toThrow(/retained/);
      expect(() => profileDocument({ ...profile, document: profile.document.replace("repository_profile", "repository_profilx") })).toThrow(/digest verification/);
    });

    it("rejects a Profile for another commit, detector release, or detector configuration", () => {
      const error = captureValidation(() => insertProfile(db, { assessment, target, snapshot, document: profileBody({ commit: sha1("other"), detector_release: "other", detector_configuration_digest: "0".repeat(64) }) }));
      expect(error.issues).toHaveLength(3);
    });

    it("rejects a Profile for a target that is not being analyzed", () => {
      rawRun(db, "update assessment_targets set state = 'complete' where id = ?", target.id);
      expect(() => insertProfile(db, { assessment, target, snapshot, document: profileBody() })).toThrow(/analyzing target/);
    });

    it("stores one immutable Relationship Map per Assessment, written while finalizing", () => {
      const document = { schema: "fabricate.relationship_map", schema_version: 1, resolver_version: "1", nodes: [], edges: [] };
      expect(() => insertRelationshipMap(db, { assessment, document })).toThrow(/while the assessment is finalizing/);

      rawRun(db, "update assessments set state = 'finalizing' where id = ?", assessment.id);
      const map = insertRelationshipMap(db, { assessment, document });
      expect(mapDocument(map)).toEqual(document);
      expect(() => insertRelationshipMap(db, { assessment, document })).toThrow(/UNIQUE constraint failed/);
      expect(() => rawRun(db, "update relationship_maps set resolver_version = '2' where id = ?", map.id)).toThrow(/immutable/);
    });

    it("verifies a Release document against its published digest", () => {
      const release = buildRelease(db);

      expect(releaseDocument(release).schema).toBe("fabricate.standard");
      expect(() => releaseDocument({ ...release, document: release.document.replace("[]", "[1]") })).toThrow(DocumentIntegrityError);
    });
  });
});
