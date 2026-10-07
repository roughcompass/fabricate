import { type SQL, sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { repositorySources } from "./catalog";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp } from "./columns";
import { RENDERING_MODES } from "../../onboarding/vocabulary";
import { applications, portals } from "./ownership";

/*
 * Web onboarding (docs/onboarding.md). Portals, Web Applications, and MFEs
 * each have a stable identity and numbered revisions. A Draft revision holds
 * an editable document and a lock version; submitting it validates the whole
 * graph and freezes it into the normalized rows below, which triggers then
 * keep unchanged. Placements of an Application in a Portal are reviewed one
 * by one, and every decision, default route, observation, and lifecycle
 * change is appended, never rewritten. Nothing here is written to Studio or
 * CDaaS.
 */

export const LIFECYCLE_STATES = ["draft", "ready", "active", "retired"] as const;
export const REVISION_STATES = ["draft", "submitted"] as const;
// Defined beside their labels, in a module the browser can load.
export { RENDERING_MODES, type RenderingMode } from "../../onboarding/vocabulary";
export const LAUNCH_TARGET_KINDS = ["mfe", "external"] as const;
export const COMPONENT_ROLES = ["entry", "child"] as const;
export const MOUNT_KINDS = ["route", "slot"] as const;
/** How a rendering mode was settled: an inferred candidate confirmed, an inference overridden, or chosen with no inference. */
export const RENDERING_CONFIRMATIONS = ["inferred", "override", "explicit"] as const;
export const INFERENCE_SOURCES = ["mfe_contract", "studio", "cdaas"] as const;
export const PLACEMENT_DECISIONS = ["approve", "reject", "withdraw", "retire"] as const;
export const PLACEMENT_STATES = ["pending", "approved", "rejected", "withdrawn", "retired"] as const;
export const EXTERNAL_SYSTEMS = ["studio", "cdaas"] as const;
export const EXTERNAL_RESOURCE_TYPES = ["channel", "module_group", "module", "menu", "environment", "application_view"] as const;
export const REFERENCE_SOURCES = ["person", "declared", "discovered"] as const;
export const OBSERVATION_OUTCOMES = ["found", "not_found", "incompatible"] as const;
export const READ_OUTCOMES = ["found", "not_found", "incompatible", "unavailable"] as const;
export const ONBOARDING_SUBJECTS = ["portal", "application", "microfrontend"] as const;
/** A person's stated identity, which nothing verifies yet, or Fabricate itself. */
export const ATTRIBUTIONS = ["unverified", "system"] as const;
export const ONBOARDING_EVENTS = ["created", "draft_started", "submitted", "ready", "not_ready", "activated", "revision_activated", "retired", "metadata_changed"] as const;
export const ENTITLEMENT_OPERATORS = ["any", "all"] as const;
/**
 * The shape of a revision's document and normalized rows. Version 1 held
 * platform policy the teams don't own: runtimes, contracts, Portal
 * entitlements, and required capabilities. Version 2 holds only what the
 * Portal and Application teams decide. Every revision written now is version 2.
 */
export const FORMAT_VERSIONS = [1, 2] as const;
export const CURRENT_FORMAT_VERSION = 2;
/** Where an environment catalog came from: a Studio read, or the committed fallback set. */
export const ENVIRONMENT_CATALOG_SOURCES = ["studio", "fallback"] as const;
export const CATALOG_READ_OUTCOMES = ["found", "incompatible", "unavailable"] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];
export type RevisionState = (typeof REVISION_STATES)[number];
export type LaunchTargetKind = (typeof LAUNCH_TARGET_KINDS)[number];
export type ComponentRole = (typeof COMPONENT_ROLES)[number];
export type MountKind = (typeof MOUNT_KINDS)[number];
export type RenderingConfirmation = (typeof RENDERING_CONFIRMATIONS)[number];
export type InferenceSource = (typeof INFERENCE_SOURCES)[number];
export type PlacementDecisionKind = (typeof PLACEMENT_DECISIONS)[number];
export type PlacementState = (typeof PLACEMENT_STATES)[number];
export type ExternalSystem = (typeof EXTERNAL_SYSTEMS)[number];
export type ExternalResourceType = (typeof EXTERNAL_RESOURCE_TYPES)[number];
export type ReferenceSource = (typeof REFERENCE_SOURCES)[number];
export type ObservationOutcome = (typeof OBSERVATION_OUTCOMES)[number];
export type ReadOutcome = (typeof READ_OUTCOMES)[number];
export type OnboardingSubject = (typeof ONBOARDING_SUBJECTS)[number];
export type Attribution = (typeof ATTRIBUTIONS)[number];
export type OnboardingEvent = (typeof ONBOARDING_EVENTS)[number];
export type FormatVersion = (typeof FORMAT_VERSIONS)[number];
export type EnvironmentCatalogSource = (typeof ENVIRONMENT_CATALOG_SOURCES)[number];
export type CatalogReadOutcome = (typeof CATALOG_READ_OUTCOMES)[number];

/** Largest stored document, draft or canonical. */
export const MAX_DOCUMENT_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Shared checks

