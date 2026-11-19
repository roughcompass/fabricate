import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { surveyRefFor } from "@/lib/acquisition/mirror";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { sha256 } from "@repo-facts/contract";
import { DocumentIntegrityError, prepareDocument, readDocument } from "@/lib/documents/digested";
import { profileDocument, insertProfile, profileOfSurvey } from "@/lib/profiles/profile-records";
import { insertRelationshipMap, mapDocument } from "@/lib/relationships/map-records";
import { releaseDocument } from "@/lib/standards/standard-records";
import { type Survey, moveSurvey, pinSurvey, requestSurvey } from "@/lib/surveys/records";
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

  it("parses a document read again once, and still checks its digest every time", () => {
    const text = '{"schema":"fabricate.standard","schema_version":1,"weight":2}';
    const first = readDocument("standard", { document: text, digest: sha256(text) }, "Release");

    expect(readDocument("standard", { document: text, digest: sha256(text) }, "Release")).toBe(first);
    expect(() => readDocument("standard", { document: text.replace("2", "3"), digest: sha256(text) }, "Release")).toThrow(DocumentIntegrityError);
    const other = text.replace("2", "3");
    expect(readDocument("standard", { document: other, digest: sha256(other) }, "Release")).toMatchObject({ weight: 3 });
  });

  describe("stored results", () => {
    let db: Db;
    let survey: Survey;
    let assessment: ReturnType<typeof buildAssessment>["assessment"];

    const profileBody = (overrides: Record<string, unknown> = {}) => ({
      schema: "fabricate.repository_profile",
      schema_version: 1,
      detector_release: survey.surveyorRelease,
      detector_configuration_digest: survey.configurationDigest,
      commit: survey.commitSha,
      categories: {},
      ...overrides,
    });

    beforeEach(() => {
      db = createTestDb();
      const source = buildSource(db);
      assessment = buildAssessment(db, { sources: [source] }).assessment;
      const { survey: queued } = requestSurvey(db, {
        repositorySourceId: source.id,
        commitSha: sha1("c"),
        reference: "refs/heads/main",
        fromConfiguredReference: true,
        trigger: "run",
        requestedByAssessmentId: assessment.id,
        surveyorRelease: assessment.detectorRelease,
        configurationDigest: assessment.configurationDigest,
        profileSchemaVersion: assessment.profileSchemaVersion,
      });
      survey = pinSurvey(db, moveSurvey(db, queued, "running", { attempts: 1 }), { treeSha: sha1("t"), internalRef: surveyRefFor(queued.publicId) });
    });

    it("stores one immutable Profile per survey and keeps __proto__ keys inert", () => {
      // An object literal's __proto__ sets the prototype, so the hostile key comes from parsed JSON text.
      const document = JSON.parse(JSON.stringify(profileBody()).replace('"categories":{}', '"categories":{"__proto__":{"polluted":true}}'));
      const profile = insertProfile(db, { survey, document });

      expect(profile.digest).toBe(sha256(profile.document));
      const stored = profileDocument(profile) as Record<string, Record<string, unknown>>;
      expect(Object.keys(stored.categories!)).toEqual(["__proto__"]);
      expect(Object.prototype).not.toHaveProperty("polluted");
      expect(profileOfSurvey(db, survey.id)?.id).toBe(profile.id);

      expect(() => insertProfile(db, { survey, document })).toThrow(/UNIQUE constraint failed/);
      expect(() => rawRun(db, "update repository_profiles set document = '{}' where id = ?", profile.id)).toThrow(/immutable/);
      expect(() => rawRun(db, "delete from repository_profiles where id = ?", profile.id)).toThrow(/retained/);
      expect(() => profileDocument({ ...profile, document: profile.document.replace("repository_profile", "repository_profilx") })).toThrow(/digest verification/);
    });

    it("rejects a Profile for another commit, Surveyor release, or configuration", () => {
      const error = captureValidation(() => insertProfile(db, { survey, document: profileBody({ commit: sha1("other"), detector_release: "other", detector_configuration_digest: "0".repeat(64) }) }));
      expect(error.issues).toHaveLength(3);
    });

    it("rejects a Profile for a survey that is not running", () => {
      moveSurvey(db, survey, "failed", { failureCode: "analysis_failed", failureMessage: "Surveyor stopped" });
      expect(() => insertProfile(db, { survey, document: profileBody() })).toThrow(/written by its running survey/);
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
