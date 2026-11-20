import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JsonObject } from "@repo-facts/contract";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp, updatedAt } from "./columns";
import { previewBuilds, previewPreparations } from "./previews";
import { repositories } from "./repositories";

/*
 * Applications (openspec add-applications, design decision 1): a deployable
 * frontend app built from one Repository's package, tracking one branch. An
 * application is a row that points at repository previews: its current build,
 * the last one that succeeded, and its latest attempt, which a newer commit
 * or a rebuild starts. The latest attempt's outcome is kept here, with its
 * reasons, so a commit refused before any build row exists can still be shown.
 */

/** The latest attempt's outcome: building (preparing or building), ready, failed, or refused as not previewable. */
export const APPLICATION_OUTCOMES = ["building", "ready", "failed", "not_previewable"] as const;
export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number];

/** Addresses under /applications that a slug can't take. */
export const RESERVED_SLUGS = ["new"] as const;

export const applications = sqliteTable(
  "applications",
  {
    id: id(),
    publicId: publicId(),
    /** The address segment, derived from the name when it's created and kept when it's renamed. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** The name trimmed, normalized, and lowercased in code (SQLite's lower() folds only ASCII), so names are unique ignoring case. */
    nameKey: text("name_key").notNull(),
    description: text("description").notNull().default(""),
    repositoryId: integer("repository_source_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "restrict" }),
    /** The package's directory relative to the repository root, `.` for the root. */
    packageDir: text("package_dir").notNull(),
    /** The branch it tracks, qualified: refs/heads/main. */
    trackedRef: text("tracked_ref").notNull(),
    /** Its current build: the last successful build of its tracked branch. */
    currentPreviewId: integer("current_preview_id").references(() => previewBuilds.id, { onDelete: "restrict" }),
    /** Its latest attempt's build, once the commit's preparation started one for its package. */
    latestPreviewId: integer("latest_preview_id").references(() => previewBuilds.id, { onDelete: "restrict" }),
    /** The latest attempt's preparation, which decides whether the commit can be built. */
    latestPreparationId: integer("latest_preparation_id").references(() => previewPreparations.id, { onDelete: "restrict" }),
    /** The commit the latest attempt is for; the automatic check compares the branch's head with it. */
    latestCommitSha: text("latest_commit_sha").notNull(),
    latestOutcome: text("latest_outcome", { enum: APPLICATION_OUTCOMES }).notNull().default("building"),
    /** Why the latest attempt failed or was refused: each reason's text, and the condition it failed when it was refused. */
    latestReasons: text("latest_reasons", { mode: "json" }).$type<JsonObject[]>(),
    /** The package's traits from its latest decided verdict: its browser frameworks, build tool, and package manager. */
    latestFacts: text("latest_facts", { mode: "json" }).$type<JsonObject>(),
    /** When the latest attempt started. */
    latestRequestedAt: timestamp("latest_requested_at").notNull(),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("applications_slug").on(t.slug),
    uniqueIndex("applications_name_key").on(t.nameKey),
    uniqueIndex("applications_package").on(t.repositoryId, t.packageDir),
    index("applications_current_preview").on(t.currentPreviewId),
    index("applications_latest_preview").on(t.latestPreviewId),
    index("applications_latest_preparation").on(t.latestPreparationId),
    check("applications_public_id", sql`${t.publicId} GLOB 'app_*'`),
    // Lowercase letters, digits, and single hyphens between them; never an address /applications already uses.
    check(
      "applications_slug",
      sql`length(${t.slug}) BETWEEN 1 AND 80 AND ${t.slug} NOT GLOB '*[^a-z0-9-]*' AND ${t.slug} NOT GLOB '-*' AND ${t.slug} NOT GLOB '*-' AND ${t.slug} NOT GLOB '*--*' AND ${t.slug} NOT IN (${sql.raw(sqlList(RESERVED_SLUGS))})`,
    ),
    check("applications_name", sql`length(trim(${t.name})) BETWEEN 1 AND 80 AND length(${t.nameKey}) > 0`),
    check("applications_description", sql`length(${t.description}) <= 280`),
    check(
      "applications_package_dir",
      sql`${t.packageDir} = '.' OR (length(${t.packageDir}) BETWEEN 1 AND 1024 AND ${t.packageDir} NOT GLOB '/*' AND ${t.packageDir} NOT GLOB '*/' AND ${t.packageDir} NOT GLOB '*//*' AND ('/' || ${t.packageDir} || '/') NOT GLOB '*/./*' AND ('/' || ${t.packageDir} || '/') NOT GLOB '*/../*')`,
    ),
    check("applications_tracked_ref", sql`${t.trackedRef} GLOB 'refs/heads/?*' AND length(${t.trackedRef}) <= 266`),
    check("applications_latest_commit", sql`length(${t.latestCommitSha}) = 40 AND ${t.latestCommitSha} NOT GLOB '*[^0-9a-f]*'`),
    check("applications_latest_outcome", sql.raw(`latest_outcome IN (${sqlList(APPLICATION_OUTCOMES)})`)),
    // A failure or refusal says why; building and ready carry no reasons.
    check(
      "applications_latest_reasons",
      sql`(${t.latestOutcome} IN ('failed', 'not_previewable')) = (${t.latestReasons} IS NOT NULL) AND (${t.latestReasons} IS NULL OR (json_valid(${t.latestReasons}) AND json_type(${t.latestReasons}) = 'array' AND json_array_length(${t.latestReasons}) > 0))`,
    ),
    check("applications_latest_facts", sql`${t.latestFacts} IS NULL OR (json_valid(${t.latestFacts}) AND json_type(${t.latestFacts}) = 'object')`),
    // A ready outcome has a current build, the latest one.
    check("applications_ready", sql`${t.latestOutcome} <> 'ready' OR (${t.currentPreviewId} IS NOT NULL AND ${t.currentPreviewId} = ${t.latestPreviewId})`),
  ],
);

/*
 * Saved previews (restore-toolbar-tools-and-branch-previews, design decision
 * 1): a branch or tag of an application's remote that an operator keeps built
 * beside the tracked branch. Like an application, a saved preview is a row
 * that points at repository previews, its current build and its latest
 * attempt, with the latest attempt's outcome kept here. Its key names it in
 * addresses, `/run/<slug>@<key>`, and never changes. Deleting the
 * application deletes its saved previews.
 */

/** A saved preview's ref, qualified: refs/heads/… or refs/tags/…. */
export const savedRefCheck = (column: AnySQLiteColumn) => sql`(${column} GLOB 'refs/heads/?*' OR ${column} GLOB 'refs/tags/?*') AND length(${column}) <= 266`;

export const applicationPreviews = sqliteTable(
  "application_previews",
  {
    id: id(),
    publicId: publicId(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    /** Its address segment, from the ref's short name when it's saved: lowercase letters, digits, dots, and single hyphens. */
    key: text("key").notNull(),
    /** The branch or tag, qualified: refs/heads/feature/new-nav or refs/tags/v1.1.0. */
    ref: text("ref").notNull(),
    /** Its current build: the last successful build of its ref. */
    currentPreviewId: integer("current_preview_id").references(() => previewBuilds.id, { onDelete: "restrict" }),
    /** Its latest attempt's build, once the commit's preparation started one for the application's package. */
    latestPreviewId: integer("latest_preview_id").references(() => previewBuilds.id, { onDelete: "restrict" }),
    latestPreparationId: integer("latest_preparation_id").references(() => previewPreparations.id, { onDelete: "restrict" }),
    /** The commit the latest attempt is for; the automatic check compares a saved branch's head with it. */
    latestCommitSha: text("latest_commit_sha").notNull(),
    latestOutcome: text("latest_outcome", { enum: APPLICATION_OUTCOMES }).notNull().default("building"),
    latestReasons: text("latest_reasons", { mode: "json" }).$type<JsonObject[]>(),
    latestFacts: text("latest_facts", { mode: "json" }).$type<JsonObject>(),
    latestRequestedAt: timestamp("latest_requested_at").notNull(),
    /** When the automatic check last found the ref missing from a readable remote; cleared when it returns. */
    remoteMissingAt: timestamp("remote_missing_at"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("application_previews_key").on(t.applicationId, t.key),
    uniqueIndex("application_previews_ref").on(t.applicationId, t.ref),
    index("application_previews_current_preview").on(t.currentPreviewId),
    index("application_previews_latest_preview").on(t.latestPreviewId),
    index("application_previews_latest_preparation").on(t.latestPreparationId),
    check("application_previews_public_id", sql`${t.publicId} GLOB 'apv_*'`),
    // Never `@` or `/`, so `/run/<slug>@<key>` splits at the first `@` and the key is one path segment.
    check(
      "application_previews_key",
      sql`length(${t.key}) BETWEEN 1 AND 60 AND ${t.key} NOT GLOB '*[^a-z0-9.-]*' AND ${t.key} NOT GLOB '-*' AND ${t.key} NOT GLOB '*-' AND ${t.key} NOT GLOB '*--*'`,
    ),
    check("application_previews_ref", savedRefCheck(t.ref)),
    check("application_previews_latest_commit", sql`length(${t.latestCommitSha}) = 40 AND ${t.latestCommitSha} NOT GLOB '*[^0-9a-f]*'`),
    check("application_previews_latest_outcome", sql.raw(`latest_outcome IN (${sqlList(APPLICATION_OUTCOMES)})`)),
    check(
      "application_previews_latest_reasons",
      sql`(${t.latestOutcome} IN ('failed', 'not_previewable')) = (${t.latestReasons} IS NOT NULL) AND (${t.latestReasons} IS NULL OR (json_valid(${t.latestReasons}) AND json_type(${t.latestReasons}) = 'array' AND json_array_length(${t.latestReasons}) > 0))`,
    ),
    check("application_previews_latest_facts", sql`${t.latestFacts} IS NULL OR (json_valid(${t.latestFacts}) AND json_type(${t.latestFacts}) = 'object')`),
    // A ready outcome has a current build, the latest one.
    check("application_previews_ready", sql`${t.latestOutcome} <> 'ready' OR (${t.currentPreviewId} IS NOT NULL AND ${t.currentPreviewId} = ${t.latestPreviewId})`),
  ],
);

/** Why an application started an attempt: its first build, the automatic check, a rebuild, or a branch switch. */
export const BUILD_TRIGGERS = ["first", "automatic", "rebuild", "branch"] as const;
export type BuildTrigger = (typeof BUILD_TRIGGERS)[number];

/** An attempt's outcome in the history: as an application's latest outcome, or replaced by a newer attempt before its commit was built. */
export const BUILD_OUTCOMES = [...APPLICATION_OUTCOMES, "replaced"] as const;
export type BuildOutcome = (typeof BUILD_OUTCOMES)[number];

/**
 * An application's build history (add-applications, catalog spec "The
 * application page lists its builds"): each attempt it started, with the
 * commit and branch, the preparation that decided it, and, once its package's
 * build started, the preview and that preview's attempt. Builds of other
 * refs that preview mode starts aren't the application's, and aren't here.
 * Deleting the application deletes its history.
 */
export const applicationBuilds = sqliteTable(
  "application_builds",
  {
    id: id(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    trigger: text("trigger", { enum: BUILD_TRIGGERS }).notNull(),
    trackedRef: text("tracked_ref").notNull(),
    commitSha: text("commit_sha").notNull(),
    preparationId: integer("preparation_id")
      .notNull()
      .references(() => previewPreparations.id, { onDelete: "restrict" }),
    previewId: integer("preview_id").references(() => previewBuilds.id, { onDelete: "restrict" }),
    /** The preview's attempt this build is, once the package's build started. */
    attempt: integer("attempt"),
    outcome: text("outcome", { enum: BUILD_OUTCOMES }).notNull().default("building"),
    reasons: text("reasons", { mode: "json" }).$type<JsonObject[]>(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("application_builds_application").on(t.applicationId, t.startedAt),
    index("application_builds_preview").on(t.previewId, t.attempt),
    check("application_builds_trigger", sql.raw(`"trigger" IN (${sqlList(BUILD_TRIGGERS)})`)),
    check("application_builds_outcome", sql.raw(`outcome IN (${sqlList(BUILD_OUTCOMES)})`)),
    check("application_builds_commit", sql`length(${t.commitSha}) = 40 AND ${t.commitSha} NOT GLOB '*[^0-9a-f]*'`),
    check("application_builds_tracked_ref", sql`${t.trackedRef} GLOB 'refs/heads/?*'`),
    check("application_builds_attempt", sql`(${t.previewId} IS NULL) = (${t.attempt} IS NULL) AND (${t.attempt} IS NULL OR ${t.attempt} >= 1)`),
    check("application_builds_reasons", sql`(${t.outcome} IN ('failed', 'not_previewable')) = (${t.reasons} IS NOT NULL) AND (${t.reasons} IS NULL OR (json_valid(${t.reasons}) AND json_type(${t.reasons}) = 'array'))`),
    check("application_builds_finished", sql`(${t.outcome} = 'building') = (${t.finishedAt} IS NULL)`),
  ],
);
