import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assessments } from "./assessments";
import { createdAt, id, lockVersion, publicId, timestamp, updatedAt } from "./columns";

/**
 * A reusable engineering Standard. Its desired state lives in at most one
 * editable draft and any number of immutable published Releases.
 */
export const standards = sqliteTable(
  "standards",
  {
    id: id(),
    publicId: publicId(),
    name: text("name").notNull(),
    purpose: text("purpose").notNull(),
    lockVersion: lockVersion(),
    /**
     * The single editable working copy, while there is one: its structured
     * document, which may be incomplete while being edited, its own
     * optimistic lock version, when it was last saved, and the Release it
     * revises, if any.
     */
    draftDocument: text("draft_document"),
    draftLockVersion: integer("draft_lock_version"),
    draftSavedAt: timestamp("draft_saved_at"),
    draftBasedOnReleaseId: integer("draft_based_on_release_id").references((): AnySQLiteColumn => standardReleases.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("standards_name").on(sql`lower(${t.name})`),
    check("standards_public_id", sql`${t.publicId} GLOB 'std_*'`),
    check("standards_name_length", sql`length(trim(${t.name})) BETWEEN 1 AND 120`),
    check("standards_purpose_length", sql`length(trim(${t.purpose})) BETWEEN 1 AND 2000`),
    // A draft's document, lock version, and save time exist together, and only a draft revises a Release.
    check(
      "standards_draft",
      sql`(${t.draftDocument} IS NULL) = (${t.draftLockVersion} IS NULL) AND (${t.draftDocument} IS NULL) = (${t.draftSavedAt} IS NULL) AND (${t.draftDocument} IS NOT NULL OR ${t.draftBasedOnReleaseId} IS NULL)`,
    ),
    check("standards_draft_document", sql`${t.draftDocument} IS NULL OR (json_valid(${t.draftDocument}) AND json_type(${t.draftDocument}) = 'object')`),
  ],
);

/** An immutable, published version of a Standard's Controls. */
export const standardReleases = sqliteTable(
  "standard_releases",
  {
    id: id(),
    publicId: publicId(),
    standardId: integer("standard_id")
      .notNull()
      .references(() => standards.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    documentSchemaVersion: integer("document_schema_version").notNull(),
    document: text("document").notNull(),
    digest: text("digest").notNull(),
    profileSchemaVersions: text("profile_schema_versions", { mode: "json" }).$type<number[]>().notNull(),
    relationshipSchemaVersions: text("relationship_schema_versions", { mode: "json" }).$type<number[]>().notNull(),
    draftLockVersion: integer("draft_lock_version").notNull(),
    publishedAt: timestamp("published_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("standard_releases_version").on(t.standardId, t.version),
    check("standard_releases_public_id", sql`${t.publicId} GLOB 'rel_*'`),
    check("standard_releases_version_positive", sql`${t.version} > 0`),
    check("standard_releases_digest", sql`length(${t.digest}) = 64`),
    check("standard_releases_document", sql`json_valid(${t.document}) AND json_type(${t.document}) = 'object'`),
    check(
      "standard_releases_schema_versions",
      sql`json_valid(${t.profileSchemaVersions}) AND json_type(${t.profileSchemaVersions}) = 'array' AND json_valid(${t.relationshipSchemaVersions}) AND json_type(${t.relationshipSchemaVersions}) = 'array'`,
    ),
  ],
);

/** The published Releases an Initiative currently selects. */
export const assessmentStandardReleases = sqliteTable(
  "initiative_standard_releases",
  {
    id: id(),
    assessmentId: integer("initiative_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    standardReleaseId: integer("standard_release_id")
      .notNull()
      .references(() => standardReleases.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("initiative_standard_releases_selection").on(t.assessmentId, t.standardReleaseId),
    index("initiative_standard_releases_release").on(t.standardReleaseId),
  ],
);
