import { type JsonObject, compareCodeUnits } from "@repo-facts/contract";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type EnvironmentCatalogSource, type LifecycleState, onboardingEvents, placementRoutes, portalEnvironments, portalMenuGroups, portalRevisions, portals } from "@/lib/db/schema";
import { SEAL_ID, labelKey } from "@/lib/ownership/records";
import { type Actor, recordEvent } from "./attribution";
import { contractLabel } from "./contracts";
import { issuesOf, type PortalContract } from "./documents";
import { ENVIRONMENT_KEY, type EnvironmentCatalog, environmentCatalog, inCatalogOrder } from "./environments";
import { retireReferencesOf } from "./external/references";
import { type PortalDraft, canonicalDocument, draftOfDocument, emptyPortalDraft, portalDraftSchema } from "./formats";
import { BlockedError, IssueList, type ValidationIssue } from "./issues";
import { activeRoutes, currentDefault } from "./placements";
import { type Revision, type SubmitResult, draftOf, latestSubmitted, revisionById, saveDraft, startDraft, submitDraft } from "./revisions";

/*
 * Portal onboarding (portals spec). A Portal is configuration its team
 * owns: an owning team, an optional SEAL ID, the catalog environments it
 * enables, and a hierarchy of non-actionable menu groups. It owns no code,
 * runtime, rendering policy, entitlement catalog, or host contract.
 * Applications ask for placements in it, each with its own environments and
 * entitlements, and its owner reviews them. A Portal moves from Draft to
 * Ready when a revision passes validation, to Active when its owner
 * activates a revision with a default route in every enabled environment,
 * and to Retired with a reason. An Active Portal's edits wait in a later
 * revision until that revision is activated.
 */

export type Portal = typeof portals.$inferSelect;

export { ENVIRONMENT_KEY, emptyPortalDraft, portalDraftSchema, type PortalDraft };
export const MENU_KEY = /^[a-z][a-z0-9-]{0,63}$/;
export const MAX_MENU_DEPTH = 5;

/** A revision's Draft as v2 reads it: a v1 Draft is converted, its removed values kept as history. */
export function readPortalDraft(revision: Pick<Revision, "number" | "formatVersion" | "document">): PortalDraft {
  return draftOfDocument("portal", revision);
}

export function findPortal(db: Executor, publicId: string): Portal | undefined {
  return db.select().from(portals).where(eq(portals.publicId, publicId)).get();
}

export function getPortal(db: Executor, publicId: string): Portal {
  const portal = findPortal(db, publicId);
  if (!portal) throw new NotFoundError(`Portal ${publicId} doesn't exist`);
  return portal;
}

// ---------------------------------------------------------------------------
// Creating and editing

export interface PortalInput {
  name: string;
  ownerTeam?: string | null;
  sealId?: string | null;
}

/**
 * Starts onboarding a Portal: a new one, or a Portal first named in an
 * ownership claim that no one has onboarded, which keeps its identity and
 * its claims. A Portal name is one Portal; another onboarded Portal can't
 * take it.
 */
export function createPortal(db: Executor, input: PortalInput, actor: Actor): { portal: Portal; draft: Revision; adopted: boolean } {
  return immediate(db, (tx) => {
    const issues: { field: string; message: string }[] = [];
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name) issues.push({ field: "name", message: "Enter the Portal's name" });
    else if (name.length > 100) issues.push({ field: "name", message: "Use 100 characters or fewer" });
    const sealId = input.sealId?.trim() || null;
    if (sealId && !SEAL_ID.test(sealId)) issues.push({ field: "sealId", message: "Enter a SEAL ID of letters, digits, dots, dashes, or underscores" });
    const ownerTeam = input.ownerTeam?.trim().replace(/\s+/g, " ") || null;
    if (ownerTeam && ownerTeam.length > 200) issues.push({ field: "ownerTeam", message: "Use 200 characters or fewer" });
    const existing = name ? tx.select().from(portals).where(eq(portals.labelKey, labelKey(name))).get() : undefined;
    if (existing && (existing.activeRevisionId !== null || existing.draftRevisionId !== null || tx.select().from(portalRevisions).where(eq(portalRevisions.portalId, existing.id)).get())) {
      issues.push({ field: "name", message: `A Portal named ${existing.label} is already onboarded` });
    }
    if (issues.length) throw new ValidationError(issues);

    const portal = existing
      ? tx.update(portals).set({ sealId, ownerTeam }).where(eq(portals.id, existing.id)).returning().get()
      : tx.insert(portals).values({ publicId: generatePublicId("ptl"), label: name, labelKey: labelKey(name), sealId, ownerTeam, createdAt: new Date() }).returning().get();
    recordEvent(tx, "portal", portal.id, { event: "created", actor, to: portal.lifecycle, reason: existing ? "Onboarding a Portal first named in an ownership claim" : null });
    const draft = startDraft(tx, "portal", portal.id, actor, emptyPortalDraft({ ownerTeam, sealId }) as unknown as JsonObject);
    return { portal: findPortal(tx, portal.publicId)!, draft, adopted: existing !== undefined };
  });
}

