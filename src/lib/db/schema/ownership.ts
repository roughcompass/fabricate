import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { RENDERING_MODES } from "../../applications/vocabulary";
import { assessments } from "./assessments";
import { repositorySources } from "./catalog";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp } from "./columns";
import { PORTAL_LIFECYCLES, PORTAL_PLATFORMS } from "../../onboarding/vocabulary";
import { sealIdCheck } from "./onboarding";

export const OWNERSHIP_ATTRIBUTES = ["application", "team", "line_of_business", "portal", "owner", "host"] as const;
export const OWNERSHIP_OPERATIONS = ["set", "add", "remove"] as const;
export const OWNERSHIP_SOURCES = ["person", "de_console", "bulk_import"] as const;
export const VERIFICATION_STATES = ["unverified", "verified", "not_required"] as const;

export type OwnershipAttribute = (typeof OWNERSHIP_ATTRIBUTES)[number];
export type OwnershipOperation = (typeof OWNERSHIP_OPERATIONS)[number];
export type OwnershipSource = (typeof OWNERSHIP_SOURCES)[number];
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/*
 * Ownership: which application a repository belongs to, and that
 * application's team, Line of Business, and portals; and each portal's owner
 * and host. Values are never stored as plain columns. Each one is an
 * assertion that records who said it, where it came from, and how far it can
 * be trusted. Assertions are never changed or deleted.
 */

/**
 * A Web Application with its own identity and a non-unique external SEAL ID.
 * Ownership claims describe it. Create Application registers it: a slug, a
 * description, one repository, one Portal, and the starter it began from,
 * with the rendering mode its latest finished DE Web assessment determined
 * (docs/applications.md). A claim-created Application has none of these.
 */
