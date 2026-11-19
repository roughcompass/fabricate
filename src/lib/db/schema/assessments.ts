import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { initiatives, repositorySources } from "./catalog";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp, updatedAt } from "./columns";

export const ASSESSMENT_STATES = ["queued", "acquiring", "analyzing", "finalizing", "complete", "complete_with_issues", "failed", "canceled"] as const;
export type AssessmentState = (typeof ASSESSMENT_STATES)[number];

export const TARGET_STATES = ["pending", "acquiring", "analyzing", "complete", "failed", "canceled"] as const;
export type TargetState = (typeof TARGET_STATES)[number];

export const REF_KINDS = ["default_branch", "branch", "tag", "commit"] as const;
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
    repositorySourceId: integer("repository_source_id")
      .notNull()
      .references(() => repositorySources.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    sourcePublicId: text("source_public_id").notNull(),
    sourceName: text("source_name").notNull(),
    cloneUrl: text("clone_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    gitRef: text("git_ref"),
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
    repositorySourceId: integer("repository_source_id")
      .notNull()
      .references(() => repositorySources.id, { onDelete: "restrict" }),
    commitSha: text("commit_sha").notNull(),
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
      sql`length(${t.commitSha}) = 40 AND ${t.commitSha} NOT GLOB '*[^0-9a-f]*' AND length(${t.treeSha}) = 40 AND ${t.treeSha} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check("source_snapshots_ref_kind", sql.raw(`ref_kind IN (${sqlList(REF_KINDS)})`)),
    check("source_snapshots_internal_ref", sql`${t.internalRef} = 'refs/fabricate/snapshots/' || ${t.publicId}`),
  ],
);