/** Opens the Portal's Draft, starting one from its latest submitted revision when it has none. */
export function startPortalDraft(db: Executor, publicId: string, actor: Actor): Revision {
  const portal = getPortal(db, publicId);
  if (portal.lifecycle === "retired") throw new TransitionError(`${portal.label} is retired, so it can't change`);
  return startDraft(db, "portal", portal.id, actor, emptyPortalDraft({ ownerTeam: portal.ownerTeam, sealId: portal.sealId }) as unknown as JsonObject);
}

/**
 * Saves the Draft. Its shape is checked, so a runtime, contract, or Portal
 * entitlement is refused outside `legacy`; its values are checked when it's
 * submitted.
 */
export function savePortalDraft(db: Executor, publicId: string, input: { lockVersion: number; document: unknown }): Revision {
  const portal = getPortal(db, publicId);
  const parsed = portalDraftSchema.safeParse(input.document);
  if (!parsed.success) throw new ValidationError(issuesOf(parsed.error, ""));
  return saveDraft(db, "portal", portal.id, { lockVersion: input.lockVersion, document: parsed.data });
}

// ---------------------------------------------------------------------------
// Validation

export interface ValidatedPortal {
  document: JsonObject;
  ownerTeam: string;
  sealId: string | null;
  /** The keys of the catalog environments the Portal enables, in catalog order. */
  environments: string[];
  menu: { key: string; label: string; parent: string | null; order: number }[];
  /** The catalog the environments were checked against. */
  catalog: { source: EnvironmentCatalogSource; digest: string };
}

/**
 * Validates a Portal Draft completely, reporting every issue at its field:
 * the owning team and SEAL ID, at least one environment from the catalog,
 * the menu hierarchy, and any choice a conversion from v1 left to the team.
 * Nothing asks for a runtime, a contract, or Portal entitlements. Returns
 * the canonical v2 revision when nothing blocks.
 */
export function validatePortalDraft(draft: PortalDraft, catalog: Pick<EnvironmentCatalog, "source" | "environments" | "digest">): { issues: ValidationIssue[]; portal: ValidatedPortal | null } {
  const issues = new IssueList();
  const ownerTeam = draft.ownerTeam?.trim().replace(/\s+/g, " ") ?? "";
  if (!ownerTeam) issues.block("portal.owner_missing", "ownerTeam", "Enter the team that owns this Portal");
  else if (ownerTeam.length > 200) issues.block("portal.owner_invalid", "ownerTeam", "Use 200 characters or fewer");
  const sealId = draft.sealId?.trim() || null;
  if (sealId && !SEAL_ID.test(sealId)) issues.block("portal.seal_invalid", "sealId", "Enter a SEAL ID of letters, digits, dots, dashes, or underscores");

  const listed = new Set(catalog.environments.map((environment) => environment.key));
  const keys = draft.environments.map((key) => key.trim());
  if (keys.length === 0) issues.block("portal.environment_missing", "environments", "Choose at least one environment the Portal enables");
  keys.forEach((key, index) => {
    if (!ENVIRONMENT_KEY.test(key)) issues.block("portal.environment_key_invalid", `environments.${index}`, "An environment is chosen from the catalog, such as UAT or PROD");
    else if (keys.indexOf(key) !== index) issues.block("portal.environment_duplicate", `environments.${index}`, `${key.toUpperCase()} is chosen more than once`);
    else if (!listed.has(key)) issues.block("portal.environment_unknown", `environments.${index}`, `${key.toUpperCase()} isn't in the ${catalog.source === "studio" ? "Studio" : "fallback"} environment catalog. Choose one it lists`);
  });
  const menu = validateMenu(draft, issues);
  for (const issue of draft.legacy?.issues ?? []) issues.block(issue.code, issue.location, issue.message);

  if (issues.blocking.length > 0) return { issues: issues.issues, portal: null };
  const environments = inCatalogOrder(catalog, keys);
  const document = canonicalDocument("portal", 2, { ownerTeam, sealId, environments, menu: menu.map((group) => ({ key: group.key, label: group.label, parent: group.parent, order: group.order })) }).value;
  return { issues: issues.issues, portal: { document, ownerTeam, sealId, environments, menu, catalog: { source: catalog.source, digest: catalog.digest } } };
}

