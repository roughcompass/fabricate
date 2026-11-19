import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