export const applications = sqliteTable(
  "applications",
  {
    id: id(),
    publicId: publicId(),
    /** External metadata, never identity: any number of applications may carry one SEAL ID, or none. */
    sealId: text("seal_id"),
    name: text("name"),
    createdAt: createdAt(),
    /** The owning team an earlier onboarding stated. Ownership claims keep their own team. */
    ownerTeam: text("owner_team"),
    /** Lowercase letters, digits, and single hyphens, starting with a letter; fixed once set and one Application's at most. */
    slug: text("slug"),
    description: text("description"),
    /** The starter or template slug it was created from, if any. */
    starter: text("starter"),
    repositorySourceId: integer("repository_source_id").references(() => repositorySources.id, { onDelete: "restrict" }),
    /** The one Portal whose menu can point at it, fixed once set. */
    portalId: integer("portal_id").references((): AnySQLiteColumn => portals.id, { onDelete: "restrict" }),
    renderingMode: text("rendering_mode", { enum: RENDERING_MODES }),
    /** The rule, deciding facts, and also-observed facts behind the mode, as a JSON object. */
    renderingEvidence: text("rendering_evidence"),
    renderingAssessmentId: integer("rendering_assessment_id").references(() => assessments.id, { onDelete: "restrict" }),
    /** Who stated they created it, for an Application from Create Application. */
    createdBy: text("created_by"),
    verification: text("verification", { enum: VERIFICATION_STATES }),
    /** Bumped on every edit and when an assessment starts or finishes; a row written without one, such as by a claim, takes the time it's written. */
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    lockVersion: lockVersion(),
  },
  (t) => [
    index("applications_seal_id").on(t.sealId),
    index("applications_name").on(t.name),
    index("applications_portal").on(t.portalId),
    uniqueIndex("applications_slug").on(t.slug).where(sql`${t.slug} IS NOT NULL`),
    uniqueIndex("applications_repository").on(t.repositorySourceId).where(sql`${t.repositorySourceId} IS NOT NULL`),
    check("applications_public_id", sql`${t.publicId} GLOB 'sea_*' OR ${t.publicId} GLOB 'wap_*'`),
    check("applications_seal_id", sealIdCheck(t.sealId)),
    check("applications_name", sql`${t.name} IS NULL OR length(trim(${t.name})) BETWEEN 1 AND 200`),
    check("applications_owner_team", sql`${t.ownerTeam} IS NULL OR length(trim(${t.ownerTeam})) BETWEEN 1 AND 200`),
    check("applications_slug", sql`${t.slug} IS NULL OR (length(${t.slug}) BETWEEN 1 AND 63 AND ${t.slug} GLOB '[a-z]*' AND ${t.slug} NOT GLOB '*[^a-z0-9-]*' AND ${t.slug} NOT GLOB '*--*' AND ${t.slug} NOT GLOB '*-')`),
    check("applications_description", sql`${t.description} IS NULL OR length(trim(${t.description})) BETWEEN 1 AND 500`),
    check("applications_starter", sql`${t.starter} IS NULL OR (length(${t.starter}) BETWEEN 1 AND 100 AND ${t.starter} NOT GLOB '*[^a-z0-9-]*')`),
    // A registered Application has every value Create Application asks for.
    check(
      "applications_registered",
      sql`${t.repositorySourceId} IS NULL OR (${t.slug} IS NOT NULL AND ${t.portalId} IS NOT NULL AND ${t.name} IS NOT NULL AND ${t.sealId} IS NOT NULL AND ${t.description} IS NOT NULL)`,
    ),
    check("applications_rendering_mode", sql.raw(`rendering_mode IS NULL OR rendering_mode IN (${sqlList(RENDERING_MODES)})`)),
    check(
      "applications_rendering",
      sql`(${t.renderingMode} IS NULL) = (${t.renderingEvidence} IS NULL) AND (${t.renderingMode} IS NULL) = (${t.renderingAssessmentId} IS NULL)
        AND (${t.renderingEvidence} IS NULL OR (json_valid(${t.renderingEvidence}) AND json_type(${t.renderingEvidence}) = 'object' AND length(${t.renderingEvidence}) <= 65536))`,
    ),
    check("applications_created_by", sql`(${t.createdBy} IS NULL) = (${t.verification} IS NULL) AND (${t.createdBy} IS NULL OR length(trim(${t.createdBy})) BETWEEN 1 AND 200)`),
    check("applications_verification", sql.raw(`verification IS NULL OR verification IN (${sqlList(VERIFICATION_STATES)})`)),
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

/**
 * A portal, approved as an ontology concept or pending review. Its label is
 * its name. Its team arranges its menu and moves it between Prototype and
 * Production on its Portal page; a portal first named in an ownership
 * claim is a Prototype like any other (docs/portals.md).
 */
export const portals = sqliteTable(
  "portals",
  {
    id: id(),
    publicId: publicId(),
    ...labelColumns(),
    createdAt: createdAt(),
    /** External metadata, never identity: several portals may carry one SEAL ID. */
    sealId: text("seal_id"),
    ownerTeam: text("owner_team"),
    /** The platform it targets, a classification fixed at creation; null for a Portal from a claim or from before platforms. */
    platform: text("platform", { enum: PORTAL_PLATFORMS }),
    /** Lowercase letters only, fixed at creation, and one Portal's at most. */
    slug: text("slug"),
    description: text("description"),
    lifecycle: text("lifecycle", { enum: PORTAL_LIFECYCLES }).notNull().default("prototype"),
    /** Bumped by every detail, menu, default, and lifecycle change, so a stale edit is refused. */
    lockVersion: lockVersion(),
  },
  (t) => [
    index("portals_seal_id").on(t.sealId),
    check("portals_public_id", sql`${t.publicId} GLOB 'ptl_*'`),
    check("portals_label", sql`length(trim(${t.label})) BETWEEN 1 AND 100`),
    check("portals_concept", sql`${t.conceptKey} IS NULL OR ${t.conceptKey} GLOB 'portal/*'`),
    check("portals_seal_id", sealIdCheck(t.sealId)),
    check("portals_owner_team", sql`${t.ownerTeam} IS NULL OR length(trim(${t.ownerTeam})) BETWEEN 1 AND 200`),
    uniqueIndex("portals_slug").on(t.slug).where(sql`${t.slug} IS NOT NULL`),
    check("portals_platform", sql.raw(`platform IS NULL OR platform IN (${sqlList(PORTAL_PLATFORMS)})`)),
    check("portals_slug", sql`${t.slug} IS NULL OR (length(${t.slug}) BETWEEN 1 AND 63 AND ${t.slug} NOT GLOB '*[^a-z]*')`),
    check("portals_description", sql`${t.description} IS NULL OR length(trim(${t.description})) BETWEEN 1 AND 500`),
    check("portals_lifecycle", sql.raw(`lifecycle IN (${sqlList(PORTAL_LIFECYCLES)})`)),
  ],
);

/**
 * One ownership value. The attribute fixes the subject and value columns:
 * a repository's application link names an application; an application's team is
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
    subjectApplicationId: integer("subject_application_id").references(() => applications.id, { onDelete: "restrict" }),
    subjectPortalId: integer("subject_portal_id").references(() => portals.id, { onDelete: "restrict" }),
    valueApplicationId: integer("value_application_id").references(() => applications.id, { onDelete: "restrict" }),
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
        WHEN 'application' THEN ${t.subjectRepositorySourceId} IS NOT NULL AND ${t.subjectApplicationId} IS NULL AND ${t.subjectPortalId} IS NULL
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

export const DE_CONSOLE_READ_TRIGGERS = ["claim", "schedule"] as const;
export const DE_CONSOLE_READ_STATUSES = ["succeeded", "failed"] as const;
export type DeConsoleReadTrigger = (typeof DE_CONSOLE_READ_TRIGGERS)[number];

/**
 * One attempt to read the DE Console. Assertions are recorded only when a
 * value changes, so these rows say when its values were last confirmed, and
 * whether the latest attempt failed.
 */
export const deConsoleReads = sqliteTable(
  "de_console_reads",
  {
    id: id(),
    trigger: text("trigger", { enum: DE_CONSOLE_READ_TRIGGERS }).notNull(),
    status: text("status", { enum: DE_CONSOLE_READ_STATUSES }).notNull(),
    readAt: timestamp("read_at").notNull(),
    /** The export's own time, when it states one. */
    exportedAt: timestamp("exported_at"),
    applications: integer("applications"),
    /** How many assertions the read recorded: the values that changed. */
    recorded: integer("recorded"),
    error: text("error"),
  },
  (t) => [
    index("de_console_reads_status_read_at").on(t.status, t.readAt),
    check("de_console_reads_trigger", sql.raw(`"trigger" IN (${sqlList(DE_CONSOLE_READ_TRIGGERS)})`)),
    check(
      "de_console_reads_outcome",
      sql`CASE ${t.status}
        WHEN 'succeeded' THEN ${t.applications} >= 0 AND ${t.recorded} >= 0 AND ${t.error} IS NULL
        WHEN 'failed' THEN ${t.applications} IS NULL AND ${t.recorded} IS NULL AND length(${t.error}) BETWEEN 1 AND 500
        ELSE 0 END`,
    ),
  ],
);

export const DE_CONSOLE_LINK_BASES = ["created", "matched", "resolved", "migrated"] as const;
export const DE_CONSOLE_CONFLICT_REASONS = ["duplicate_in_export", "several_applications"] as const;
export type DeConsoleLinkBasis = (typeof DE_CONSOLE_LINK_BASES)[number];
export type DeConsoleConflictReason = (typeof DE_CONSOLE_CONFLICT_REASONS)[number];

/**
 * The application a DE Console entry is about. A version 2 entry is keyed by
 * the DE Console's own application ID ("id:..."); a legacy version 1 entry
 * only by its SEAL ID ("seal:..."), which names the one application it was
 * first linked to and never another that carries the same SEAL ID. A link is
 * made when a read creates or matches the application, when a person
 * resolves a conflict, or by the onboarding migration. Links never change.
 */
export const deConsoleLinks = sqliteTable(
  "de_console_links",
  {
    id: id(),
    consoleKey: text("console_key").notNull().unique(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    basis: text("basis", { enum: DE_CONSOLE_LINK_BASES }).notNull(),
    /** The person who resolved a conflict; their identity isn't verified. */
    linkedBy: text("linked_by"),
    linkedAt: timestamp("linked_at").notNull(),
  },
  (t) => [
    index("de_console_links_application").on(t.applicationId),
    // One DE Console application ID per application.
    uniqueIndex("de_console_links_one_console_id").on(t.applicationId).where(sql`${t.consoleKey} GLOB 'id:*'`),
    check("de_console_links_key", sql`(${t.consoleKey} GLOB 'id:?*' OR ${t.consoleKey} GLOB 'seal:?*') AND length(${t.consoleKey}) <= 140`),
    check("de_console_links_basis", sql.raw(`basis IN (${sqlList(DE_CONSOLE_LINK_BASES)})`)),
    check("de_console_links_linked_by", sql`(${t.basis} = 'resolved') = (${t.linkedBy} IS NOT NULL) AND (${t.linkedBy} IS NULL OR length(trim(${t.linkedBy})) BETWEEN 1 AND 200)`),
  ],
);

/**
 * A DE Console entry a read couldn't link to exactly one application. Its
 * values aren't recorded: they wait for a person to choose the application,
 * or, for a SEAL ID a legacy export lists twice, for the DE Console to
 * export stable application IDs.
 */
export const deConsoleConflicts = sqliteTable(
  "de_console_conflicts",
  {
    id: id(),
    publicId: publicId(),
    readId: integer("read_id")
      .notNull()
      .references(() => deConsoleReads.id, { onDelete: "restrict" }),
    consoleKey: text("console_key").notNull(),
    sealId: text("seal_id"),
    name: text("name"),
    reason: text("reason", { enum: DE_CONSOLE_CONFLICT_REASONS }).notNull(),
    /** The public IDs of the applications that carry the SEAL ID, as a JSON array. */
    candidates: text("candidates").notNull(),
    recordedAt: timestamp("recorded_at").notNull(),
  },
  (t) => [
    index("de_console_conflicts_key").on(t.consoleKey, t.recordedAt),
    check("de_console_conflicts_public_id", sql`${t.publicId} GLOB 'dcc_*'`),
    check("de_console_conflicts_reason", sql.raw(`reason IN (${sqlList(DE_CONSOLE_CONFLICT_REASONS)})`)),
    check("de_console_conflicts_candidates", sql`json_valid(${t.candidates}) AND json_type(${t.candidates}) = 'array'`),
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
