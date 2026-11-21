import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { repositories } from "./repositories";
import { createdAt, id, publicId, sqlList, timestamp, updatedAt } from "./columns";
import { surveys } from "./surveys";
import type { JsonObject } from "@repo-facts/contract";

/*
 * Repository previews (openspec add-repository-previews, docs/previews.md).
 * A preparation decides which packages of one pinned commit can be previewed;
 * a preview build is one Repository, commit, and package, with its latest
 * attempt tracked apart from the output it last published.
 */

/** How the operator named the commit: a remote branch or tag, or a commit SHA. */
export const PREVIEW_REF_KINDS = ["branch", "tag", "commit"] as const;
export type PreviewRefKind = (typeof PREVIEW_REF_KINDS)[number];

/** Profiling, then Ready (some package qualifies), Refused (none does), or Failed (it couldn't be decided). */
export const PREPARATION_STATES = ["profiling", "ready", "refused", "failed"] as const;
export type PreparationState = (typeof PREPARATION_STATES)[number];

/** The latest build attempt's state (design decision 1). */
export const ATTEMPT_STATES = ["queued", "building", "ready", "failed"] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

/** How a published artifact is shown: as its own page, or mounted in the Frontend Registry's host (design decision 7). */
export const ARTIFACT_LAYOUTS = ["standalone", "module_federation", "single_spa"] as const;
export type ArtifactLayout = (typeof ARTIFACT_LAYOUTS)[number];

