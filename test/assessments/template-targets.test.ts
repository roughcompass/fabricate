import crypto from "node:crypto";
import { DETECTOR_RELEASE, detectorConfiguration } from "@repo-facts/bundle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssessment, snapshotOf, storedFilesOf, targetsOf, type TemplateTargetInput } from "@/lib/assessments/assessment-records";
import { finalizeAssessment, processTarget } from "@/lib/assessments/orchestration";
import { type FabricateConfig, getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { CURRENT_VERSION } from "@/lib/documents/schemas";
import { GitRunner } from "@/lib/git/runner";
import { saltPatternsInitiative } from "@/lib/initiatives/initiative-records";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { profileProblems } from "@/lib/profiles/schema";
import { type ExportedVersion, projectFiles } from "@/lib/prototypes/export";
import { MOCK_DATA, mockPage } from "@/lib/prototypes/models/mock-fixtures";
import { DEFAULT_SHELL } from "@/lib/prototypes/seed/defaults";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import { treeObjectId } from "@/lib/snapshot/stored-files";
import { createTestDb } from "../support/db";

/*
 * Template targets (converge-templates-and-prototypes, design decision 2): a
 * template version's exported project is assessed under the Salt Patterns
 * initiative without acquisition. Its files are stored with it, its snapshot is them, its
 * Profile names the template, version, and content digest, and no Git
 * command runs.
 */

const VERSION: ExportedVersion = {
  prototypeName: "Exception-first queue",
  number: 4,
  scope: "page",
  title: "Urgent payments",
  navItem: "Approvals",
  code: mockPage("Exception-first queue"),
  data: MOCK_DATA,
  personas: [],
  shell: DEFAULT_SHELL,
};
const FILES = projectFiles(VERSION);
const DIGEST = treeObjectId(FILES);

const TEMPLATE: TemplateTargetInput = {
  key: "ptp_payments00000000",
  name: "Exception-first queue",
  templatePublicId: "ptp_payments00000000",
  templateVersionPublicId: "ptv_payments00000000",
  templateVersionNumber: 2,
  prototypeVersionPublicId: "ver_payments00000000",
  files: FILES,
};

describe("template targets", () => {
  let db: Db;
  let config: FabricateConfig;
  let git: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = createTestDb();
    config = getConfig();
    git = vi.spyOn(GitRunner.prototype, "run");
  });
  afterEach(() => git.mockRestore());

  function start(template: TemplateTargetInput = TEMPLATE) {
    return createAssessment(db, {
      initiative: saltPatternsInitiative(db),
      launchToken: crypto.randomUUID(),
      detectorRelease: DETECTOR_RELEASE,
      configuration: detectorConfiguration(config.analysis).configuration,
      profileSchemaVersion: CURRENT_VERSION.repositoryProfile,
      relationshipSchemaVersion: CURRENT_VERSION.relationshipMap,
      sources: [],
      templates: [template],
    });
  }

  it("profiles the stored files as a version 2 Profile naming the template, its version, and its digest, with no commit and no Git (Template-version profile)", async () => {
    const { assessment, targets } = start();
    const target = await processTarget(db, targets[0]!.publicId, { config });

    expect(target.state).toBe("complete");
    expect(snapshotOf(db, target.id)).toMatchObject({ refKind: "stored_files", commitSha: null, repositorySourceId: null, treeSha: DIGEST, resolvedRef: "ptv_payments00000000" });

    const { profile } = profilesOf(db, assessment.id)[0]!;
    const document = profileDocument(profile);
    expect(profile.schemaVersion).toBe(2);
    expect(document).toMatchObject({
      schema_version: 2,
      template: { public_id: "ptp_payments00000000", name: "Exception-first queue", version_public_id: "ptv_payments00000000", version_number: 2, prototype_version_public_id: "ver_payments00000000" },
      content_digest: DIGEST,
    });
    expect(document).not.toHaveProperty("commit");
    expect(document).not.toHaveProperty("source");
    expect((document.fact_document as { commit: unknown }).commit).toBeNull();
    expect(profileProblems(document)).toEqual([]);
    expect(git).not.toHaveBeenCalled();
  });

  it("profiles a version before its first acceptance, which has no template yet", async () => {
    const { assessment, targets } = start({ ...TEMPLATE, key: "pro_queue00000000000", templatePublicId: null, templateVersionPublicId: null, templateVersionNumber: null });

    const target = await processTarget(db, targets[0]!.publicId, { config });

    expect(target.state).toBe("complete");
    expect(snapshotOf(db, target.id)?.resolvedRef).toBe("ver_payments00000000");
    const { profile } = profilesOf(db, assessment.id)[0]!;
    expect(profileDocument(profile).template).toEqual({ public_id: null, name: "Exception-first queue", version_public_id: null, version_number: null, prototype_version_public_id: "ver_payments00000000" });
  });

  it("stores the files with the target under its content digest, and keeps them unchanged", () => {
    const { targets } = start();
    const [target] = targets;

    expect(target!.contentDigest).toBe(DIGEST);
    expect(storedFilesOf(db, target!)).toEqual(FILES);
    expect(() => db.$client.prepare("update stored_file_sets set files = '{}'").run()).toThrow(/stored files are immutable/);
    expect(() => db.$client.prepare("delete from stored_file_sets").run()).toThrow(/cannot be deleted/);
    expect(() => db.$client.prepare("insert into stored_file_sets (assessment_target_id, digest, files, created_at) values (?, ?, '{}', 0)").run(target!.id, DIGEST)).toThrow();
  });

  it("finalizes a Run of templates with an empty Relationship Map", async () => {
    const { assessment, targets } = start();
    await processTarget(db, targets[0]!.publicId, { config });

    expect(finalizeAssessment(db, assessment.publicId).state).toBe("complete");
    const map = mapDocument(mapOf(db, assessment.id)!);
    expect(map.nodes).toEqual([]);
    expect(targetsOf(db, assessment.id).map((target) => target.kind)).toEqual(["template"]);
    expect(git).not.toHaveBeenCalled();
  });

  it("refuses catalog sources and template versions in one Run", () => {
    expect(() =>
      createAssessment(db, {
        initiative: saltPatternsInitiative(db),
        launchToken: crypto.randomUUID(),
        detectorRelease: DETECTOR_RELEASE,
        configuration: {},
        profileSchemaVersion: 2,
        relationshipSchemaVersion: 1,
        sources: [{ id: 1 } as never],
        templates: [TEMPLATE],
      }),
    ).toThrow(/catalog sources or template versions, not both/);
  });
});
