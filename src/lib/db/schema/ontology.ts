import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, publicId, sqlList, timestamp } from "./columns";

export const CONCEPT_LIFECYCLES = ["adopt", "hold", "retire"] as const;
export type ConceptLifecycle = (typeof CONCEPT_LIFECYCLES)[number];

/**
 * One imported ontology release: a numbered, immutable bundle of concepts
 * built from one reviewed commit of the concept files. Releases are kept
 * forever so every classification can name the release it used.
 */
export const ontologyReleases = sqliteTable(
  "ontology_releases",
  {
    id: id(),
    publicId: publicId(),
    number: integer("number").notNull().unique(),
    commitSha: text("commit_sha").notNull(),
    document: text("document").notNull(),
    digest: text("digest").notNull().unique(),
    importedAt: timestamp("imported_at").notNull(),
  },
  (t) => [
    check("ontology_releases_public_id", sql`${t.publicId} GLOB 'olr_*'`),
    check("ontology_releases_number", sql`${t.number} > 0`),
    check("ontology_releases_commit", sql`length(${t.commitSha}) = 40 AND ${t.commitSha} NOT GLOB '*[^0-9a-f]*'`),
    check("ontology_releases_digest", sql`length(${t.digest}) = 64`),
    check("ontology_releases_document", sql`json_valid(${t.document}) AND json_type(${t.document}) = 'object'`),
  ],
);

/** One concept as a release defines it. The full record lives in the document. */
export const ontologyConcepts = sqliteTable(
  "ontology_concepts",
  {
    id: id(),
    releaseId: integer("release_id")
      .notNull()
      .references(() => ontologyReleases.id, { onDelete: "restrict" }),
    conceptKey: text("concept_key").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    lifecycle: text("lifecycle", { enum: CONCEPT_LIFECYCLES }).notNull(),
    owner: text("owner").notNull(),
    document: text("document").notNull(),
  },
  (t) => [
    uniqueIndex("ontology_concepts_release_key").on(t.releaseId, t.conceptKey),
    index("ontology_concepts_key").on(t.conceptKey),
    check("ontology_concepts_key_format", sql`length(${t.conceptKey}) BETWEEN 3 AND 200 AND ${t.conceptKey} GLOB '*/*'`),
    check("ontology_concepts_label", sql`length(trim(${t.label})) BETWEEN 1 AND 200`),
    check("ontology_concepts_lifecycle", sql.raw(`lifecycle IN (${sqlList(CONCEPT_LIFECYCLES)})`)),
    check("ontology_concepts_owner", sql`length(trim(${t.owner})) > 0`),
    check("ontology_concepts_document", sql`json_valid(${t.document}) AND json_type(${t.document}) = 'object'`),
  ],
);