/** Checks the menu hierarchy: unique keys, existing parents, no cycles, and a bounded depth. */
function validateMenu(draft: PortalDraft, issues: IssueList): ValidatedPortal["menu"] {
  const keys = draft.menu.map((group) => group.key.trim());
  const groups: ValidatedPortal["menu"] = [];
  draft.menu.forEach((group, index) => {
    const at = `menu.${index}`;
    const key = keys[index]!;
    const label = group.label.trim().replace(/\s+/g, " ");
    const parent = group.parent?.trim() || null;
    let valid = true;
    if (!MENU_KEY.test(key)) {
      issues.block("portal.menu_key_invalid", `${at}.key`, "A menu key is lowercase letters, digits, and dashes, starting with a letter");
      valid = false;
    } else if (keys.indexOf(key) !== index) {
      issues.block("portal.menu_duplicate", `${at}.key`, `The menu key ${key} is used more than once`);
      valid = false;
    }
    if (!label || label.length > 100) {
      issues.block("portal.menu_label_invalid", `${at}.label`, "Enter a label of 100 characters or fewer");
      valid = false;
    }
    if (parent !== null && !keys.includes(parent)) {
      issues.block("portal.menu_parent_missing", `${at}.parent`, `There's no menu group ${parent}`);
      valid = false;
    }
    if (valid) groups.push({ key, label, parent, order: group.order });
  });
  const parentOf = new Map(groups.map((group) => [group.key, group.parent]));
  groups.forEach((group) => {
    const seen = new Set<string>([group.key]);
    let depth = 1;
    for (let parent = group.parent; parent !== null; parent = parentOf.get(parent) ?? null) {
      if (seen.has(parent)) {
        issues.block("portal.menu_cycle", `menu.${keys.indexOf(group.key)}.parent`, `The menu group ${group.key} is inside itself`);
        return;
      }
      seen.add(parent);
      depth++;
    }
    if (depth > MAX_MENU_DEPTH) issues.block("portal.menu_too_deep", `menu.${keys.indexOf(group.key)}.parent`, `Menus nest at most ${MAX_MENU_DEPTH} levels deep`);
  });
  return groups.sort((a, b) => compareCodeUnits(a.key, b.key));
}

