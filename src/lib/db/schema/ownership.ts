import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { repositorySources } from "./catalog";
import { createdAt, id, publicId, sqlList, timestamp } from "./columns";

export const OWNERSHIP_ATTRIBUTES = ["seal_id", "team", "line_of_business", "portal", "owner", "host"] as const;
export const OWNERSHIP_OPERATIONS = ["set", "add", "remove"] as const;
export const OWNERSHIP_SOURCES = ["person", "de_console", "bulk_import"] as const;
export const VERIFICATION_STATES = ["unverified", "verified", "not_required"] as const;

export type OwnershipAttribute = (typeof OWNERSHIP_ATTRIBUTES)[number];
export type OwnershipOperation = (typeof OWNERSHIP_OPERATIONS)[number];
export type OwnershipSource = (typeof OWNERSHIP_SOURCES)[number];
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/*
 * Ownership: which SEAL application a repository belongs to, and that
 * application's team, Line of Business, and portals; and each portal's owner
 * and host. Values are never stored as plain columns. Each one is an
 * assertion that records who said it, where it came from, and how far it can
 * be trusted. Assertions are never changed or deleted.
 */

/** A SEAL application, identified by its SEAL ID. */
export const sealApplications = sqliteTable(
  "seal_applications",
  {
    id: id(),
    publicId: publicId(),
    sealId: text("seal_id").notNull().unique(),
    name: text("name"),
    createdAt: createdAt(),
  },
  (t) => [
    check("seal_applications_public_id", sql`${t.publicId} GLOB 'sea_*'`),
    check("seal_applications_seal_id", sql`length(${t.sealId}) BETWEEN 1 AND 64 AND ${t.sealId} = trim(${t.sealId})`),
    check("seal_applications_name", sql`${t.name} IS NULL OR length(trim(${t.name})) BETWEEN 1 AND 200`),
  ],
);

const labelColumns = () => ({
  label: text("label").notNull(),
  /** The label in lowercase with spaces collapsed, so "JPM Access" and "jpm  access" are one value. */
  labelKey: text("label_key").notNull().unique(),
  /** The approved ontology concept, once a release approves it; null while it's a pending candidate. */
  conceptKey: text("concept_key"),
});

/** A Line of Business, approved as an ontology concept or pending review. */
export const linesOfBusiness = sqliteTable(
  "lines_of_business",
  {
    id: id(),
    publicId: publicId(),
    ...labelColumns(),
    createdAt: createdAt(),
  },
  (t) => [
    check("lines_of_business_public_id", sql`${t.publicId} GLOB 'lob_*'`),
    check("lines_of_business_label", sql`length(trim(${t.label})) BETWEEN 1 AND 100`),
    check("lines_of_business_concept", sql`${t.conceptKey} IS NULL OR ${t.conceptKey} GLOB 'line-of-business/*'`),
  ],
);

/** A portal, approved as an ontology concept or pending review. */
export const portals = sqliteTable(
  "portals",
  {
    id: id(),
    publicId: publicId(),
    ...labelColumns(),
    createdAt: createdAt(),
  },
  (t) => [
    check("portals_public_id", sql`${t.publicId} GLOB 'ptl_*'`),
    check("portals_label", sql`length(trim(${t.label})) BETWEEN 1 AND 100`),
    check("portals_concept", sql`${t.conceptKey} IS NULL OR ${t.conceptKey} GLOB 'portal/*'`),
  ],
);

/**
 * One ownership value. The attribute fixes the subject and value columns:
 * a repository's SEAL ID names an application; an application's team is
 * text, its Line of Business a Line of Business, and each portal it's added
 * to or removed from a portal; a portal's owner names an application and its
 * host a repository.
 */
