import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { assessmentTargets, assessments, sourceSnapshots } from "./assessments";
import { createdAt, id, publicId } from "./columns";

/** Immutable, evidence-backed facts about one pinned source snapshot. */
export const repositoryProfiles = sqliteTable(
  "repository_profiles",
  {
    id: id(),
    publicId: publicId(),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    assessmentTargetId: integer("assessment_target_id")
      .notNull()
      .unique()
      .references(() => assessmentTargets.id, { onDelete: "restrict" }),
    sourceSnapshotId: integer("source_snapshot_id")
      .notNull()
      .unique()
      .references(() => sourceSnapshots.id, { onDelete: "restrict" }),
    schemaVersion: integer("schema_version").notNull(),
    detectorRelease: text("detector_release").notNull(),
    document: text("document").notNull(),
    digest: text("digest").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("repository_profiles_assessment").on(t.assessmentId),
    check("repository_profiles_public_id", sql`${t.publicId} GLOB 'prf_*'`),
    check("repository_profiles_digest", sql`length(${t.digest}) = 64`),
    check("repository_profiles_document", sql`json_valid(${t.document}) AND json_type(${t.document}) = 'object'`),
  ],
);

/** The immutable cross-repository relationship graph of one Assessment. */
export const relationshipMaps = sqliteTable(
  "relationship_maps",
  {
    id: id(),
    publicId: publicId(),
    assessmentId: integer("assessment_id")
      .notNull()
      .unique()
      .references(() => assessments.id, { onDelete: "restrict" }),
    schemaVersion: integer("schema_version").notNull(),
    resolverVersion: text("resolver_version").notNull(),
    document: text("document").notNull(),
    digest: text("digest").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("relationship_maps_public_id", sql`${t.publicId} GLOB 'map_*'`),
    check("relationship_maps_digest", sql`length(${t.digest}) = 64`),
    check("relationship_maps_document", sql`json_valid(${t.document}) AND json_type(${t.document}) = 'object'`),
  ],
);