/** Groups ordered so each parent is written before its children. */
function parentsFirst(groups: ValidatedPortal["menu"]): ValidatedPortal["menu"] {
  const ordered: ValidatedPortal["menu"] = [];
  const placed = new Set<string>();
  while (ordered.length < groups.length) {
    for (const group of groups) {
      if (placed.has(group.key) || (group.parent !== null && !placed.has(group.parent))) continue;
      ordered.push(group);
      placed.add(group.key);
    }
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Submission and lifecycle

/**
 * Submits the Portal's Draft, validating it against the environment catalog
 * in use now. With no blocking issue, its enabled environments and menu
 * groups are frozen with the revision, beside the catalog's source and
 * digest, and a Draft Portal becomes Ready. An Active Portal keeps its
 * active revision until this one is activated.
 */
export function submitPortal(db: Executor, publicId: string, input: { lockVersion: number; actor: Actor }): SubmitResult {
  const portal = getPortal(db, publicId);
  if (portal.lifecycle === "retired") throw new TransitionError(`${portal.label} is retired, so it can't change`);
  return submitDraft(db, "portal", portal.id, {
    lockVersion: input.lockVersion,
    actor: input.actor,
    prepare: (tx, draft) => {
      const { issues, portal: validated } = validatePortalDraft(readPortalDraft(draft), environmentCatalog(tx));
      if (!validated) return { issues, activate: false };
      return {
        issues,
        document: validated.document,
        activate: false,
        revisionColumns: { owner_team: validated.ownerTeam, seal_id: validated.sealId, environment_catalog_source: validated.catalog.source, environment_catalog_digest: validated.catalog.digest },
        identityColumns: { owner_team: validated.ownerTeam, seal_id: validated.sealId },
        freeze: (tx2, revisionId) => {
          for (const environment of validated.environments) tx2.insert(portalEnvironments).values({ portalRevisionId: revisionId, environment, enabled: true }).run();
          for (const group of parentsFirst(validated.menu)) tx2.insert(portalMenuGroups).values({ portalRevisionId: revisionId, key: group.key, parentKey: group.parent, label: group.label, ordering: group.order }).run();
        },
        after: (tx2, revision) => {
          if (portal.lifecycle === "draft") transition(tx2, portal, "ready", { event: "ready", revision: revision.number, actor: input.actor });
        },
      };
    },
  });
}

function transition(db: Executor, portal: Portal, to: LifecycleState, event: Parameters<typeof recordEvent>[3], columns: Partial<Pick<Portal, "activeRevisionId">> = {}): Portal {
  const updated = db
    .update(portals)
    .set({ lifecycle: to, lockVersion: sql`${portals.lockVersion} + 1`, ...columns })
    .where(eq(portals.id, portal.id))
    .returning()
    .get();
  recordEvent(db, "portal", portal.id, { ...event, from: portal.lifecycle, to });
  return updated;
}

/**
 * What stops a submitted revision from being activated: an enabled
 * environment with no default placement, or an approved placement whose
 * accepted menu parent the revision no longer has.
 */
export function activationIssues(db: Executor, portal: Portal, revision: Revision): ValidationIssue[] {
  const issues = new IssueList();
  const environments = db.select().from(portalEnvironments).where(eq(portalEnvironments.portalRevisionId, revision.id)).orderBy(asc(portalEnvironments.environment)).all();
  for (const environment of environments.filter((item) => item.enabled)) {
    const assigned = currentDefault(db, portal.id, environment.environment);
    if (!assigned.placementId) issues.block("portal.default_missing", `environments.${environment.environment}.default`, `${environment.environment.toUpperCase()} has no default route. Approve a placement in it and make it the default`);
  }
  const groups = new Set(db.select({ key: portalMenuGroups.key }).from(portalMenuGroups).where(eq(portalMenuGroups.portalRevisionId, revision.id)).all().map((group) => group.key));
  for (const route of activeRoutes(db, portal.id)) {
    if (route.menuParentKey && !groups.has(route.menuParentKey)) {
      issues.block("portal.menu_parent_removed", `placements.${route.placement}`, `Revision ${revision.number} has no menu group ${route.menuParentKey}, where ${route.applicationName ?? route.application} is placed at ${route.route} in ${route.environment.toUpperCase()}`);
    }
  }
  return issues.issues;
}

/**
 * Activates a submitted revision: the Portal's first activation, or a later
 * revision replacing the active one. Every enabled environment needs a
 * default route, and every approved placement its menu parent.
 */
export function activatePortal(db: Executor, publicId: string, input: { revision: number; lockVersion: number; actor: Actor }): Portal {
  return immediate(db, (tx) => {
    const portal = getPortal(tx, publicId);
    if (portal.lockVersion !== input.lockVersion) throw new StaleRecordError(`${portal.label} changed since you opened it`);
    if (portal.lifecycle !== "ready" && portal.lifecycle !== "active") throw new TransitionError(portal.lifecycle === "retired" ? `${portal.label} is retired` : `${portal.label} isn't ready: submit a complete revision first`);
    const revision = tx.select({ id: portalRevisions.id }).from(portalRevisions).where(and(eq(portalRevisions.portalId, portal.id), eq(portalRevisions.number, input.revision), eq(portalRevisions.state, "submitted"))).get();
    if (!revision) throw new NotFoundError(`${portal.label} has no submitted revision ${input.revision}`);
    if (revision.id === portal.activeRevisionId) throw new TransitionError(`Revision ${input.revision} is already active`);
    const full = revisionById(tx, "portal", revision.id)!;
    const issues = activationIssues(tx, portal, full);
    if (issues.length > 0) throw new BlockedError(`${portal.label} revision ${input.revision} can't be activated`, issues);
    return transition(tx, portal, "active", { event: portal.lifecycle === "active" ? "revision_activated" : "activated", revision: input.revision, actor: input.actor }, { activeRevisionId: revision.id });
  });
}

/**
 * Retires a Portal, with a reason. Its approved placements must be retired
 * or withdrawn first, so no route is left serving a retired Portal. Its
 * revisions and history stay.
 */
export function retirePortal(db: Executor, publicId: string, input: { lockVersion: number; reason: string; actor: Actor }): Portal {
  return immediate(db, (tx) => {
    const portal = getPortal(tx, publicId);
    if (portal.lockVersion !== input.lockVersion) throw new StaleRecordError(`${portal.label} changed since you opened it`);
    if (portal.lifecycle === "retired") throw new TransitionError(`${portal.label} is already retired`);
    const reason = input.reason.trim();
    if (!reason) throw new ValidationError([{ field: "reason", message: "Say why the Portal is being retired" }]);
    if (reason.length > 1000) throw new ValidationError([{ field: "reason", message: "Use 1,000 characters or fewer" }]);
    const active = tx.select({ id: placementRoutes.placementId }).from(placementRoutes).where(and(eq(placementRoutes.portalId, portal.id), eq(placementRoutes.active, true))).all();
    const placements = new Set(active.map((row) => row.id)).size;
    if (placements > 0) {
      throw new BlockedError(`${portal.label} can't be retired`, [
        { code: "portal.retire_placements_active", severity: "blocking", location: "placements", message: `${placements} approved ${placements === 1 ? "placement is" : "placements are"} still active in ${portal.label}. Retire or withdraw ${placements === 1 ? "it" : "them"} first` },
      ]);
    }
    retireReferencesOf(tx, { kind: "portal", id: portal.id });
    return transition(tx, portal, "retired", { event: "retired", reason, actor: input.actor });
  });
}

// ---------------------------------------------------------------------------
// Reading

export interface PortalRevisionView {
  revision: Revision;
  /** Its environments: a v2 revision's enabled catalog environments, or a v1 revision's rows with their runtimes and entitlements. */
  environments: (typeof portalEnvironments.$inferSelect)[];
  menu: (typeof portalMenuGroups.$inferSelect)[];
  /** The catalog a v2 revision was validated against; null for v1. */
  catalog: { source: EnvironmentCatalogSource; digest: string } | null;
  /** v1 history: the runtimes and contract the Portal team was asked for. Empty and null for v2. */
  runtimes: string[];
  contract: PortalContract | null;
  contractDigest: string | null;
  contractLabel: string;
}

/** A submitted revision with its frozen environments and menu groups, and for v1 the runtimes and contract it froze. */
export function portalRevisionView(db: Executor, portal: Portal, revision: Revision): PortalRevisionView {
  const row = db
    .select({ contract: portalRevisions.contract, contractDigest: portalRevisions.contractDigest, runtimes: portalRevisions.runtimes, catalogSource: portalRevisions.environmentCatalogSource, catalogDigest: portalRevisions.environmentCatalogDigest })
    .from(portalRevisions)
    .where(eq(portalRevisions.id, revision.id))
    .get();
  return {
    revision,
    environments: db.select().from(portalEnvironments).where(eq(portalEnvironments.portalRevisionId, revision.id)).orderBy(asc(portalEnvironments.environment)).all(),
    menu: db.select().from(portalMenuGroups).where(eq(portalMenuGroups.portalRevisionId, revision.id)).orderBy(asc(portalMenuGroups.ordering), asc(portalMenuGroups.key)).all(),
    catalog: row?.catalogSource && row.catalogDigest ? { source: row.catalogSource, digest: row.catalogDigest } : null,
    runtimes: row?.runtimes ? (JSON.parse(row.runtimes) as string[]) : [],
    contract: row?.contract ? (JSON.parse(row.contract) as PortalContract) : null,
    contractDigest: row?.contractDigest ?? null,
    contractLabel: contractLabel(portal.label, revision.number),
  };
}

/** The revision a Portal's routes are reviewed against: its active one, or before activation its latest submitted. */
export function governingRevision(db: Executor, portal: Portal): Revision | undefined {
  return portal.activeRevisionId ? revisionById(db, "portal", portal.activeRevisionId) : latestSubmitted(db, "portal", portal.id);
}

export interface PortalSummary {
  portal: Portal;
  draft: Revision | undefined;
  latest: Revision | undefined;
  active: Revision | undefined;
}

export function portalSummary(db: Executor, portal: Portal): PortalSummary {
  return {
    portal,
    draft: draftOf(db, "portal", portal.id),
    latest: latestSubmitted(db, "portal", portal.id),
    active: portal.activeRevisionId ? revisionById(db, "portal", portal.activeRevisionId) : undefined,
  };
}

/** The Portal's lifecycle and revision history, newest first. */
export function portalHistory(db: Executor, portalId: number) {
  return db.select().from(onboardingEvents).where(eq(onboardingEvents.portalId, portalId)).orderBy(desc(onboardingEvents.occurredAt), desc(onboardingEvents.id)).all();
}
