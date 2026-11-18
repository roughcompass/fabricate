import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { initiatives, repositorySources } from "./catalog";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp, updatedAt } from "./columns";

export const ASSESSMENT_STATES = ["queued", "acquiring", "analyzing", "finalizing", "complete", "complete_with_issues", "failed", "canceled"] as const;
export type AssessmentState = (typeof ASSESSMENT_STATES)[number];

export const TARGET_STATES = ["pending", "acquiring", "analyzing", "complete", "failed", "canceled"] as const;
export type TargetState = (typeof TARGET_STATES)[number];

export const REF_KINDS = ["default_branch", "branch", "tag", "commit", "stored_files"] as const;
/** What a target assesses: a catalog repository at a commit, or a template version's stored files (converge-templates-and-prototypes, design decision 2). */
export const TARGET_KINDS = ["source", "template"] as const;
export type RefKind = (typeof REF_KINDS)[number];

/**
 * One static assessment run over an immutable scope snapshot. Standard
 * selections are deliberately not part of an Assessment, so one Assessment can
 * be evaluated against any number of later Release selections.
 */
export const assessments = sqliteTable(
  "assessments",
  {
    id: id(),
    publicId: publicId(),
    initiativeId: integer("initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "restrict" }),
    state: text("state", { enum: ASSESSMENT_STATES }).notNull().default("queued"),
    launchToken: text("launch_token").notNull().unique(),
    detectorRelease: text("detector_release").notNull(),
    configuration: text("configuration").notNull(),
    configurationDigest: text("configuration_digest").notNull(),
    profileSchemaVersion: integer("profile_schema_version").notNull(),
    relationshipSchemaVersion: integer("relationship_schema_version").notNull(),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    failureReason: text("failure_reason"),
    /**
     * The published Releases, by public id as a JSON array, a Salt Patterns
     * Run is evaluated against when it finishes: a template re-check pins
     * those its acceptance used. Null evaluates it against its initiative's
     * selection at that time.
     */
    evaluationReleases: text("evaluation_releases"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("assessments_initiative").on(t.initiativeId),
    check("assessments_public_id", sql`${t.publicId} GLOB 'asm_*'`),
    check("assessments_state", sql.raw(`state IN (${sqlList(ASSESSMENT_STATES)})`)),
    check("assessments_configuration_digest", sql`length(${t.configurationDigest}) = 64`),
    check("assessments_schema_versions", sql`${t.profileSchemaVersion} > 0 AND ${t.relationshipSchemaVersion} > 0`),
  ],
);

/**
 * One immutable scope entry. Source identity, name, clone URL, and configured
 * reference are copied from the catalog when the assessment starts, so later
 * catalog edits affect only future assessments.
 */
export const assessmentTargets = sqliteTable(
  "assessment_targets",
  {
    id: id(),
    publicId: publicId(),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: TARGET_KINDS }).notNull().default("source"),
    /** The catalog source, for a source target; null for a template target. */
    repositorySourceId: integer("repository_source_id").references(() => repositorySources.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    /** The source's public id, or the template version's for a template target. */
    sourcePublicId: text("source_public_id").notNull(),
    sourceName: text("source_name").notNull(),
    cloneUrl: text("clone_url"),
    canonicalUrl: text("canonical_url"),
    gitRef: text("git_ref"),
    /** A template target: the template, its version and number, the prototype version it came from, and the Git tree id of its exported files. */
    templatePublicId: text("template_public_id"),
    templateVersionPublicId: text("template_version_public_id"),
    templateVersionNumber: integer("template_version_number"),
    prototypeVersionPublicId: text("prototype_version_public_id"),
    contentDigest: text("content_digest"),
    state: text("state", { enum: TARGET_STATES }).notNull().default("pending"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("assessment_targets_position").on(t.assessmentId, t.position),
    uniqueIndex("assessment_targets_source").on(t.assessmentId, t.repositorySourceId),
    index("assessment_targets_repository_source").on(t.repositorySourceId),
    check("assessment_targets_public_id", sql`${t.publicId} GLOB 'tgt_*'`),
    check("assessment_targets_position_range", sql`${t.position} >= 0`),
    check("assessment_targets_state", sql.raw(`state IN (${sqlList(TARGET_STATES)})`)),
    // A failure code is recorded exactly when the target failed.
    check("assessment_targets_failure_code", sql`(${t.failureCode} IS NOT NULL) = (${t.state} = 'failed')`),
    check("assessment_targets_kind", sql.raw(`kind IN (${sqlList(TARGET_KINDS)})`)),
    // A source target names its catalog source and clone URLs. A template target names the prototype version and the
    // Git tree id of its exported files, and its template version once one exists: the first acceptance assesses it before.
    check(
      "assessment_targets_kind_columns",
      sql`(${t.kind} = 'source' AND ${t.repositorySourceId} IS NOT NULL AND ${t.cloneUrl} IS NOT NULL AND ${t.canonicalUrl} IS NOT NULL
          AND ${t.templatePublicId} IS NULL AND ${t.templateVersionPublicId} IS NULL AND ${t.templateVersionNumber} IS NULL AND ${t.prototypeVersionPublicId} IS NULL AND ${t.contentDigest} IS NULL)
        OR (${t.kind} = 'template' AND ${t.repositorySourceId} IS NULL AND ${t.cloneUrl} IS NULL AND ${t.canonicalUrl} IS NULL AND ${t.gitRef} IS NULL
          AND ${t.prototypeVersionPublicId} IS NOT NULL AND ${t.prototypeVersionPublicId} GLOB 'ver_*'
          AND ${t.contentDigest} IS NOT NULL AND length(${t.contentDigest}) = 40 AND ${t.contentDigest} NOT GLOB '*[^0-9a-f]*'
          AND ((${t.templatePublicId} IS NULL AND ${t.templateVersionPublicId} IS NULL AND ${t.templateVersionNumber} IS NULL)
            OR (${t.templatePublicId} IS NOT NULL AND ${t.templateVersionPublicId} IS NOT NULL AND ${t.templateVersionNumber} IS NOT NULL
              AND ${t.templatePublicId} GLOB 'ptp_*' AND ${t.templateVersionPublicId} GLOB 'ptv_*' AND ${t.templateVersionNumber} >= 1)))`,
    ),
  ],
);

/**
 * The commit a target was pinned to after successful acquisition. The
 * internal ref keeps the commit reachable in the managed object database.
 */
export const sourceSnapshots = sqliteTable(
  "source_snapshots",
  {
    id: id(),
    publicId: publicId(),
    assessmentTargetId: integer("assessment_target_id")
      .notNull()
      .unique()
      .references(() => assessmentTargets.id, { onDelete: "restrict" }),
    /** Null for a template target's stored files. */
    repositorySourceId: integer("repository_source_id").references(() => repositorySources.id, { onDelete: "restrict" }),
    /** The pinned commit; null for stored files, which have only a tree. */
    commitSha: text("commit_sha"),
    /** The commit's tree, or the stored files' content digest. */
    treeSha: text("tree_sha").notNull(),
    refKind: text("ref_kind", { enum: REF_KINDS }).notNull(),
    resolvedRef: text("resolved_ref").notNull(),
    internalRef: text("internal_ref").notNull().unique(),
    acquisitionMetadata: text("acquisition_metadata").notNull(),
    acquiredAt: timestamp("acquired_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("source_snapshots_commit").on(t.commitSha),
    index("source_snapshots_repository_source").on(t.repositorySourceId),
    check("source_snapshots_public_id", sql`${t.publicId} GLOB 'snp_*'`),
    check(
      "source_snapshots_object_ids",
      sql`(${t.commitSha} IS NULL OR (length(${t.commitSha}) = 40 AND ${t.commitSha} NOT GLOB '*[^0-9a-f]*')) AND length(${t.treeSha}) = 40 AND ${t.treeSha} NOT GLOB '*[^0-9a-f]*'`,
    ),
    // Stored files have no commit and no catalog source; everything else has both.
    check("source_snapshots_stored_files", sql`(${t.refKind} = 'stored_files') = (${t.commitSha} IS NULL) AND (${t.commitSha} IS NULL) = (${t.repositorySourceId} IS NULL)`),
    check("source_snapshots_ref_kind", sql.raw(`ref_kind IN (${sqlList(REF_KINDS)})`)),
    check("source_snapshots_internal_ref", sql`${t.internalRef} = 'refs/fabricate/snapshots/' || ${t.publicId}`),
  ],
);

/**
 * A template target's exported files, written with the target when the Run
 * started (converge-templates-and-prototypes, design decision 2). Only the
 * removed Prototypes started such Runs; their rows stay so earlier evidence
 * stays resolvable. `files` is canonical JSON of path to UTF-8 content;
 * `digest` is their Git tree id, the target's content digest.
 */
export const storedFileSets = sqliteTable(
  "stored_file_sets",
  {
    id: id(),
    assessmentTargetId: integer("assessment_target_id")
      .notNull()
      .unique()
      .references(() => assessmentTargets.id, { onDelete: "restrict" }),
    digest: text("digest").notNull(),
    files: text("files").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("stored_file_sets_digest", sql`length(${t.digest}) = 40 AND ${t.digest} NOT GLOB '*[^0-9a-f]*'`),
    check("stored_file_sets_files", sql`json_valid(${t.files}) AND json_type(${t.files}) = 'object'`),
  ],
);
