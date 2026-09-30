import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, id, lockVersion, publicId, sqlList, updatedAt } from "./columns";

export const SELECTION_MODES = ["all_enabled", "explicit"] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

/**
 * A clonable Git repository in the catalog. Sources are never deleted;
 * disabling one removes it from future all-enabled scopes while historical
 * assessment targets keep their own copy.
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
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("repository_sources_canonical_url").on(t.canonicalUrl),
    // At most one enabled entry per canonical clone URL.
    uniqueIndex("repository_sources_enabled_canonical_url").on(t.canonicalUrl).where(sql`${t.enabled} = 1`),
    check("repository_sources_public_id", sql`${t.publicId} GLOB 'src_*'`),
    check("repository_sources_name", sql`length(trim(${t.name})) BETWEEN 1 AND 100`),
    check("repository_sources_urls", sql`length(${t.cloneUrl}) > 0 AND length(${t.canonicalUrl}) > 0`),
    check("repository_sources_git_ref", sql`${t.gitRef} IS NULL OR length(${t.gitRef}) BETWEEN 1 AND 255`),
    check("repository_sources_enabled", sql`${t.enabled} IN (0, 1)`),
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
    selectionMode: text("selection_mode", { enum: SELECTION_MODES }).notNull().default("all_enabled"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("initiatives_public_id", sql`${t.publicId} GLOB 'ini_*'`),
    check("initiatives_name", sql`length(trim(${t.name})) BETWEEN 1 AND 120`),
    check("initiatives_objective", sql`length(${t.objective}) <= 2000`),
    check("initiatives_selection_mode", sql.raw(`selection_mode IN (${sqlList(SELECTION_MODES)})`)),
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
