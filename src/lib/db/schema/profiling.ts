import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assessments } from "./assessments";
import { repositorySources } from "./catalog";
import { createdAt, id, sqlList } from "./columns";

/** Why a profile version was queued (docs/profiling.md). `imported` is a Repository added in bulk. */
export const PROFILE_TRIGGERS = ["imported", "added", "edited", "manual", "initial", "commit", "detector"] as const;
export type ProfileTrigger = (typeof PROFILE_TRIGGERS)[number];

/**
 * One profile version of a repository: a Run of the Repository profiling
 * initiative that profiles that repository alone, numbered from 1 per
 * repository. The Run's state is the version's; its Profile, once written,
 * is the version's facts. Versions are never changed or deleted.
 */
export const profileVersions = sqliteTable(
  "profile_versions",
  {
    id: id(),
    repositorySourceId: integer("repository_source_id")
      .notNull()
      .references(() => repositorySources.id, { onDelete: "restrict" }),
    assessmentId: integer("assessment_id")
      .notNull()
      .unique()
      .references(() => assessments.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    trigger: text("trigger", { enum: PROFILE_TRIGGERS }).notNull(),
    /** The commit the scheduled check saw on the repository's reference, when it queued the version; null otherwise. */
    headCommit: text("head_commit"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("profile_versions_number").on(t.repositorySourceId, t.version),
    index("profile_versions_source").on(t.repositorySourceId, t.id),
    check("profile_versions_version", sql`${t.version} >= 1`),
    check("profile_versions_trigger", sql.raw(`trigger IN (${sqlList(PROFILE_TRIGGERS)})`)),
    check("profile_versions_head_commit", sql`${t.headCommit} IS NULL OR (length(${t.headCommit}) = 40 AND ${t.headCommit} NOT GLOB '*[^0-9a-f]*')`),
  ],
);
