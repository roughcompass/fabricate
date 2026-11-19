import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assessments } from "./assessments";
import { repositories } from "./repositories";
import { surveys } from "./surveys";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp, updatedAt } from "./columns";

export const RUN_STATES = ["queued", "acquiring", "analyzing", "finalizing", "complete", "complete_with_issues", "failed", "canceled"] as const;
export type RunState = (typeof RUN_STATES)[number];

export const TARGET_STATES = ["pending", "acquiring", "analyzing", "complete", "failed", "canceled"] as const;
export type TargetState = (typeof TARGET_STATES)[number];

export const REF_KINDS = ["default_branch", "branch", "tag", "commit"] as const;
export type RefKind = (typeof REF_KINDS)[number];

/**
 * One static Run over an immutable scope snapshot. Standard selections are
 * deliberately not part of a Run, so one Run can
 * be evaluated against any number of later Release selections.
 */
export const runs = sqliteTable(
  "assessments",
  {
    id: id(),
    publicId: publicId(),
    assessmentId: integer("initiative_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    state: text("state", { enum: RUN_STATES }).notNull().default("queued"),
    launchToken: text("launch_token").notNull().unique(),
    surveyorRelease: text("detector_release").notNull(),
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
    index("assessments_initiative").on(t.assessmentId),
    check("assessments_public_id", sql`${t.publicId} GLOB 'asm_*'`),
    check("assessments_state", sql.raw(`state IN (${sqlList(RUN_STATES)})`)),
    check("assessments_configuration_digest", sql`length(${t.configurationDigest}) = 64`),
    check("assessments_schema_versions", sql`${t.profileSchemaVersion} > 0 AND ${t.relationshipSchemaVersion} > 0`),
  ],
);

/**
 * One immutable scope entry. Repository identity, name, clone URL, and configured
 * reference are copied from the Repository when the Run starts, so later
 * edits to the Repository affect only future Runs.
 */
export const runTargets = sqliteTable(
  "assessment_targets",
  {
    id: id(),
    publicId: publicId(),
    runId: integer("assessment_id")
      .notNull()
      .references(() => runs.id, { onDelete: "restrict" }),
    repositoryId: integer("repository_source_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    repositoryPublicId: text("source_public_id").notNull(),
    repositoryName: text("source_name").notNull(),
    cloneUrl: text("clone_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    gitRef: text("git_ref"),
    /** How its reference resolved, once it did: the kind, the resolved ref, and when. */
    refKind: text("ref_kind", { enum: REF_KINDS }),
    resolvedRef: text("resolved_ref"),
    resolvedAt: timestamp("resolved_at"),
    /** The survey of its commit, which it waits on and whose Profile it uses. */
    surveyId: integer("survey_id").references((): AnySQLiteColumn => surveys.id, { onDelete: "restrict" }),
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
    uniqueIndex("assessment_targets_position").on(t.runId, t.position),
    uniqueIndex("assessment_targets_source").on(t.runId, t.repositoryId),
    index("assessment_targets_repository_source").on(t.repositoryId),
    index("assessment_targets_survey").on(t.surveyId),
    check("assessment_targets_public_id", sql`${t.publicId} GLOB 'tgt_*'`),
    check("assessment_targets_position_range", sql`${t.position} >= 0`),
    check("assessment_targets_state", sql.raw(`state IN (${sqlList(TARGET_STATES)})`)),
    // A failure code is recorded exactly when the target failed.
    check("assessment_targets_failure_code", sql`(${t.failureCode} IS NOT NULL) = (${t.state} = 'failed')`),
    check("assessment_targets_ref_kind", sql.raw(`ref_kind IS NULL OR ref_kind IN (${sqlList(REF_KINDS)})`)),
    // A target resolves its reference before it waits on a survey, and completes only with one.
    check("assessment_targets_resolution", sql`(${t.refKind} IS NULL) = (${t.resolvedRef} IS NULL) AND (${t.refKind} IS NULL) = (${t.resolvedAt} IS NULL) AND (${t.surveyId} IS NULL OR ${t.refKind} IS NOT NULL)`),
    check("assessment_targets_complete_survey", sql`${t.state} <> 'complete' OR ${t.surveyId} IS NOT NULL`),
  ],
);