const digestCheck = (column: AnySQLiteColumn) => sql`length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
const jsonObjectCheck = (column: AnySQLiteColumn) => sql`json_valid(${column}) AND json_type(${column}) = 'object' AND length(${column}) <= ${sql.raw(String(MAX_DOCUMENT_BYTES))}`;
const jsonArrayCheck = (column: AnySQLiteColumn) => sql`json_valid(${column}) AND json_type(${column}) = 'array' AND length(${column}) <= ${sql.raw(String(MAX_DOCUMENT_BYTES))}`;
const optionalText = (column: AnySQLiteColumn, max: number) => sql`${column} IS NULL OR length(trim(${column})) BETWEEN 1 AND ${sql.raw(String(max))}`;
/** Lowercase letters, digits, and dashes, starting with a letter: environment and menu-group keys. */
export const keyCheck = (column: AnySQLiteColumn, max: number) => sql`length(${column}) BETWEEN 1 AND ${sql.raw(String(max))} AND ${column} GLOB '[a-z]*' AND ${column} NOT GLOB '*[^a-z0-9-]*'`;
export const sealIdCheck = (column: AnySQLiteColumn) => sql`${column} IS NULL OR (length(${column}) BETWEEN 1 AND 64 AND ${column} = trim(${column}))`;

/**
 * A normalized Portal route: a leading slash, no empty segment, no trailing
 * slash except the root, and no query string, fragment, or whitespace.
 */
export const routeCheck = (column: AnySQLiteColumn) =>
  sql`length(${column}) BETWEEN 1 AND 200 AND ${column} GLOB '/*' AND instr(${column}, '//') = 0 AND (${column} = '/' OR ${column} NOT GLOB '*/') AND ${column} NOT GLOB '*[?#]*' AND ${column} NOT GLOB '*[^!-~]*'`;

/**
 * An absolute https URL with no credentials and no fragment. Onboarding
 * stores a team's endpoint; it never fetches it.
 */
export const urlCheck = (column: AnySQLiteColumn): SQL => {
  const rest = sql`substr(${column}, 9)`;
  const authority = sql`CASE WHEN instr(${rest}, '/') > 0 THEN substr(${rest}, 1, instr(${rest}, '/') - 1) ELSE ${rest} END`;
  return sql`${column} IS NULL OR (length(${column}) BETWEEN 9 AND 2048 AND ${column} GLOB 'https://?*' AND instr(${column}, '#') = 0 AND instr(${authority}, '@') = 0 AND ${column} NOT GLOB '*[^!-~]*')`;
};

/** A repository-relative workspace path: no leading or trailing slash, empty segment, or "." or ".." segment. */
export const workspacePathCheck = (column: AnySQLiteColumn) =>
  sql`${column} IS NULL OR (length(${column}) BETWEEN 1 AND 200 AND ${column} NOT GLOB '/*' AND ${column} NOT GLOB '*/' AND instr(${column}, '//') = 0
    AND ('/' || ${column} || '/') NOT GLOB '*/./*' AND ('/' || ${column} || '/') NOT GLOB '*/../*' AND ${column} NOT GLOB '*[^A-Za-z0-9._@/-]*')`;

const externalIdCheck = (column: AnySQLiteColumn) => sql`length(${column}) BETWEEN 1 AND 128 AND ${column} NOT GLOB '*[^A-Za-z0-9._:/-]*'`;
const attributionChecks = (prefix: string, actor: AnySQLiteColumn, attribution: AnySQLiteColumn) => [
  check(`${prefix}_actor`, sql`length(trim(${actor})) BETWEEN 1 AND 200`),
  check(`${prefix}_attribution`, sql.raw(`${attribution.name} IN (${sqlList(ATTRIBUTIONS)})`)),
];

// ---------------------------------------------------------------------------
// Identity

/** A reusable microfrontend: a logical code asset that a CDaaS application view represents. */
export const microfrontends = sqliteTable(
  "microfrontends",
  {
    id: id(),
    publicId: publicId(),
    name: text("name").notNull(),
    /** External metadata, never identity: any number of records may carry one SEAL ID. */
    sealId: text("seal_id"),
    ownerTeam: text("owner_team"),
    lifecycle: text("lifecycle", { enum: LIFECYCLE_STATES }).notNull().default("draft"),
    activeRevisionId: integer("active_revision_id").references((): AnySQLiteColumn => microfrontendRevisions.id, { onDelete: "restrict" }),
    draftRevisionId: integer("draft_revision_id").references((): AnySQLiteColumn => microfrontendRevisions.id, { onDelete: "restrict" }),
    /** The CDaaS view its submitted revision names; unique among MFEs that aren't retired. */
    cdaasAppId: text("cdaas_app_id"),
    cdaasViewId: text("cdaas_view_id"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
  },
  (t) => [
    index("microfrontends_seal_id").on(t.sealId),
    index("microfrontends_name").on(t.name),
    uniqueIndex("microfrontends_cdaas_view").on(t.cdaasAppId, t.cdaasViewId).where(sql`${t.cdaasAppId} IS NOT NULL AND ${t.lifecycle} <> 'retired'`),
    check("microfrontends_public_id", sql`${t.publicId} GLOB 'mfe_*'`),
    check("microfrontends_name", sql`length(trim(${t.name})) BETWEEN 1 AND 200`),
    check("microfrontends_seal_id", sealIdCheck(t.sealId)),
    check("microfrontends_owner_team", optionalText(t.ownerTeam, 200)),
    check("microfrontends_lifecycle", sql.raw(`lifecycle IN (${sqlList(LIFECYCLE_STATES)})`)),
    check("microfrontends_cdaas", sql`(${t.cdaasAppId} IS NULL) = (${t.cdaasViewId} IS NULL) AND (${t.cdaasAppId} IS NULL OR (${externalIdCheck(t.cdaasAppId)} AND ${externalIdCheck(t.cdaasViewId)}))`),
  ],
);

// ---------------------------------------------------------------------------
// Revisions

const revisionColumns = () => ({
  id: id(),
  number: integer("number").notNull(),
  state: text("state", { enum: REVISION_STATES }).notNull().default("draft"),
  /** Optimistic concurrency for a Draft; unchanged once submitted. */
  lockVersion: lockVersion(),
  /** A Draft's editable document, or a submitted revision's canonical document. */
  document: text("document").notNull(),
  /** SHA-256 of the canonical document, set on submission. */
  digest: text("digest"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at").notNull(),
  submittedBy: text("submitted_by"),
  submittedAt: timestamp("submitted_at"),
  /** The document's format: 1 for revisions written before format versions, 2 for every revision since. */
  formatVersion: integer("format_version").notNull().default(CURRENT_FORMAT_VERSION),
});

/** The environment catalog a submitted v2 revision was validated against, so the decision stays explainable after the catalog changes. */
const catalogColumns = () => ({
  environmentCatalogSource: text("environment_catalog_source", { enum: ENVIRONMENT_CATALOG_SOURCES }),
  environmentCatalogDigest: text("environment_catalog_digest"),
});

const catalogRecorded = (t: { environmentCatalogSource: AnySQLiteColumn; environmentCatalogDigest: AnySQLiteColumn }) =>
  sql`${t.environmentCatalogSource} IN (${sql.raw(sqlList(ENVIRONMENT_CATALOG_SOURCES))}) AND ${t.environmentCatalogDigest} IS NOT NULL AND ${digestCheck(t.environmentCatalogDigest)}`;
const catalogAbsent = (t: { environmentCatalogSource: AnySQLiteColumn; environmentCatalogDigest: AnySQLiteColumn }) => sql`${t.environmentCatalogSource} IS NULL AND ${t.environmentCatalogDigest} IS NULL`;

function revisionChecks(table: string, t: { number: AnySQLiteColumn; state: AnySQLiteColumn; document: AnySQLiteColumn; digest: AnySQLiteColumn; createdBy: AnySQLiteColumn; submittedBy: AnySQLiteColumn; submittedAt: AnySQLiteColumn; formatVersion: AnySQLiteColumn }) {
  return [
    check(`${table}_number`, sql`${t.number} >= 1`),
    check(`${table}_state`, sql.raw(`state IN (${sqlList(REVISION_STATES)})`)),
    check(`${table}_format_version`, sql.raw(`format_version IN (${FORMAT_VERSIONS.join(", ")})`)),
    check(`${table}_document`, jsonObjectCheck(t.document)),
    check(`${table}_created_by`, sql`length(trim(${t.createdBy})) BETWEEN 1 AND 200`),
    check(`${table}_submission`, sql`CASE ${t.state}
      WHEN 'submitted' THEN ${t.digest} IS NOT NULL AND ${digestCheck(t.digest)} AND ${t.submittedAt} IS NOT NULL AND ${t.submittedBy} IS NOT NULL AND length(trim(${t.submittedBy})) BETWEEN 1 AND 200
      ELSE ${t.digest} IS NULL AND ${t.submittedAt} IS NULL AND ${t.submittedBy} IS NULL END`),
  ];
}

/**
 * A numbered Portal configuration: its selected environments and menu
 * groups. A v1 revision also froze the runtimes and contract the Portal
 * team was asked for; those stay as history, and v2 has neither.
 */
export const portalRevisions = sqliteTable(
  "portal_revisions",
  {
    ...revisionColumns(),
    portalId: integer("portal_id")
      .notNull()
      .references((): AnySQLiteColumn => portals.id, { onDelete: "restrict" }),
    basedOnRevisionId: integer("based_on_revision_id").references((): AnySQLiteColumn => portalRevisions.id, { onDelete: "restrict" }),
    ownerTeam: text("owner_team"),
    sealId: text("seal_id"),
    /** v1 only: the runtimes the Portal named, as a canonical JSON array. */
    runtimes: text("runtimes"),
    /** v1 only: the canonical Portal contract and its digest. */
    contract: text("contract"),
    contractDigest: text("contract_digest"),
    ...catalogColumns(),
  },
  (t) => [
    uniqueIndex("portal_revisions_number").on(t.portalId, t.number),
    // At most one editable Draft per Portal.
    uniqueIndex("portal_revisions_one_draft").on(t.portalId).where(sql`${t.state} = 'draft'`),
    ...revisionChecks("portal_revisions", t),
    check("portal_revisions_seal_id", sealIdCheck(t.sealId)),
    check("portal_revisions_owner_team", optionalText(t.ownerTeam, 200)),
    check(
      "portal_revisions_frozen",
      sql`CASE ${t.state} WHEN 'submitted' THEN ${t.ownerTeam} IS NOT NULL AND CASE ${t.formatVersion}
          WHEN 1 THEN ${t.runtimes} IS NOT NULL AND json_valid(${t.runtimes}) AND json_type(${t.runtimes}) = 'array'
            AND ${t.contract} IS NOT NULL AND json_valid(${t.contract}) AND ${t.contractDigest} IS NOT NULL AND ${digestCheck(t.contractDigest)} AND ${catalogAbsent(t)}
          WHEN 2 THEN ${t.runtimes} IS NULL AND ${t.contract} IS NULL AND ${t.contractDigest} IS NULL AND ${catalogRecorded(t)}
          ELSE 0 END
        ELSE ${t.runtimes} IS NULL AND ${t.contract} IS NULL AND ${t.contractDigest} IS NULL AND ${catalogAbsent(t)} END`,
    ),
  ],
);

/**
 * A numbered Web Application: its launch target, composition, and placement
 * requests. A v1 revision also froze global environments and the Portal
 * capabilities it required; v2 has neither, and records the environment
 * catalog its placements were checked against.
 */
export const applicationRevisions = sqliteTable(
  "application_revisions",
  {
    ...revisionColumns(),
    applicationId: integer("application_id")
      .notNull()
      .references((): AnySQLiteColumn => applications.id, { onDelete: "restrict" }),
    basedOnRevisionId: integer("based_on_revision_id").references((): AnySQLiteColumn => applicationRevisions.id, { onDelete: "restrict" }),
    name: text("name"),
    ownerTeam: text("owner_team"),
    sealId: text("seal_id"),
    /** v1 only: the Portal-contract capabilities the Application required, as a canonical JSON array. */
    requiredCapabilities: text("required_capabilities"),
    ...catalogColumns(),
  },
  (t) => [
    uniqueIndex("application_revisions_number").on(t.applicationId, t.number),
    uniqueIndex("application_revisions_one_draft").on(t.applicationId).where(sql`${t.state} = 'draft'`),
    ...revisionChecks("application_revisions", t),
    check("application_revisions_seal_id", sealIdCheck(t.sealId)),
    check("application_revisions_name", optionalText(t.name, 200)),
    check("application_revisions_owner_team", optionalText(t.ownerTeam, 200)),
    check(
      "application_revisions_frozen",
      sql`CASE ${t.state} WHEN 'submitted' THEN ${t.name} IS NOT NULL AND ${t.ownerTeam} IS NOT NULL AND CASE ${t.formatVersion}
          WHEN 1 THEN ${t.requiredCapabilities} IS NOT NULL AND json_valid(${t.requiredCapabilities}) AND json_type(${t.requiredCapabilities}) = 'array' AND ${catalogAbsent(t)}
          WHEN 2 THEN ${t.requiredCapabilities} IS NULL AND ${catalogRecorded(t)}
          ELSE 0 END
        ELSE ${t.requiredCapabilities} IS NULL AND ${catalogAbsent(t)} END`,
    ),
  ],
);

/**
 * A numbered MFE: its source coordinate, CDaaS view, and how it can be
 * rendered. A v1 revision froze a runtime contract; a v2 revision freezes
 * only the rendering metadata an Application launch or child binding uses.
 */
export const microfrontendRevisions = sqliteTable(
  "microfrontend_revisions",
  {
    ...revisionColumns(),
    microfrontendId: integer("microfrontend_id")
      .notNull()
      .references((): AnySQLiteColumn => microfrontends.id, { onDelete: "restrict" }),
    basedOnRevisionId: integer("based_on_revision_id").references((): AnySQLiteColumn => microfrontendRevisions.id, { onDelete: "restrict" }),
    name: text("name"),
    ownerTeam: text("owner_team"),
    sealId: text("seal_id"),
    repositorySourceId: integer("repository_source_id").references(() => repositorySources.id, { onDelete: "restrict" }),
    workspacePath: text("workspace_path"),
    cdaasAppId: text("cdaas_app_id"),
    cdaasViewId: text("cdaas_view_id"),
    /** v1 only: the canonical runtime contract and its digest. */
    contract: text("contract"),
    contractDigest: text("contract_digest"),
    /** v2 only: the canonical rendering metadata, the modules each rendering mode can load. */
    rendering: text("rendering"),
  },
  (t) => [
    uniqueIndex("microfrontend_revisions_number").on(t.microfrontendId, t.number),
    uniqueIndex("microfrontend_revisions_one_draft").on(t.microfrontendId).where(sql`${t.state} = 'draft'`),
    index("microfrontend_revisions_repository").on(t.repositorySourceId),
    ...revisionChecks("microfrontend_revisions", t),
    check("microfrontend_revisions_seal_id", sealIdCheck(t.sealId)),
    check("microfrontend_revisions_name", optionalText(t.name, 200)),
    check("microfrontend_revisions_owner_team", optionalText(t.ownerTeam, 200)),
    check("microfrontend_revisions_workspace_path", workspacePathCheck(t.workspacePath)),
    check("microfrontend_revisions_cdaas", sql`(${t.cdaasAppId} IS NULL) = (${t.cdaasViewId} IS NULL) AND (${t.cdaasAppId} IS NULL OR (${externalIdCheck(t.cdaasAppId)} AND ${externalIdCheck(t.cdaasViewId)}))`),
    check(
      "microfrontend_revisions_frozen",
      sql`CASE ${t.state} WHEN 'submitted' THEN ${t.name} IS NOT NULL AND ${t.ownerTeam} IS NOT NULL AND ${t.repositorySourceId} IS NOT NULL AND CASE ${t.formatVersion}
          WHEN 1 THEN ${t.contract} IS NOT NULL AND json_valid(${t.contract}) AND ${t.contractDigest} IS NOT NULL AND ${digestCheck(t.contractDigest)} AND ${t.rendering} IS NULL
          WHEN 2 THEN ${t.rendering} IS NOT NULL AND ${jsonObjectCheck(t.rendering)} AND ${t.contract} IS NULL AND ${t.contractDigest} IS NULL
          ELSE 0 END
        ELSE ${t.repositorySourceId} IS NULL AND ${t.workspacePath} IS NULL AND ${t.cdaasAppId} IS NULL AND ${t.contract} IS NULL AND ${t.contractDigest} IS NULL AND ${t.rendering} IS NULL END`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Portal configuration, frozen with its revision

/**
 * One environment of a submitted Portal revision. A v2 revision stores the
 * catalog environments the Portal enables, nothing more; a v1 revision also
 * froze each environment's runtime and entitlements, and could keep a
 * disabled one. Triggers hold each row to its revision's format.
 */
export const portalEnvironments = sqliteTable(
  "portal_environments",
  {
    id: id(),
    portalRevisionId: integer("portal_revision_id")
      .notNull()
      .references(() => portalRevisions.id, { onDelete: "restrict" }),
    environment: text("environment").notNull(),
    /** v1 only. */
    runtime: text("runtime"),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    /** v1 only: the canonical entitlement set and its digest. */
    entitlements: text("entitlements"),
    entitlementsDigest: text("entitlements_digest"),
    /** v1 only: the environment whose entitlements this one inherited, shown beside them; null when stated here. */
    entitlementsInheritedFrom: text("entitlements_inherited_from"),
  },
  (t) => [
    uniqueIndex("portal_environments_environment").on(t.portalRevisionId, t.environment),
    check("portal_environments_environment", keyCheck(t.environment, 32)),
    check("portal_environments_runtime", sql`${t.runtime} IS NULL OR (length(${t.runtime}) BETWEEN 1 AND 64 AND ${t.runtime} NOT GLOB '*[^A-Za-z0-9._@/-]*')`),
    check("portal_environments_enabled", sql`${t.enabled} IN (0, 1)`),
    check("portal_environments_entitlements", sql`${t.entitlements} IS NULL OR (${jsonObjectCheck(t.entitlements)})`),
    check("portal_environments_entitlements_digest", sql`${t.entitlementsDigest} IS NULL OR (${digestCheck(t.entitlementsDigest)})`),
    check("portal_environments_inherited", sql`${t.entitlementsInheritedFrom} IS NULL OR (${keyCheck(t.entitlementsInheritedFrom, 32)} AND ${t.entitlementsInheritedFrom} <> ${t.environment})`),
    // The v1 values come together or not at all.
    check(
      "portal_environments_legacy",
      sql`(${t.runtime} IS NULL) = (${t.entitlements} IS NULL) AND (${t.entitlements} IS NULL) = (${t.entitlementsDigest} IS NULL) AND (${t.entitlements} IS NOT NULL OR ${t.entitlementsInheritedFrom} IS NULL)`,
    ),
  ],
);

/** A non-actionable menu container of a submitted Portal revision. Application placements are its leaves. */
export const portalMenuGroups = sqliteTable(
  "portal_menu_groups",
  {
    id: id(),
    portalRevisionId: integer("portal_revision_id")
      .notNull()
      .references(() => portalRevisions.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    parentKey: text("parent_key"),
    label: text("label").notNull(),
    ordering: integer("ordering").notNull(),
  },
  (t) => [
    uniqueIndex("portal_menu_groups_key").on(t.portalRevisionId, t.key),
    // A parent is another group of the same revision.
    foreignKey({ name: "portal_menu_groups_parent", columns: [t.portalRevisionId, t.parentKey], foreignColumns: [t.portalRevisionId, t.key] }).onDelete("restrict"),
    check("portal_menu_groups_key", keyCheck(t.key, 64)),
    check("portal_menu_groups_parent", sql`${t.parentKey} IS NULL OR ${t.parentKey} <> ${t.key}`),
    check("portal_menu_groups_label", sql`length(trim(${t.label})) BETWEEN 1 AND 100`),
    check("portal_menu_groups_ordering", sql`${t.ordering} BETWEEN 0 AND 100000`),
  ],
);

// ---------------------------------------------------------------------------
// Application configuration, frozen with its revision

export const applicationEnvironments = sqliteTable(
  "application_environments",
  {
    id: id(),
    applicationRevisionId: integer("application_revision_id")
      .notNull()
      .references(() => applicationRevisions.id, { onDelete: "restrict" }),
    environment: text("environment").notNull(),
  },
  (t) => [uniqueIndex("application_environments_environment").on(t.applicationRevisionId, t.environment), check("application_environments_environment", keyCheck(t.environment, 32))],
);

/**
 * The one thing a submitted Application revision launches: a registered MFE
 * or an external endpoint, rendered as an iframe, an ESM module, or a Module
 * Federation 2 remote. An MFE target's location comes from the MFE; an
 * external target states it here.
 */
export const applicationLaunchTargets = sqliteTable(
  "application_launch_targets",
  {
    id: id(),
    applicationRevisionId: integer("application_revision_id")
      .notNull()
      .unique()
      .references(() => applicationRevisions.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: LAUNCH_TARGET_KINDS }).notNull(),
    microfrontendId: integer("microfrontend_id").references(() => microfrontends.id, { onDelete: "restrict" }),
    renderingMode: text("rendering_mode", { enum: RENDERING_MODES }).notNull(),
    documentUrl: text("document_url"),
    moduleUrl: text("module_url"),
    exportedModule: text("exported_module"),
    manifestUrl: text("manifest_url"),
    exposedModule: text("exposed_module"),
    /** Mode-specific settings beyond the location, as a canonical JSON object. */
    configuration: text("configuration").notNull().default("{}"),
    /** The externally hosted code's host contract, for an external target that composes children. */
    hostContract: text("host_contract"),
    hostContractDigest: text("host_contract_digest"),
    confirmation: text("confirmation", { enum: RENDERING_CONFIRMATIONS }).notNull(),
    confirmedBy: text("confirmed_by").notNull(),
    confirmedAt: timestamp("confirmed_at").notNull(),
  },
  (t) => [
    index("application_launch_targets_microfrontend").on(t.microfrontendId),
    check("application_launch_targets_kind", sql.raw(`kind IN (${sqlList(LAUNCH_TARGET_KINDS)})`)),
    check("application_launch_targets_rendering_mode", sql.raw(`rendering_mode IN (${sqlList(RENDERING_MODES)})`)),
    check("application_launch_targets_confirmation", sql.raw(`confirmation IN (${sqlList(RENDERING_CONFIRMATIONS)})`)),
    check("application_launch_targets_confirmed_by", sql`length(trim(${t.confirmedBy})) BETWEEN 1 AND 200`),
    check("application_launch_targets_urls", sql`(${urlCheck(t.documentUrl)}) AND (${urlCheck(t.moduleUrl)}) AND (${urlCheck(t.manifestUrl)})`),
    check("application_launch_targets_modules", sql`(${optionalText(t.exportedModule, 200)}) AND (${optionalText(t.exposedModule, 200)})`),
    check("application_launch_targets_configuration", jsonObjectCheck(t.configuration)),
    // Exactly one source, and the location its rendering mode needs.
    check(
      "application_launch_targets_source",
      sql`CASE ${t.kind}
        WHEN 'mfe' THEN ${t.microfrontendId} IS NOT NULL AND ${t.documentUrl} IS NULL AND ${t.moduleUrl} IS NULL AND ${t.manifestUrl} IS NULL AND ${t.hostContract} IS NULL
          AND CASE ${t.renderingMode} WHEN 'iframe' THEN ${t.exportedModule} IS NULL AND ${t.exposedModule} IS NULL
            WHEN 'esm' THEN ${t.exposedModule} IS NULL WHEN 'module_federation_2' THEN ${t.exportedModule} IS NULL ELSE 0 END
        WHEN 'external' THEN ${t.microfrontendId} IS NULL
          AND CASE ${t.renderingMode}
            WHEN 'iframe' THEN ${t.documentUrl} IS NOT NULL AND ${t.moduleUrl} IS NULL AND ${t.exportedModule} IS NULL AND ${t.manifestUrl} IS NULL AND ${t.exposedModule} IS NULL
            WHEN 'esm' THEN ${t.moduleUrl} IS NOT NULL AND ${t.exportedModule} IS NOT NULL AND ${t.documentUrl} IS NULL AND ${t.manifestUrl} IS NULL AND ${t.exposedModule} IS NULL
            WHEN 'module_federation_2' THEN ${t.manifestUrl} IS NOT NULL AND ${t.exposedModule} IS NOT NULL AND ${t.documentUrl} IS NULL AND ${t.moduleUrl} IS NULL AND ${t.exportedModule} IS NULL
            ELSE 0 END
        ELSE 0 END`,
    ),
    check("application_launch_targets_host_contract", sql`(${t.hostContract} IS NULL) = (${t.hostContractDigest} IS NULL) AND (${t.hostContract} IS NULL OR (${jsonObjectCheck(t.hostContract)} AND ${digestCheck(t.hostContractDigest)}))`),
  ],
);

/**
 * A rendering mode the evidence proposed for a submitted revision's launch
 * target, kept beside the confirmed value so a review can explain any
 * difference. Evidence that's unknown proposes nothing.
 */
export const renderingInferenceCandidates = sqliteTable(
  "rendering_inference_candidates",
  {
    id: id(),
    applicationRevisionId: integer("application_revision_id")
      .notNull()
      .references(() => applicationRevisions.id, { onDelete: "restrict" }),
    renderingMode: text("rendering_mode", { enum: RENDERING_MODES }).notNull(),
    /** The location and module the evidence names, as a canonical JSON object. */
    configuration: text("configuration").notNull(),
    source: text("source", { enum: INFERENCE_SOURCES }).notNull(),
    /** What the evidence is: an MFE contract revision or an external observation. */
    evidenceReference: text("evidence_reference").notNull(),
    observationId: integer("observation_id").references((): AnySQLiteColumn => externalObservations.id, { onDelete: "restrict" }),
    observedAt: timestamp("observed_at").notNull(),
    /** True for the candidate the team confirmed. */
    chosen: integer("chosen", { mode: "boolean" }).notNull(),
  },
  (t) => [
    index("rendering_inference_candidates_revision").on(t.applicationRevisionId),
    uniqueIndex("rendering_inference_candidates_chosen").on(t.applicationRevisionId).where(sql`${t.chosen} = 1`),
    check("rendering_inference_candidates_rendering_mode", sql.raw(`rendering_mode IN (${sqlList(RENDERING_MODES)})`)),
    check("rendering_inference_candidates_source", sql.raw(`source IN (${sqlList(INFERENCE_SOURCES)})`)),
    check("rendering_inference_candidates_configuration", jsonObjectCheck(t.configuration)),
    check("rendering_inference_candidates_evidence", sql`length(trim(${t.evidenceReference})) BETWEEN 1 AND 500`),
    check("rendering_inference_candidates_chosen", sql`${t.chosen} IN (0, 1)`),
  ],
);

/**
 * One MFE in a submitted Application revision. The role and mount belong to
 * this binding: the same MFE can be one Application's entry and another's
 * child. An MFE launch target is the one entry; every other binding is a
 * child with a route or slot mount.
 */
export const applicationComponents = sqliteTable(
  "application_components",
  {
    id: id(),
    applicationRevisionId: integer("application_revision_id")
      .notNull()
      .references(() => applicationRevisions.id, { onDelete: "restrict" }),
    microfrontendId: integer("microfrontend_id")
      .notNull()
      .references(() => microfrontends.id, { onDelete: "restrict" }),
    role: text("role", { enum: COMPONENT_ROLES }).notNull(),
    mountKind: text("mount_kind", { enum: MOUNT_KINDS }),
    mountKey: text("mount_key"),
    required: integer("required", { mode: "boolean" }).notNull(),
    /** v1 only: configuration the host passed to the child, as a canonical JSON object. Empty in v2. */
    hostConfiguration: text("host_configuration").notNull().default("{}"),
    /** v2 only: the child's exported or exposed module the host mounts, when the child offers one. */
    module: text("module"),
  },
  (t) => [
    uniqueIndex("application_components_microfrontend").on(t.applicationRevisionId, t.microfrontendId),
    uniqueIndex("application_components_one_entry").on(t.applicationRevisionId).where(sql`${t.role} = 'entry'`),
    uniqueIndex("application_components_mount").on(t.applicationRevisionId, t.mountKind, t.mountKey).where(sql`${t.role} = 'child'`),
    index("application_components_microfrontend_uses").on(t.microfrontendId),
    check("application_components_role", sql.raw(`role IN (${sqlList(COMPONENT_ROLES)})`)),
    check(
      "application_components_mount",
      sql`CASE ${t.role}
        WHEN 'entry' THEN ${t.mountKind} IS NULL AND ${t.mountKey} IS NULL AND ${t.required} = 1
        WHEN 'child' THEN ${t.mountKind} IS NOT NULL AND ${t.mountKey} IS NOT NULL AND ${t.mountKind} IN ('route', 'slot') AND length(${t.mountKey}) BETWEEN 1 AND 200
          AND CASE ${t.mountKind} WHEN 'route' THEN ${routeCheck(t.mountKey)} ELSE ${keyCheck(t.mountKey, 64)} END
        ELSE 0 END`,
    ),
    check("application_components_required", sql`${t.required} IN (0, 1)`),
    check("application_components_host_configuration", jsonObjectCheck(t.hostConfiguration)),
    check("application_components_module", optionalText(t.module, 200)),
  ],
);

// ---------------------------------------------------------------------------
// Placements and reviews

/** The stable identity of one placement of an Application in a Portal. An Application can have several, even in one Portal. */
export const applicationPlacements = sqliteTable(
  "application_placements",
  {
    id: id(),
    publicId: publicId(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    portalId: integer("portal_id")
      .notNull()
      .references(() => portals.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [index("application_placements_application").on(t.applicationId), index("application_placements_portal").on(t.portalId), check("application_placements_public_id", sql`${t.publicId} GLOB 'plc_*'`)],
);

/** What one submitted Application revision requests for one placement: the placement's revision. */
export const placementRequests = sqliteTable(
  "placement_requests",
  {
    id: id(),
    placementId: integer("placement_id")
      .notNull()
      .references(() => applicationPlacements.id, { onDelete: "restrict" }),
    applicationRevisionId: integer("application_revision_id")
      .notNull()
      .references(() => applicationRevisions.id, { onDelete: "restrict" }),
    menuParentKey: text("menu_parent_key"),
    route: text("route").notNull(),
    label: text("label").notNull(),
    ordering: integer("ordering").notNull(),
    entitlements: text("entitlements").notNull(),
    entitlementsDigest: text("entitlements_digest").notNull(),
    defaultRequested: integer("default_requested", { mode: "boolean" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("placement_requests_revision").on(t.placementId, t.applicationRevisionId),
    index("placement_requests_application_revision").on(t.applicationRevisionId),
    check("placement_requests_menu_parent", sql`${t.menuParentKey} IS NULL OR ${keyCheck(t.menuParentKey, 64)}`),
    check("placement_requests_route", routeCheck(t.route)),
    check("placement_requests_label", sql`length(trim(${t.label})) BETWEEN 1 AND 100`),
    check("placement_requests_ordering", sql`${t.ordering} BETWEEN 0 AND 100000`),
    check("placement_requests_entitlements", jsonObjectCheck(t.entitlements)),
    check("placement_requests_entitlements_digest", digestCheck(t.entitlementsDigest)),
    check("placement_requests_default", sql`${t.defaultRequested} IN (0, 1)`),
  ],
);

export const placementRequestEnvironments = sqliteTable(
  "placement_request_environments",
  {
    id: id(),
    placementRequestId: integer("placement_request_id")
      .notNull()
      .references(() => placementRequests.id, { onDelete: "restrict" }),
    environment: text("environment").notNull(),
  },
  (t) => [uniqueIndex("placement_request_environments_environment").on(t.placementRequestId, t.environment), check("placement_request_environments_environment", keyCheck(t.environment, 32))],
);

/**
 * A decision about one placement request, against the exact Portal and
 * Application revisions it evaluated. Its sequence is the number of earlier
 * decisions about the request, so a decision made from a stale page can't be
 * recorded. Approval records the values the Portal owner accepted.
 */
export const placementDecisions = sqliteTable(
  "placement_decisions",
  {
    id: id(),
    publicId: publicId(),
    placementId: integer("placement_id")
      .notNull()
      .references(() => applicationPlacements.id, { onDelete: "restrict" }),
    placementRequestId: integer("placement_request_id")
      .notNull()
      .references(() => placementRequests.id, { onDelete: "restrict" }),
    portalRevisionId: integer("portal_revision_id")
      .notNull()
      .references(() => portalRevisions.id, { onDelete: "restrict" }),
    applicationRevisionId: integer("application_revision_id")
      .notNull()
      .references(() => applicationRevisions.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    decision: text("decision", { enum: PLACEMENT_DECISIONS }).notNull(),
    reason: text("reason"),
    acceptedRoute: text("accepted_route"),
    acceptedMenuParentKey: text("accepted_menu_parent_key"),
    acceptedLabel: text("accepted_label"),
    acceptedOrdering: integer("accepted_ordering"),
    acceptedEntitlements: text("accepted_entitlements"),
    /** The environments this approval made it the default of, as a JSON array. */
    acceptedDefaults: text("accepted_defaults"),
    actor: text("actor").notNull(),
    attribution: text("attribution", { enum: ATTRIBUTIONS }).notNull(),
    decidedAt: timestamp("decided_at").notNull(),
  },
  (t) => [
    uniqueIndex("placement_decisions_sequence").on(t.placementRequestId, t.sequence),
    index("placement_decisions_placement").on(t.placementId, t.decidedAt),
    check("placement_decisions_public_id", sql`${t.publicId} GLOB 'pdc_*'`),
    check("placement_decisions_sequence", sql`${t.sequence} >= 0`),
    check("placement_decisions_decision", sql.raw(`decision IN (${sqlList(PLACEMENT_DECISIONS)})`)),
    check("placement_decisions_reason", sql`CASE WHEN ${t.decision} IN ('reject', 'retire') THEN ${t.reason} IS NOT NULL AND length(trim(${t.reason})) BETWEEN 1 AND 1000 ELSE ${optionalText(t.reason, 1000)} END`),
    check(
      "placement_decisions_accepted",
      sql`CASE ${t.decision}
        WHEN 'approve' THEN ${t.acceptedRoute} IS NOT NULL AND ${routeCheck(t.acceptedRoute)} AND ${t.acceptedLabel} IS NOT NULL AND length(trim(${t.acceptedLabel})) BETWEEN 1 AND 100
          AND ${t.acceptedOrdering} IS NOT NULL AND ${t.acceptedOrdering} BETWEEN 0 AND 100000 AND (${t.acceptedMenuParentKey} IS NULL OR ${keyCheck(t.acceptedMenuParentKey, 64)})
          AND ${t.acceptedEntitlements} IS NOT NULL AND ${jsonObjectCheck(t.acceptedEntitlements)} AND ${t.acceptedDefaults} IS NOT NULL AND ${jsonArrayCheck(t.acceptedDefaults)}
        ELSE ${t.acceptedRoute} IS NULL AND ${t.acceptedMenuParentKey} IS NULL AND ${t.acceptedLabel} IS NULL AND ${t.acceptedOrdering} IS NULL AND ${t.acceptedEntitlements} IS NULL AND ${t.acceptedDefaults} IS NULL END`,
    ),
    ...attributionChecks("placement_decisions", t.actor, t.attribution),
  ],
);

/**
 * The routes approved placements occupy, one row per environment. A partial
 * unique index lets one active row hold a normalized route in a Portal
 * environment; a row is only ever deactivated.
 */
export const placementRoutes = sqliteTable(
  "placement_routes",
  {
    id: id(),
    placementId: integer("placement_id")
      .notNull()
      .references(() => applicationPlacements.id, { onDelete: "restrict" }),
    decisionId: integer("decision_id")
      .notNull()
      .references(() => placementDecisions.id, { onDelete: "restrict" }),
    portalId: integer("portal_id")
      .notNull()
      .references(() => portals.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    environment: text("environment").notNull(),
    route: text("route").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    activatedAt: timestamp("activated_at").notNull(),
    deactivatedAt: timestamp("deactivated_at"),
  },
  (t) => [
    uniqueIndex("placement_routes_active_route").on(t.portalId, t.environment, t.route).where(sql`${t.active} = 1`),
    index("placement_routes_placement").on(t.placementId, t.active),
    check("placement_routes_environment", keyCheck(t.environment, 32)),
    check("placement_routes_route", routeCheck(t.route)),
    check("placement_routes_active", sql`${t.active} IN (0, 1) AND (${t.active} = 1) = (${t.deactivatedAt} IS NULL)`),
  ],
);

/** Each assignment of a Portal environment's default placement, newest current; null clears it. */
export const portalDefaultRoutes = sqliteTable(
  "portal_default_routes",
  {
    id: id(),
    portalId: integer("portal_id")
      .notNull()
      .references(() => portals.id, { onDelete: "restrict" }),
    environment: text("environment").notNull(),
    sequence: integer("sequence").notNull(),
    placementId: integer("placement_id").references(() => applicationPlacements.id, { onDelete: "restrict" }),
    decisionId: integer("decision_id").references(() => placementDecisions.id, { onDelete: "restrict" }),
    actor: text("actor").notNull(),
    attribution: text("attribution", { enum: ATTRIBUTIONS }).notNull(),
    assignedAt: timestamp("assigned_at").notNull(),
  },
  (t) => [
    uniqueIndex("portal_default_routes_sequence").on(t.portalId, t.environment, t.sequence),
    check("portal_default_routes_environment", keyCheck(t.environment, 32)),
    check("portal_default_routes_sequence", sql`${t.sequence} >= 0`),
    ...attributionChecks("portal_default_routes", t.actor, t.attribution),
  ],
);

// ---------------------------------------------------------------------------
// External references and observations

/**
 * An explicit mapping from an onboarding record to a Studio or CDaaS
 * resource. It's evidence someone stated or Fabricate discovered, never an
 * identity inferred from a name or another system's identifier.
 */
export const externalReferences = sqliteTable(
  "external_references",
  {
    id: id(),
    publicId: publicId(),
    system: text("system", { enum: EXTERNAL_SYSTEMS }).notNull(),
    resourceType: text("resource_type", { enum: EXTERNAL_RESOURCE_TYPES }).notNull(),
    externalId: text("external_id").notNull(),
    /** The Studio environment the resource belongs to, when it's environment-specific. */
    environment: text("environment"),
    portalId: integer("portal_id").references(() => portals.id, { onDelete: "restrict" }),
    applicationId: integer("application_id").references(() => applications.id, { onDelete: "restrict" }),
    microfrontendId: integer("microfrontend_id").references(() => microfrontends.id, { onDelete: "restrict" }),
    placementId: integer("placement_id").references(() => applicationPlacements.id, { onDelete: "restrict" }),
    /** "portal:12", "application:3", ...: the one record it maps. */
    subject: text("subject").notNull(),
    source: text("source", { enum: REFERENCE_SOURCES }).notNull(),
    providedBy: text("provided_by").notNull(),
    attribution: text("attribution", { enum: ATTRIBUTIONS }).notNull(),
    recordedAt: timestamp("recorded_at").notNull(),
    retiredAt: timestamp("retired_at"),
  },
  (t) => [
    uniqueIndex("external_references_resource").on(t.system, t.resourceType, t.externalId, sql`ifnull(${t.environment}, '')`).where(sql`${t.retiredAt} IS NULL`),
    uniqueIndex("external_references_subject").on(t.subject, t.system, t.resourceType, sql`ifnull(${t.environment}, '')`).where(sql`${t.retiredAt} IS NULL`),
    check("external_references_public_id", sql`${t.publicId} GLOB 'xrf_*'`),
    check("external_references_system", sql.raw(`system IN (${sqlList(EXTERNAL_SYSTEMS)})`)),
    check("external_references_resource_type", sql.raw(`resource_type IN (${sqlList(EXTERNAL_RESOURCE_TYPES)})`)),
    check("external_references_external_id", externalIdCheck(t.externalId)),
    check("external_references_environment", sql`${t.environment} IS NULL OR ${keyCheck(t.environment, 32)}`),
    check("external_references_source", sql.raw(`source IN (${sqlList(REFERENCE_SOURCES)})`)),
    check(
      "external_references_subject",
      sql`${t.subject} IS CASE
        WHEN ${t.portalId} IS NOT NULL AND ${t.applicationId} IS NULL AND ${t.microfrontendId} IS NULL AND ${t.placementId} IS NULL THEN 'portal:' || ${t.portalId}
        WHEN ${t.applicationId} IS NOT NULL AND ${t.portalId} IS NULL AND ${t.microfrontendId} IS NULL AND ${t.placementId} IS NULL THEN 'application:' || ${t.applicationId}
        WHEN ${t.microfrontendId} IS NOT NULL AND ${t.portalId} IS NULL AND ${t.applicationId} IS NULL AND ${t.placementId} IS NULL THEN 'microfrontend:' || ${t.microfrontendId}
        WHEN ${t.placementId} IS NOT NULL AND ${t.portalId} IS NULL AND ${t.applicationId} IS NULL AND ${t.microfrontendId} IS NULL THEN 'placement:' || ${t.placementId}
        END`,
    ),
    // Which resource types each system has, and which record each maps.
    check(
      "external_references_mapping",
      sql`CASE ${t.system}
        WHEN 'studio' THEN (${t.resourceType} = 'channel' AND ${t.portalId} IS NOT NULL) OR (${t.resourceType} = 'module_group' AND ${t.applicationId} IS NOT NULL)
          OR (${t.resourceType} = 'module' AND ${t.microfrontendId} IS NOT NULL) OR (${t.resourceType} = 'menu' AND ${t.placementId} IS NOT NULL AND ${t.environment} IS NOT NULL)
          OR (${t.resourceType} = 'environment' AND ${t.portalId} IS NOT NULL AND ${t.environment} IS NOT NULL)
        WHEN 'cdaas' THEN ${t.resourceType} = 'application_view' AND ${t.microfrontendId} IS NOT NULL AND ${t.externalId} GLOB '?*/?*'
        ELSE 0 END`,
    ),
    check("external_references_provided_by", sql`length(trim(${t.providedBy})) BETWEEN 1 AND 200`),
    check("external_references_attribution", sql.raw(`attribution IN (${sqlList(ATTRIBUTIONS)})`)),
  ],
);

/**
 * A distinct state of an external resource, as a canonical projection of
 * what a read returned and the contract it was read under. Identical reads
 * share one observation; external_reads keeps every read.
 */
export const externalObservations = sqliteTable(
  "external_observations",
  {
    id: id(),
    referenceId: integer("reference_id")
      .notNull()
      .references(() => externalReferences.id, { onDelete: "restrict" }),
    outcome: text("outcome", { enum: OBSERVATION_OUTCOMES }).notNull(),
    /** SHA-256 of the vendored OpenAPI contract the adapter read under. */
    contractDigest: text("contract_digest").notNull(),
    projection: text("projection"),
    projectionDigest: text("projection_digest").notNull(),
    firstObservedAt: timestamp("first_observed_at").notNull(),
  },
  (t) => [
    uniqueIndex("external_observations_state").on(t.referenceId, t.outcome, t.contractDigest, t.projectionDigest),
    check("external_observations_outcome", sql.raw(`outcome IN (${sqlList(OBSERVATION_OUTCOMES)})`)),
    check("external_observations_contract_digest", digestCheck(t.contractDigest)),
    check("external_observations_projection_digest", digestCheck(t.projectionDigest)),
    check("external_observations_projection", sql`CASE ${t.outcome} WHEN 'found' THEN ${t.projection} IS NOT NULL AND ${jsonObjectCheck(t.projection)} ELSE ${t.projection} IS NULL END`),
  ],
);

/** Every read of an external resource: what it observed, or why it couldn't. */
export const externalReads = sqliteTable(
  "external_reads",
  {
    id: id(),
    referenceId: integer("reference_id")
      .notNull()
      .references(() => externalReferences.id, { onDelete: "restrict" }),
    observationId: integer("observation_id").references(() => externalObservations.id, { onDelete: "restrict" }),
    outcome: text("outcome", { enum: READ_OUTCOMES }).notNull(),
    /** Why a read was unavailable or incompatible; never a response body or a credential. */
    error: text("error"),
    readAt: timestamp("read_at").notNull(),
  },
  (t) => [
    index("external_reads_reference").on(t.referenceId, t.readAt),
    check("external_reads_outcome", sql.raw(`outcome IN (${sqlList(READ_OUTCOMES)})`)),
    check("external_reads_observation", sql`(${t.outcome} = 'unavailable') = (${t.observationId} IS NULL)`),
    check("external_reads_error", sql`CASE WHEN ${t.outcome} IN ('unavailable', 'incompatible') THEN ${t.error} IS NOT NULL AND length(${t.error}) BETWEEN 1 AND 500 ELSE ${t.error} IS NULL END`),
  ],
);

/**
 * Every read of Studio's environment list (design decision 1). The latest
 * read that found a list under the pinned contract is the environment
 * catalog teams choose from; with none, the catalog is the committed
 * fallback set. A read that failed or didn't fit the contract records why
 * and replaces nothing. No one creates or edits an environment here.
 */
export const environmentCatalogReads = sqliteTable(
  "environment_catalog_reads",
  {
    id: id(),
    outcome: text("outcome", { enum: CATALOG_READ_OUTCOMES }).notNull(),
    /** SHA-256 of the vendored Studio contract the adapter read under. */
    contractDigest: text("contract_digest").notNull(),
    /** A found list's canonical environments, and their digest. */
    environments: text("environments"),
    environmentsDigest: text("environments_digest"),
    /** Why a read was unavailable or incompatible; never a response body or a credential. */
    error: text("error"),
    readAt: timestamp("read_at").notNull(),
  },
  (t) => [
    index("environment_catalog_reads_read_at").on(t.readAt),
    check("environment_catalog_reads_outcome", sql.raw(`outcome IN (${sqlList(CATALOG_READ_OUTCOMES)})`)),
    check("environment_catalog_reads_contract_digest", digestCheck(t.contractDigest)),
    check(
      "environment_catalog_reads_found",
      sql`CASE ${t.outcome} WHEN 'found' THEN ${t.environments} IS NOT NULL AND ${jsonArrayCheck(t.environments)} AND ${t.environmentsDigest} IS NOT NULL AND ${digestCheck(t.environmentsDigest)} AND ${t.error} IS NULL
        ELSE ${t.environments} IS NULL AND ${t.environmentsDigest} IS NULL AND ${t.error} IS NOT NULL AND length(${t.error}) BETWEEN 1 AND 500 END`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Validation and lifecycle history

/** One validation of a revision's document: every issue found, with a stable code and location. */
export const onboardingValidations = sqliteTable(
  "onboarding_validations",
  {
    id: id(),
    subject: text("subject", { enum: ONBOARDING_SUBJECTS }).notNull(),
    portalRevisionId: integer("portal_revision_id").references(() => portalRevisions.id, { onDelete: "restrict" }),
    applicationRevisionId: integer("application_revision_id").references(() => applicationRevisions.id, { onDelete: "restrict" }),
    microfrontendRevisionId: integer("microfrontend_revision_id").references(() => microfrontendRevisions.id, { onDelete: "restrict" }),
    /** SHA-256 of the document the validation evaluated. */
    documentDigest: text("document_digest").notNull(),
    blocking: integer("blocking").notNull(),
    issues: text("issues").notNull(),
    evaluatedAt: timestamp("evaluated_at").notNull(),
  },
  (t) => [
    index("onboarding_validations_portal").on(t.portalRevisionId, t.evaluatedAt),
    index("onboarding_validations_application").on(t.applicationRevisionId, t.evaluatedAt),
    index("onboarding_validations_microfrontend").on(t.microfrontendRevisionId, t.evaluatedAt),
    check("onboarding_validations_subject", sql`CASE ${t.subject}
      WHEN 'portal' THEN ${t.portalRevisionId} IS NOT NULL AND ${t.applicationRevisionId} IS NULL AND ${t.microfrontendRevisionId} IS NULL
      WHEN 'application' THEN ${t.applicationRevisionId} IS NOT NULL AND ${t.portalRevisionId} IS NULL AND ${t.microfrontendRevisionId} IS NULL
      WHEN 'microfrontend' THEN ${t.microfrontendRevisionId} IS NOT NULL AND ${t.portalRevisionId} IS NULL AND ${t.applicationRevisionId} IS NULL
      ELSE 0 END`),
    check("onboarding_validations_document_digest", digestCheck(t.documentDigest)),
    check("onboarding_validations_blocking", sql`${t.blocking} >= 0`),
    check("onboarding_validations_issues", jsonArrayCheck(t.issues)),
  ],
);

/** Each change to an onboarding record's lifecycle or revisions, with who made it. */
export const onboardingEvents = sqliteTable(
  "onboarding_events",
  {
    id: id(),
    subject: text("subject", { enum: ONBOARDING_SUBJECTS }).notNull(),
    portalId: integer("portal_id").references(() => portals.id, { onDelete: "restrict" }),
    applicationId: integer("application_id").references(() => applications.id, { onDelete: "restrict" }),
    microfrontendId: integer("microfrontend_id").references(() => microfrontends.id, { onDelete: "restrict" }),
    /** The revision number the event concerns, when it concerns one. */
    revision: integer("revision"),
    event: text("event", { enum: ONBOARDING_EVENTS }).notNull(),
    fromLifecycle: text("from_lifecycle", { enum: LIFECYCLE_STATES }),
    toLifecycle: text("to_lifecycle", { enum: LIFECYCLE_STATES }),
    reason: text("reason"),
    actor: text("actor").notNull(),
    attribution: text("attribution", { enum: ATTRIBUTIONS }).notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
  },
  (t) => [
    index("onboarding_events_portal").on(t.portalId, t.occurredAt),
    index("onboarding_events_application").on(t.applicationId, t.occurredAt),
    index("onboarding_events_microfrontend").on(t.microfrontendId, t.occurredAt),
    check("onboarding_events_subject", sql`CASE ${t.subject}
      WHEN 'portal' THEN ${t.portalId} IS NOT NULL AND ${t.applicationId} IS NULL AND ${t.microfrontendId} IS NULL
      WHEN 'application' THEN ${t.applicationId} IS NOT NULL AND ${t.portalId} IS NULL AND ${t.microfrontendId} IS NULL
      WHEN 'microfrontend' THEN ${t.microfrontendId} IS NOT NULL AND ${t.portalId} IS NULL AND ${t.applicationId} IS NULL
      ELSE 0 END`),
    check("onboarding_events_event", sql.raw(`event IN (${sqlList(ONBOARDING_EVENTS)})`)),
    check("onboarding_events_lifecycle", sql.raw(`(from_lifecycle IS NULL OR from_lifecycle IN (${sqlList(LIFECYCLE_STATES)})) AND (to_lifecycle IS NULL OR to_lifecycle IN (${sqlList(LIFECYCLE_STATES)}))`)),
    check("onboarding_events_revision", sql`${t.revision} IS NULL OR ${t.revision} >= 1`),
    check("onboarding_events_reason", sql`CASE WHEN ${t.event} = 'retired' THEN ${t.reason} IS NOT NULL AND length(trim(${t.reason})) BETWEEN 1 AND 1000 ELSE ${optionalText(t.reason, 1000)} END`),
    ...attributionChecks("onboarding_events", t.actor, t.attribution),
  ],
);
