import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp, updatedAt } from "./columns";

export const SELECTION_MODES = ["all", "explicit"] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

/**
 * A clonable Git repository in the catalog, one per canonical clone URL among
 * those not deleted. Deleting one is permanent and leaves the catalog, but the
 * row stays as a tombstone: historical assessment targets and profiles keep
 * pointing at it and keep their own copy of what they assessed.
 */
export const repositorySources = sqliteTable(
  "repository_sources",
  {
    id: id(),
    publicId: publicId(),
    name: text("name").notNull(),
    cloneUrl: text("clone_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    gitRef: text("git_ref"),
    /** When it was deleted from the catalog; null while it's in it. */
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

/** A long-lived objective that scopes repositories and selects Standard Releases. */
export const initiatives = sqliteTable(
  "initiatives",
  {
    id: id(),
    publicId: publicId(),
    name: text("name").notNull(),
    objective: text("objective").notNull().default(""),
    selectionMode: text("selection_mode", { enum: SELECTION_MODES }).notNull().default("all"),
    /**
     * Set on the Repository profiling initiative, which DE FabLab owns. Each
     * of its Runs profiles one repository, which the launch names, and is
     * that repository's next profile version (docs/profiling.md).
     */
    profiling: integer("profiling", { mode: "boolean" }).notNull().default(false),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("initiatives_public_id", sql`${t.publicId} GLOB 'ini_*'`),
    check("initiatives_name", sql`length(trim(${t.name})) BETWEEN 1 AND 120`),
    check("initiatives_objective", sql`length(${t.objective}) <= 2000`),
    check("initiatives_selection_mode", sql.raw(`selection_mode IN (${sqlList(SELECTION_MODES)})`)),
    check("initiatives_profiling", sql`${t.profiling} IN (0, 1)`),
  ],
);

/** An explicit repository selection. Only explicit initiatives have rows. */
export const initiativeTargets = sqliteTable(
  "initiative_targets",
  {
    id: id(),
    initiativeId: integer("initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    repositorySourceId: integer("repository_source_id")
      .notNull()
      .references(() => repositorySources.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("initiative_targets_selection").on(t.initiativeId, t.repositorySourceId),
    index("initiative_targets_source").on(t.repositorySourceId),
  ],
);
