import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { runTargets, runs } from "./runs";
import { assessments } from "./assessments";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp, updatedAt } from "./columns";
import { standardReleases } from "./standards";

export const EVALUATION_STATES = ["queued", "evaluating", "finalizing", "complete", "failed"] as const;
export type EvaluationState = (typeof EVALUATION_STATES)[number];

export const EVALUATION_RELEASE_STATES = ["pending", "evaluating", "complete", "failed"] as const;
export type EvaluationReleaseState = (typeof EVALUATION_RELEASE_STATES)[number];

export const OUTCOMES = ["meets", "gap", "indeterminate", "not_applicable"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SUBJECT_TYPES = ["repository", "relationship_map"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/**
 * A diagnostic comparison of one immutable Assessment with the published
 * Releases an Initiative had selected when the Evaluation started.
 */
export const evaluations = sqliteTable(
  "evaluations",
  {
    id: id(),
    publicId: publicId(),
    assessmentId: integer("initiative_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    runId: integer("assessment_id")
      .notNull()
      .references(() => runs.id, { onDelete: "restrict" }),
    state: text("state", { enum: EVALUATION_STATES }).notNull().default("queued"),
    launchToken: text("launch_token").notNull().unique(),
    evaluatorVersion: text("evaluator_version").notNull(),
    configuration: text("configuration").notNull(),
    configurationDigest: text("configuration_digest").notNull(),
    profileSchemaVersion: integer("profile_schema_version").notNull(),
    relationshipSchemaVersion: integer("relationship_schema_version").notNull(),
    coverageGaps: text("coverage_gaps").notNull(),
    summary: text("summary"),
    resultDigest: text("result_digest"),
    failureReason: text("failure_reason"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("evaluations_initiative").on(t.assessmentId),
    index("evaluations_assessment").on(t.runId),
    check("evaluations_public_id", sql`${t.publicId} GLOB 'evl_*'`),
    check("evaluations_state", sql.raw(`state IN (${sqlList(EVALUATION_STATES)})`)),
    check("evaluations_configuration_digest", sql`length(${t.configurationDigest}) = 64`),
    check("evaluations_coverage_gaps", sql`json_valid(${t.coverageGaps}) AND json_type(${t.coverageGaps}) = 'array'`),
    check("evaluations_complete_result", sql`${t.state} <> 'complete' OR (${t.summary} IS NOT NULL AND length(${t.resultDigest}) = 64)`),
  ],
);

/** One Release pinned by identity and digest for one Evaluation. */
export const evaluationReleases = sqliteTable(
  "evaluation_releases",
  {
    id: id(),
    evaluationId: integer("evaluation_id")
      .notNull()
      .references(() => evaluations.id, { onDelete: "restrict" }),
    standardReleaseId: integer("standard_release_id")
      .notNull()
      .references(() => standardReleases.id, { onDelete: "restrict" }),
    releaseDigest: text("release_digest").notNull(),
    position: integer("position").notNull(),
    state: text("state", { enum: EVALUATION_RELEASE_STATES }).notNull().default("pending"),
    failureReason: text("failure_reason"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("evaluation_releases_release").on(t.evaluationId, t.standardReleaseId),
    uniqueIndex("evaluation_releases_position").on(t.evaluationId, t.position),
    index("evaluation_releases_standard_release").on(t.standardReleaseId),
    check("evaluation_releases_state", sql.raw(`state IN (${sqlList(EVALUATION_RELEASE_STATES)})`)),
    check("evaluation_releases_digest", sql`length(${t.releaseDigest}) = 64`),
    check("evaluation_releases_position_range", sql`${t.position} >= 0`),
  ],
);

/** One immutable Control-and-subject result. Details live in the document. */
export const findings = sqliteTable(
  "findings",
  {
    id: id(),
    publicId: publicId(),
    evaluationId: integer("evaluation_id")
      .notNull()
      .references(() => evaluations.id, { onDelete: "restrict" }),
    evaluationReleaseId: integer("evaluation_release_id")
      .notNull()
      .references(() => evaluationReleases.id, { onDelete: "restrict" }),
    standardReleaseId: integer("standard_release_id")
      .notNull()
      .references(() => standardReleases.id, { onDelete: "restrict" }),
    runTargetId: integer("assessment_target_id").references(() => runTargets.id, { onDelete: "restrict" }),
    controlKey: text("control_key").notNull(),
    subjectType: text("subject_type", { enum: SUBJECT_TYPES }).notNull(),
    subjectKey: text("subject_key").notNull(),
    outcome: text("outcome", { enum: OUTCOMES }).notNull(),
    severity: text("severity", { enum: SEVERITIES }).notNull(),
    position: integer("position").notNull(),
    documentSchemaVersion: integer("document_schema_version").notNull(),
    document: text("document").notNull(),
    digest: text("digest").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("findings_control_subject").on(t.evaluationReleaseId, t.controlKey, t.subjectKey),
    index("findings_evaluation_outcome").on(t.evaluationId, t.outcome),
    index("findings_evaluation_release").on(t.evaluationReleaseId, t.position),
    index("findings_standard_release").on(t.standardReleaseId),
    index("findings_control").on(t.controlKey),
    index("findings_subject").on(t.subjectKey),
    index("findings_severity").on(t.severity),
    index("findings_assessment_target").on(t.runTargetId),
    check("findings_public_id", sql`${t.publicId} GLOB 'fnd_*'`),
    check("findings_outcome", sql.raw(`outcome IN (${sqlList(OUTCOMES)})`)),
    check("findings_severity_value", sql.raw(`severity IN (${sqlList(SEVERITIES)})`)),
    check("findings_subject_type", sql.raw(`subject_type IN (${sqlList(SUBJECT_TYPES)})`)),
    // Repository Findings name their target; relationship Findings never do.
    check("findings_subject_target", sql`(${t.subjectType} = 'repository') = (${t.runTargetId} IS NOT NULL)`),
    check("findings_digest", sql`length(${t.digest}) = 64`),
    check("findings_document", sql`json_valid(${t.document}) AND json_type(${t.document}) = 'object'`),
  ],
);
