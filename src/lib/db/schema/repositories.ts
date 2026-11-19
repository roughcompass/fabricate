import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, id, lockVersion, publicId, timestamp, updatedAt } from "./columns";
import { surveys } from "./surveys";

/**
 * A Repository: a clonable Git repository, one per canonical clone URL among
 * those not deleted. Deleting one is permanent and removes it from the
 * Repositories, but the row stays as a tombstone: historical Run targets and
 * Profiles keep pointing at it and keep their own copy of what they surveyed.
 */
export const repositories = sqliteTable(
  "repository_sources",
  {
    id: id(),
    publicId: publicId(),
    name: text("name").notNull(),
    cloneUrl: text("clone_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    gitRef: text("git_ref"),
    /** The commit its configured reference named when it was last resolved, and when (unify-surveys, decision 4). */
    configuredCommit: text("configured_commit"),
    configuredResolvedAt: timestamp("configured_resolved_at"),
    /** Its current Profile's survey: the newest successful survey of the commit its configured reference last named, or the one before while that commit has none. */
    currentSurveyId: integer("current_survey_id").references((): AnySQLiteColumn => surveys.id, { onDelete: "restrict" }),
    /** When it was deleted; null while it's registered. */
    deletedAt: timestamp("deleted_at"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("repository_sources_canonical_url").on(t.canonicalUrl).where(sql`${t.deletedAt} IS NULL`),
    check("repository_sources_public_id", sql`${t.publicId} GLOB 'src_*'`),
    check("repository_sources_name", sql`length(trim(${t.name})) BETWEEN 1 AND 100`),
    check("repository_sources_urls", sql`length(${t.cloneUrl}) > 0 AND length(${t.canonicalUrl}) > 0`),
    check("repository_sources_git_ref", sql`${t.gitRef} IS NULL OR length(${t.gitRef}) BETWEEN 1 AND 255`),
  ],
);
