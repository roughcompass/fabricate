import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, id, sqlList, timestamp } from "./columns";
import { jobs } from "./jobs";

// This list mirrors ENTRY_KINDS in Surveyor's entry contract (@repo-facts/contract).
// Schema modules import nothing outside the schema, so a unit test keeps them equal.
export const CATALOG_ENTRY_KINDS = ["design_system", "runtime_api", "composition_contract"] as const;

/** One source of an entry: a package or the team's rules, its version, and the sections it supplied. */
export interface StoredEntrySource {
  name: string;
  version: string;
  snapshot_date?: string;
  sections: string[];
}

/** A package an entry applies to, with the version it was built from when it was read. */
export interface StoredEntryPackage {
  name: string;
  version?: string;
}

/**
 * Reference Catalog entries (establish-frontend-registry, design decision
 * 5): each entry the Catalog Builder wrote, as canonical JSON, under its
 * digest. An entry describes one thing at one version; a rebuild that
 * changes its content is a new row with a new digest, and one that doesn't
 * stores nothing. Rows are never changed or deleted, so every entry a
 * Profile names stays retrievable. Its kind, id, version, sources, and
 * packages are copied out of the document, so choosing entries never parses
 * one. The build job that stored it is null for an entry stored another way.
 */
export const catalogEntries = sqliteTable(
  "catalog_entries",
  {
    id: id(),
    kind: text("kind", { enum: CATALOG_ENTRY_KINDS }).notNull(),
    /** The thing it describes, such as salt. */
    entryId: text("entry_id").notNull(),
    version: text("version").notNull(),
    formatVersion: integer("format_version").notNull(),
    digest: text("digest").notNull().unique(),
    document: text("document").notNull(),
    builtAt: timestamp("built_at").notNull(),
    sources: text("sources", { mode: "json" }).$type<StoredEntrySource[]>().notNull(),
    packages: text("packages", { mode: "json" }).$type<StoredEntryPackage[]>().notNull(),
    buildJobId: integer("build_job_id").references(() => jobs.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("catalog_entries_thing").on(t.kind, t.entryId, t.version),
    index("catalog_entries_build_job").on(t.buildJobId),
    check("catalog_entries_kind", sql.raw(`kind IN (${sqlList(CATALOG_ENTRY_KINDS)})`)),
    check("catalog_entries_entry_id", sql`length(${t.entryId}) BETWEEN 1 AND 64 AND ${t.entryId} NOT GLOB '*[^a-z0-9-]*'`),
    check("catalog_entries_version", sql`length(${t.version}) BETWEEN 1 AND 256`),
    check("catalog_entries_format_version", sql`${t.formatVersion} > 0`),
    check("catalog_entries_digest", sql`length(${t.digest}) = 64 AND ${t.digest} NOT GLOB '*[^0-9a-f]*'`),
    check("catalog_entries_document", sql`json_valid(${t.document}) AND json_type(${t.document}) = 'object'`),
    check("catalog_entries_sources", sql`json_valid(${t.sources}) AND json_type(${t.sources}) = 'array'`),
    check("catalog_entries_packages", sql`json_valid(${t.packages}) AND json_type(${t.packages}) = 'array' AND json_array_length(${t.packages}) > 0`),
  ],
);