export const ownershipAssertions = sqliteTable(
  "ownership_assertions",
  {
    id: id(),
    publicId: publicId(),
    attribute: text("attribute", { enum: OWNERSHIP_ATTRIBUTES }).notNull(),
    operation: text("operation", { enum: OWNERSHIP_OPERATIONS }).notNull(),
    subjectRepositorySourceId: integer("subject_repository_source_id").references(() => repositorySources.id, { onDelete: "restrict" }),
    subjectApplicationId: integer("subject_application_id").references(() => sealApplications.id, { onDelete: "restrict" }),
    subjectPortalId: integer("subject_portal_id").references(() => portals.id, { onDelete: "restrict" }),
    valueApplicationId: integer("value_application_id").references(() => sealApplications.id, { onDelete: "restrict" }),
    valueTeam: text("value_team"),
    valueLineOfBusinessId: integer("value_line_of_business_id").references(() => linesOfBusiness.id, { onDelete: "restrict" }),
    valuePortalId: integer("value_portal_id").references(() => portals.id, { onDelete: "restrict" }),
    valueRepositorySourceId: integer("value_repository_source_id").references(() => repositorySources.id, { onDelete: "restrict" }),
    providedBy: text("provided_by").notNull(),
    attributedTo: text("attributed_to"),
    source: text("source", { enum: OWNERSHIP_SOURCES }).notNull(),
    verification: text("verification", { enum: VERIFICATION_STATES }).notNull(),
    verifiedAt: timestamp("verified_at"),
    readAt: timestamp("read_at"),
    recordedAt: timestamp("recorded_at").notNull(),
  },
  (t) => [
    index("ownership_assertions_subject_repository").on(t.subjectRepositorySourceId, t.attribute),
    index("ownership_assertions_subject_application").on(t.subjectApplicationId, t.attribute),
    index("ownership_assertions_subject_portal").on(t.subjectPortalId, t.attribute),
    index("ownership_assertions_value_application").on(t.valueApplicationId),
    index("ownership_assertions_value_repository").on(t.valueRepositorySourceId),
    check("ownership_assertions_public_id", sql`${t.publicId} GLOB 'own_*'`),
    check("ownership_assertions_attribute", sql.raw(`attribute IN (${sqlList(OWNERSHIP_ATTRIBUTES)})`)),
    check("ownership_assertions_operation", sql.raw(`operation IN (${sqlList(OWNERSHIP_OPERATIONS)})`)),
    check("ownership_assertions_source", sql.raw(`source IN (${sqlList(OWNERSHIP_SOURCES)})`)),
    check("ownership_assertions_verification", sql.raw(`verification IN (${sqlList(VERIFICATION_STATES)})`)),
    // Each attribute has exactly one subject column and one value column.
    check(
      "ownership_assertions_shape",
      sql`(CASE ${t.attribute}
        WHEN 'seal_id' THEN ${t.subjectRepositorySourceId} IS NOT NULL AND ${t.subjectApplicationId} IS NULL AND ${t.subjectPortalId} IS NULL
          AND ${t.operation} = 'set' AND ${t.valueApplicationId} IS NOT NULL
          AND ${t.valueTeam} IS NULL AND ${t.valueLineOfBusinessId} IS NULL AND ${t.valuePortalId} IS NULL AND ${t.valueRepositorySourceId} IS NULL
        WHEN 'team' THEN ${t.subjectApplicationId} IS NOT NULL AND ${t.subjectRepositorySourceId} IS NULL AND ${t.subjectPortalId} IS NULL
          AND ${t.operation} = 'set' AND length(trim(${t.valueTeam})) BETWEEN 1 AND 200
          AND ${t.valueApplicationId} IS NULL AND ${t.valueLineOfBusinessId} IS NULL AND ${t.valuePortalId} IS NULL AND ${t.valueRepositorySourceId} IS NULL
        WHEN 'line_of_business' THEN ${t.subjectApplicationId} IS NOT NULL AND ${t.subjectRepositorySourceId} IS NULL AND ${t.subjectPortalId} IS NULL
          AND ${t.operation} = 'set' AND ${t.valueLineOfBusinessId} IS NOT NULL
          AND ${t.valueApplicationId} IS NULL AND ${t.valueTeam} IS NULL AND ${t.valuePortalId} IS NULL AND ${t.valueRepositorySourceId} IS NULL
        WHEN 'portal' THEN ${t.subjectApplicationId} IS NOT NULL AND ${t.subjectRepositorySourceId} IS NULL AND ${t.subjectPortalId} IS NULL
          AND ${t.operation} IN ('add', 'remove') AND ${t.valuePortalId} IS NOT NULL
          AND ${t.valueApplicationId} IS NULL AND ${t.valueTeam} IS NULL AND ${t.valueLineOfBusinessId} IS NULL AND ${t.valueRepositorySourceId} IS NULL
        WHEN 'owner' THEN ${t.subjectPortalId} IS NOT NULL AND ${t.subjectRepositorySourceId} IS NULL AND ${t.subjectApplicationId} IS NULL
          AND ${t.operation} = 'set' AND ${t.valueApplicationId} IS NOT NULL
          AND ${t.valueTeam} IS NULL AND ${t.valueLineOfBusinessId} IS NULL AND ${t.valuePortalId} IS NULL AND ${t.valueRepositorySourceId} IS NULL
        WHEN 'host' THEN ${t.subjectPortalId} IS NOT NULL AND ${t.subjectRepositorySourceId} IS NULL AND ${t.subjectApplicationId} IS NULL
          AND ${t.operation} = 'set' AND ${t.valueRepositorySourceId} IS NOT NULL
          AND ${t.valueApplicationId} IS NULL AND ${t.valueTeam} IS NULL AND ${t.valueLineOfBusinessId} IS NULL AND ${t.valuePortalId} IS NULL
        ELSE 0 END)`,
    ),
    check("ownership_assertions_provided_by", sql`length(trim(${t.providedBy})) BETWEEN 1 AND 200`),
    check("ownership_assertions_attributed_to", sql`${t.attributedTo} IS NULL OR length(trim(${t.attributedTo})) BETWEEN 1 AND 200`),
    // A DE Console import is the source of record: it needs no verification and records when it was read.
    check(
      "ownership_assertions_trust",
      sql`CASE ${t.source}
        WHEN 'de_console' THEN ${t.verification} = 'not_required' AND ${t.readAt} IS NOT NULL
        ELSE ${t.verification} IN ('unverified', 'verified') AND ${t.readAt} IS NULL END`,
    ),
    check("ownership_assertions_verified_at", sql`(${t.verification} = 'verified') = (${t.verifiedAt} IS NOT NULL)`),
  ],
);

/** An assertion that replaces an earlier one about the same subject and attribute. */
export const ownershipSupersessions = sqliteTable(
  "ownership_supersessions",
  {
    assertionId: integer("assertion_id")
      .notNull()
      .references(() => ownershipAssertions.id, { onDelete: "restrict" }),
    supersededId: integer("superseded_id")
      .notNull()
      .references(() => ownershipAssertions.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.assertionId, t.supersededId] }), index("ownership_supersessions_superseded").on(t.supersededId)],
);