const commitCheck = (column: AnySQLiteColumn) => sql`length(${column}) = 40 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
const digestCheck = (column: AnySQLiteColumn) => sql`${column} IS NULL OR (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*')`;
/** A ref is named for a branch or tag, and never for a commit, which its SHA identifies. */
const refCheck = (name: AnySQLiteColumn, kind: AnySQLiteColumn) =>
  sql`${kind} IN (${sql.raw(sqlList(PREVIEW_REF_KINDS))}) AND (${kind} = 'commit') = (${name} IS NULL) AND (${name} IS NULL OR length(${name}) BETWEEN 1 AND 255)`;

/**
 * One pinned commit of a Repository, prepared for previews before any build
 * exists (design decision 3): decided from its commit's survey, which is
 * among the Repository's versions, and evaluated per package. One per
 * Repository and commit,
 * so two refs at one commit share it; the ref is the one first prepared.
 */
export const previewPreparations = sqliteTable(
  "preview_preparations",
  {
    id: id(),
    publicId: publicId(),
    repositoryId: integer("repository_source_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "restrict" }),
    commitSha: text("commit_sha").notNull(),
    refName: text("ref_name"),
    refKind: text("ref_kind", { enum: PREVIEW_REF_KINDS }).notNull(),
    state: text("state", { enum: PREPARATION_STATES }).notNull().default("profiling"),
    /** The survey of this commit under the recipe current when it was prepared, whose Profile decides (unify-surveys, decision 6). */
    surveyId: integer("survey_id").references(() => surveys.id, { onDelete: "restrict" }),
    profileDigest: text("profile_digest"),
    /** Every package's verdict: its conditions with their deciding facts, and what a build needs when it qualifies. */
    packages: text("packages", { mode: "json" }).$type<JsonObject[]>(),
    /** Why the commit is Not previewable: each failed condition, with its facts and evidence. */
    refusal: text("refusal", { mode: "json" }).$type<JsonObject>(),
    /** Why preparation stopped before a decision. */
    failure: text("failure"),
    /** When preparation last started, so a retry queues a job of its own. */
    requestedAt: timestamp("requested_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    uniqueIndex("preview_preparations_commit").on(t.repositoryId, t.commitSha),
    check("preview_preparations_public_id", sql`${t.publicId} GLOB 'ppr_*'`),
    check("preview_preparations_commit_sha", commitCheck(t.commitSha)),
    check("preview_preparations_ref", refCheck(t.refName, t.refKind)),
    check("preview_preparations_state", sql.raw(`state IN (${sqlList(PREPARATION_STATES)})`)),
    check("preview_preparations_profile_digest", digestCheck(t.profileDigest)),
    check("preview_preparations_packages", sql`${t.packages} IS NULL OR (json_valid(${t.packages}) AND json_type(${t.packages}) = 'array')`),
    check("preview_preparations_refusal", sql`${t.refusal} IS NULL OR (json_valid(${t.refusal}) AND json_type(${t.refusal}) = 'object')`),
    // Profiling holds no outcome; a decision has exactly one Profile, its verdicts, and a refusal only when refused; a failure says why.
    check("preview_preparations_profiling", sql`${t.state} <> 'profiling' OR (${t.packages} IS NULL AND ${t.refusal} IS NULL AND ${t.failure} IS NULL AND ${t.finishedAt} IS NULL)`),
    check(
      "preview_preparations_decided",
      sql`${t.state} NOT IN ('ready', 'refused') OR (${t.profileDigest} IS NOT NULL AND ${t.surveyId} IS NOT NULL AND ${t.packages} IS NOT NULL AND ${t.failure} IS NULL AND ${t.finishedAt} IS NOT NULL AND (${t.state} = 'refused') = (${t.refusal} IS NOT NULL))`,
    ),
    check("preview_preparations_failed", sql`${t.state} <> 'failed' OR (${t.failure} IS NOT NULL AND length(${t.failure}) > 0 AND ${t.refusal} IS NULL AND ${t.finishedAt} IS NOT NULL)`),
  ],
);

/**
 * One preview: a Repository, commit, and package, unique among undeleted
 * rows, whose public id fixes its path `/previews/<public_id>/` before the
 * first build (design decision 1). The latest attempt (Queued, Building,
 * Ready, or Failed) is tracked apart from the artifact it last published,
 * which a rebuild leaves in place until a newer attempt publishes. A deleted
 * preview never changes again, so a late attempt can't publish or restore it.
 */
export const previewBuilds = sqliteTable(
  "preview_builds",
  {
    id: id(),
    publicId: publicId(),
    repositoryId: integer("repository_source_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "restrict" }),
    /** The preparation that decided the package qualifies, with the Profile it decided from. */
    preparationId: integer("preparation_id")
      .notNull()
      .references(() => previewPreparations.id, { onDelete: "restrict" }),
    commitSha: text("commit_sha").notNull(),
    /** The package's directory relative to the repository root, `.` for the root. */
    packageDir: text("package_dir").notNull(),
    refName: text("ref_name"),
    refKind: text("ref_kind", { enum: PREVIEW_REF_KINDS }).notNull(),
    profileDigest: text("profile_digest").notNull(),
    /** The package's verdict from the preparation: its deciding facts with their evidence, and its build plan. */
    decidingFacts: text("deciding_facts", { mode: "json" }).$type<JsonObject>().notNull(),
    /** The latest attempt, numbered from 1; a rebuild starts the next. */
    attempt: integer("attempt").notNull().default(1),
    attemptState: text("attempt_state", { enum: ATTEMPT_STATES }).notNull().default("queued"),
    /** Which worker claim runs the attempt, so only that claim can publish (design decision 1). */
    attemptClaim: text("attempt_claim"),
    attemptReason: text("attempt_reason"),
    /** The attempt's log, relative to the preview's storage directory. */
    attemptLog: text("attempt_log"),
    attemptStartedAt: timestamp("attempt_started_at"),
    /** The published output directory, relative to the preview's storage directory; null until an attempt publishes. */
    artifact: text("artifact"),
    artifactAttempt: integer("artifact_attempt"),
    artifactLayout: text("artifact_layout", { enum: ARTIFACT_LAYOUTS }),
    /** The artifact's entry metadata: its index.html or host entry and format, and whether serving rebases its HTML. */
    artifactEntry: text("artifact_entry", { mode: "json" }).$type<JsonObject>(),
    outputBytes: integer("output_bytes"),
    buildMs: integer("build_ms"),
    nodeVersion: text("node_version"),
    packageManager: text("package_manager"),
    lastOpenedAt: timestamp("last_opened_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp("finished_at"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("preview_builds_identity").on(t.repositoryId, t.commitSha, t.packageDir).where(sql`${t.deletedAt} IS NULL`),
    index("preview_builds_source").on(t.repositoryId, t.createdAt),
    check("preview_builds_public_id", sql`${t.publicId} GLOB 'pvw_*'`),
    check("preview_builds_commit_sha", commitCheck(t.commitSha)),
    // `.` or a relative path of plain segments: no leading, trailing, or doubled slash, and no `.` or `..` segment.
    check(
      "preview_builds_package_dir",
      sql`${t.packageDir} = '.' OR (length(${t.packageDir}) BETWEEN 1 AND 1024 AND ${t.packageDir} NOT GLOB '/*' AND ${t.packageDir} NOT GLOB '*/' AND ${t.packageDir} NOT GLOB '*//*' AND ('/' || ${t.packageDir} || '/') NOT GLOB '*/./*' AND ('/' || ${t.packageDir} || '/') NOT GLOB '*/../*')`,
    ),
    check("preview_builds_ref", refCheck(t.refName, t.refKind)),
    check("preview_builds_profile_digest", sql`length(${t.profileDigest}) = 64 AND ${t.profileDigest} NOT GLOB '*[^0-9a-f]*'`),
    check("preview_builds_deciding_facts", sql`json_valid(${t.decidingFacts}) AND json_type(${t.decidingFacts}) = 'object'`),
    check("preview_builds_attempt", sql`${t.attempt} >= 1`),
    check("preview_builds_attempt_state", sql.raw(`attempt_state IN (${sqlList(ATTEMPT_STATES)})`)),
    check("preview_builds_attempt_reason", sql`(${t.attemptState} = 'failed') = (${t.attemptReason} IS NOT NULL)`),
    check("preview_builds_artifact_layout", sql.raw(`artifact_layout IS NULL OR artifact_layout IN (${sqlList(ARTIFACT_LAYOUTS)})`)),
    // An artifact is published whole: its directory, attempt, layout, entry, size, and how it was built.
    check(
      "preview_builds_artifact",
      sql`(${t.artifact} IS NULL) = (${t.artifactAttempt} IS NULL) AND (${t.artifact} IS NULL) = (${t.artifactLayout} IS NULL) AND (${t.artifact} IS NULL) = (${t.artifactEntry} IS NULL) AND (${t.artifact} IS NULL) = (${t.outputBytes} IS NULL) AND (${t.artifact} IS NULL) = (${t.buildMs} IS NULL) AND (${t.artifact} IS NULL) = (${t.nodeVersion} IS NULL) AND (${t.artifact} IS NULL) = (${t.packageManager} IS NULL)`,
    ),
    check("preview_builds_artifact_attempt", sql`${t.artifactAttempt} IS NULL OR ${t.artifactAttempt} BETWEEN 1 AND ${t.attempt}`),
    check("preview_builds_artifact_entry", sql`${t.artifactEntry} IS NULL OR (json_valid(${t.artifactEntry}) AND json_type(${t.artifactEntry}) = 'object')`),
    check("preview_builds_sizes", sql`(${t.outputBytes} IS NULL OR ${t.outputBytes} >= 0) AND (${t.buildMs} IS NULL OR ${t.buildMs} >= 0)`),
  ],
);

/** Pending until the capture runs, then Ready with its images, or Unavailable with the reason (add-applications, design decision 4). */
export const SCREENSHOT_STATES = ["pending", "ready", "unavailable"] as const;
export type ScreenshotState = (typeof SCREENSHOT_STATES)[number];

/**
 * The screenshot of a preview's published artifact, taken for applications
 * (add-applications, design decision 4): one per preview, retaken whenever
 * a new artifact publishes. Kept apart from preview_builds, whose rows the
 * build pipeline's triggers guard, so a capture never touches a build. Its
 * images sit beside the artifact, under screenshots/ in the preview's
 * storage directory, and are served only through application routes.
 */
export const previewScreenshots = sqliteTable(
  "preview_screenshots",
  {
    id: id(),
    previewId: integer("preview_id")
      .notNull()
      .unique()
      .references(() => previewBuilds.id, { onDelete: "restrict" }),
    /** The published artifact it shows, as preview_builds.artifact named it when it was requested. */
    artifact: text("artifact").notNull(),
    state: text("state", { enum: SCREENSHOT_STATES }).notNull().default("pending"),
    /** Its images' directory, relative to the preview's storage directory, once captured. */
    directory: text("directory"),
    /** Why it couldn't be captured. */
    reason: text("reason"),
    /** When the capture was last requested, so a new request queues a job of its own. */
    requestedAt: timestamp("requested_at").notNull(),
    capturedAt: timestamp("captured_at"),
    // The mock set it was captured with, as it was then (add-mock-sets, design decision 11). Plain
    // columns with no reference, so the record outlives the set, and adding them rebuilds nothing.
    mockSetPublicId: text("mock_set_public_id"),
    mockSetName: text("mock_set_name"),
    mockSetRevision: integer("mock_set_revision"),
    /** How many distinct API calls failed when it was captured; screenshot_failed_calls keeps up to 50 of them. */
    failedCalls: integer("failed_calls").notNull().default(0),
    /** When an operator dismissed the failed-calls alert for this build. */
    failuresDismissedAt: timestamp("failures_dismissed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("preview_screenshots_state", sql.raw(`state IN (${sqlList(SCREENSHOT_STATES)})`)),
    check("preview_screenshots_artifact", sql`length(${t.artifact}) BETWEEN 1 AND 255`),
    check("preview_screenshots_ready", sql`(${t.state} = 'ready') = (${t.directory} IS NOT NULL AND ${t.capturedAt} IS NOT NULL)`),
    check("preview_screenshots_unavailable", sql`(${t.state} = 'unavailable') = (${t.reason} IS NOT NULL AND length(${t.reason}) > 0)`),
  ],
);

/**
 * A remote enrolled for previews by creating an application from it, after
 * the operator confirmed they trust its code to be built and served
 * (add-applications, applications/onboarding spec). One per canonical remote
 * identity, as previews.trustedSources lists them; a remote is enrolled when
 * either lists it. It records when, and which application, enrolled it, by
 * the application's id and name then, and stays when that application, or
 * every application of the remote, is deleted.
 */
export const previewEnrollments = sqliteTable(
  "preview_enrollments",
  {
    id: id(),
    canonicalUrl: text("canonical_url").notNull().unique(),
    applicationPublicId: text("application_public_id").notNull(),
    applicationName: text("application_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("preview_enrollments_canonical_url", sql`length(${t.canonicalUrl}) > 0`),
    check("preview_enrollments_application", sql`${t.applicationPublicId} GLOB 'app_*' AND length(trim(${t.applicationName})) BETWEEN 1 AND 80`),
  ],
);
