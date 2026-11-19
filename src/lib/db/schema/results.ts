import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { assessments } from "./assessments";
import { surveys } from "./surveys";
import { createdAt, id, publicId } from "./columns";

/** Immutable, evidence-backed facts about one commit: the Profile a successful survey wrote. */
export const repositoryProfiles = sqliteTable(
  "repository_profiles",
  {
    id: id(),
    publicId: publicId(),
    surveyId: integer("survey_id")
      .notNull()
      .unique()
      .references(() => surveys.id, { onDelete: "restrict" }),
    schemaVersion: integer("schema_version").notNull(),
    surveyorRelease: text("detector_release").notNull(),
    document: text("document").notNull(),
    digest: text("digest").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
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
