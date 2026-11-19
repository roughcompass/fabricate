import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { runs } from "./runs";
import { repositorySources } from "./catalog";
import { createdAt, id, publicId, sqlList, timestamp } from "./columns";

/** Why a survey ran (docs/profiling.md): the Repository was added or edited, its reference moved, the recipe changed, an operator asked, a Run needed it, or a preview did. */
export const SURVEY_TRIGGERS = ["added", "edited", "commit", "recipe", "manual", "run", "preview"] as const;
export type SurveyTrigger = (typeof SURVEY_TRIGGERS)[number];

export const SURVEY_STATES = ["queued", "running", "succeeded", "failed"] as const;
export type SurveyState = (typeof SURVEY_STATES)[number];

const objectId = (column: unknown) => sql`length(${column}) = 40 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

/**
 * One Surveyor run of one Repository's commit under one recipe: the Surveyor
 * release, configuration digest, and profile schema version (unify-surveys,
 * design decision 1). Runs, background surveying, and previews share it, so
 * at most one exists per key; a failed one is retried in place. Its number is
 * its version within the Repository, stored and never reused. Its tree and
 * the internal ref that keeps its commit in the mirror are set once, when the
 * commit is pinned; a survey converted from a preview's own Profile has no
 * recorded tree. Surveys are never deleted.
 */
export const surveys = sqliteTable(
  "surveys",
  {
    id: id(),
    publicId: publicId(),
    repositorySourceId: integer("repository_source_id")
      .notNull()
      .references(() => repositorySources.id, { onDelete: "restrict" }),
    number: integer("number").notNull(),
    commitSha: text("commit_sha").notNull(),
    treeSha: text("tree_sha"),
    /** The ref that keeps its commit in the Repository's mirror: its own under refs/fabricate/snapshots/, or the preview pin of the commit. */
    internalRef: text("internal_ref"),
    /** The Git reference the commit was first resolved from, or the commit itself when one was asked for. */
    reference: text("reference").notNull(),
    /** Whether that reference was the Repository's configured one, which alone makes a survey current. */
    fromConfiguredReference: integer("from_configured_reference", { mode: "boolean" }).notNull(),
    resolvedAt: timestamp("resolved_at").notNull(),
    surveyorRelease: text("surveyor_release").notNull(),
    configurationDigest: text("configuration_digest").notNull(),
    profileSchemaVersion: integer("profile_schema_version").notNull(),
    state: text("state", { enum: SURVEY_STATES }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    /** The latest failure, kept through a retry until the survey succeeds. */
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    trigger: text("trigger", { enum: SURVEY_TRIGGERS }).notNull(),
    requestedByRunId: integer("requested_by_assessment_id").references(() => runs.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    uniqueIndex("surveys_key").on(t.repositorySourceId, t.commitSha, t.surveyorRelease, t.configurationDigest, t.profileSchemaVersion),
    uniqueIndex("surveys_number").on(t.repositorySourceId, t.number),
    index("surveys_state").on(t.state),
    check("surveys_public_id", sql`${t.publicId} GLOB 'srv_*'`),
    check("surveys_number_range", sql`${t.number} >= 1`),
    check("surveys_commit_sha", objectId(t.commitSha)),
    check("surveys_tree_sha", sql`${t.treeSha} IS NULL OR (${objectId(t.treeSha)})`),
    check("surveys_internal_ref", sql`${t.internalRef} IS NULL OR ${t.internalRef} GLOB 'refs/fabricate/snapshots/*' OR ${t.internalRef} = 'refs/fabricate/previews/' || ${t.commitSha}`),
    check("surveys_reference", sql`length(${t.reference}) BETWEEN 1 AND 255`),
    check("surveys_configuration_digest", sql`length(${t.configurationDigest}) = 64`),
    check("surveys_profile_schema_version", sql`${t.profileSchemaVersion} >= 1`),
    check("surveys_state", sql.raw(`state IN (${sqlList(SURVEY_STATES)})`)),
    check("surveys_trigger", sql.raw(`trigger IN (${sqlList(SURVEY_TRIGGERS)})`)),
    check("surveys_attempts", sql`${t.attempts} >= 0`),
    check("surveys_failure", sql`${t.state} <> 'failed' OR ${t.failureCode} IS NOT NULL`),
    check("surveys_finished", sql`(${t.finishedAt} IS NOT NULL) = (${t.state} IN ('succeeded', 'failed'))`),
    // A Profile is only ever written from a pinned commit.
    check("surveys_pinned", sql`${t.state} <> 'succeeded' OR ${t.internalRef} IS NOT NULL`),
  ],
);
