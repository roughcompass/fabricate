import { and, desc, eq, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type PortalLifecycle, onboardingEvents, portalMenuItems, portals } from "@/lib/db/schema";
import { SEAL_ID, labelKey } from "@/lib/ownership/records";
import { type Actor, recordEvent } from "./attribution";
import { SLUG, SLUG_MAX, deriveSlug } from "./slug";
import { PORTAL_PLATFORMS } from "./vocabulary";

/*
 * Portals (portals spec). A Portal is configuration its team owns: its
 * identity, its menu (navigation.ts), and its lifecycle. Every Portal starts
 * as a Prototype; its team promotes it to Production once it has a default
 * route, and can return it. Each change takes effect at once, is checked
 * against the version the operator saw, and is recorded in its history with
 * who stated they made it.
 */

export type Portal = typeof portals.$inferSelect;

export const MAX_PORTAL_NAME = 100;
export const MAX_PORTAL_DESCRIPTION = 500;
export const MAX_OWNER_TEAM = 200;

export function findPortal(db: Executor, publicId: string): Portal | undefined {
  return db.select().from(portals).where(eq(portals.publicId, publicId)).get();
}

export function getPortal(db: Executor, publicId: string): Portal {
  const portal = findPortal(db, publicId);
  if (!portal) throw new NotFoundError(`Portal ${publicId} doesn't exist`);
  return portal;
}

/** A Portal its team onboarded, rather than one named only in an ownership claim: one with a history. */
export function isOnboarded(db: Executor, portalId: number): boolean {
  return Boolean(db.select({ id: onboardingEvents.id }).from(onboardingEvents).where(eq(onboardingEvents.portalId, portalId)).limit(1).get());
}

/** Refuses a change based on a version of +portal+ older than the current one. */
export function assertCurrent(portal: Portal, lockVersion: number): void {
  if (portal.lockVersion !== lockVersion) throw new StaleRecordError(`${portal.label} changed since you opened it`);
}

/** Bumps the Portal's version, so every page showing the older one is stale. */
export function touchPortal(db: Executor, portal: Portal, columns: Partial<Pick<Portal, "lifecycle" | "label" | "labelKey" | "sealId" | "ownerTeam" | "description">> = {}): Portal {
  return db
    .update(portals)
    .set({ ...columns, lockVersion: sql`${portals.lockVersion} + 1` })
    .where(eq(portals.id, portal.id))
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Creating and editing

export interface PortalDetails {
  name: string;
  sealId: string;
  ownerTeam: string;
  description: string;
}

export interface PortalInput extends PortalDetails {
  /** One of PORTAL_PLATFORMS; anything else is refused. */
  platform: string;
  /** Derived from the name when blank. */
  slug?: string | null;
}

/** The details' values, normalized, or every problem with them. +except+ is the Portal being edited, which may keep its own name. */
function checkDetails(db: Executor, input: PortalDetails, issues: { field: string; message: string }[], except?: Portal) {
  const sealId = input.sealId?.trim() || null;
  if (!sealId) issues.push({ field: "sealId", message: "Enter the Portal's SEAL ID" });
  else if (!SEAL_ID.test(sealId)) issues.push({ field: "sealId", message: "Enter a SEAL ID of letters, digits, dots, dashes, or underscores" });
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) issues.push({ field: "name", message: "Enter the Portal's name" });
  else if (name.length > MAX_PORTAL_NAME) issues.push({ field: "name", message: `Use ${MAX_PORTAL_NAME} characters or fewer` });
  const ownerTeam = input.ownerTeam?.trim().replace(/\s+/g, " ") || null;
  if (!ownerTeam) issues.push({ field: "ownerTeam", message: "Enter the team that owns the Portal" });
  else if (ownerTeam.length > MAX_OWNER_TEAM) issues.push({ field: "ownerTeam", message: `Use ${MAX_OWNER_TEAM} characters or fewer` });
  const description = input.description?.trim() || null;
  if (!description) issues.push({ field: "description", message: "Enter a description of the Portal" });
  else if (description.length > MAX_PORTAL_DESCRIPTION) issues.push({ field: "description", message: `Use ${MAX_PORTAL_DESCRIPTION} characters or fewer` });
  const named = name ? db.select().from(portals).where(eq(portals.labelKey, labelKey(name))).get() : undefined;
  return { sealId, name, ownerTeam, description, named: named && named.id !== except?.id ? named : undefined };
}

/**
 * Creates a Portal as a Prototype (portal-creation spec): a new one, or a
 * Portal first named in an ownership claim that no one has onboarded, which
 * keeps its identity and its claims and takes the submitted values. A name
 * is one Portal, and so is a slug. Every field is required; a blank slug is
 * derived from the name.
 */
export function createPortal(db: Executor, input: PortalInput, actor: Actor): { portal: Portal; adopted: boolean } {
  return immediate(db, (tx) => {
    const issues: { field: string; message: string }[] = [];
    const platform = PORTAL_PLATFORMS.find((candidate) => candidate === input.platform?.trim());
    if (!platform) issues.push({ field: "platform", message: "Choose the Portal's platform" });
    const { sealId, name, ownerTeam, description, named } = checkDetails(tx, input, issues);
    const existing = named && !isOnboarded(tx, named.id) ? named : undefined;
    if (named && !existing) issues.push({ field: "name", message: `A Portal named ${named.label} is already onboarded` });
    const slug = input.slug?.trim() || deriveSlug(name);
    if (slug.length > SLUG_MAX && /^[a-z]+$/.test(slug)) issues.push({ field: "slug", message: `Use ${SLUG_MAX} letters or fewer` });
    else if (!SLUG.test(slug)) issues.push({ field: "slug", message: "Enter a slug of lowercase letters" });
    else {
      const holder = tx.select({ id: portals.id, label: portals.label }).from(portals).where(eq(portals.slug, slug)).get();
      if (holder && holder.id !== existing?.id) issues.push({ field: "slug", message: `The slug ${slug} belongs to ${holder.label}` });
    }
    if (issues.length) throw new ValidationError(issues);

    const identity = { sealId, ownerTeam, platform: platform!, slug, description, lifecycle: "prototype" as const };
    const portal = existing
      ? tx.update(portals).set(identity).where(eq(portals.id, existing.id)).returning().get()
      : tx.insert(portals).values({ publicId: generatePublicId("ptl"), label: name, labelKey: labelKey(name), ...identity, createdAt: new Date() }).returning().get();
    recordEvent(tx, "portal", portal.id, { event: "created", actor, to: "prototype", detail: existing ? "Onboarded a Portal first named in an ownership claim" : null });
    return { portal, adopted: existing !== undefined };
  });
}

const DETAIL_LABELS = { sealId: "SEAL ID", label: "name", ownerTeam: "owning team", description: "description" } as const;

/** "the name and description": the changed details, as the history reads them. */
function changedList(changed: readonly (keyof typeof DETAIL_LABELS)[]): string {
  const labels = changed.map((key) => DETAIL_LABELS[key]);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Changes a Portal's SEAL ID, name, owning team, and description in place
 * (navigation spec). Its platform and slug are fixed. A save based on an
 * older version is refused; one that changes nothing records nothing.
 */
export function editPortalDetails(db: Executor, publicId: string, input: PortalDetails & { lockVersion: number }, actor: Actor): Portal {
  return immediate(db, (tx) => {
    const portal = getPortal(tx, publicId);
    assertCurrent(portal, input.lockVersion);
    const issues: { field: string; message: string }[] = [];
    const { sealId, name, ownerTeam, description, named } = checkDetails(tx, input, issues, portal);
    if (named) issues.push({ field: "name", message: `A Portal named ${named.label} already exists` });
    if (issues.length) throw new ValidationError(issues);

    const next = { sealId, label: name, ownerTeam, description };
    const changed = (Object.keys(DETAIL_LABELS) as (keyof typeof DETAIL_LABELS)[]).filter((key) => next[key] !== portal[key]);
    if (changed.length === 0) return portal;
    const updated = touchPortal(tx, portal, { ...next, labelKey: labelKey(name) });
    recordEvent(tx, "portal", portal.id, { event: "details_changed", actor, detail: `Changed the ${changedList(changed)}` });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle

/** The Portal's default menu item, if it has one. */
export function defaultItemOf(db: Executor, portalId: number) {
  return db.select().from(portalMenuItems).where(and(eq(portalMenuItems.portalId, portalId), eq(portalMenuItems.isDefault, true))).get();
}

function transition(db: Executor, portal: Portal, to: PortalLifecycle, actor: Actor): Portal {
  const updated = touchPortal(db, portal, { lifecycle: to });
  recordEvent(db, "portal", portal.id, { event: to === "production" ? "promoted" : "returned_to_prototype", from: portal.lifecycle, to, actor });
  return updated;
}

/** Promotes a Prototype Portal to Production (navigation spec). It needs a default route first. */
export function promotePortal(db: Executor, publicId: string, input: { lockVersion: number }, actor: Actor): Portal {
  return immediate(db, (tx) => {
    const portal = getPortal(tx, publicId);
    assertCurrent(portal, input.lockVersion);
    if (portal.lifecycle === "production") throw new TransitionError(`${portal.label} is already in Production`);
    if (!defaultItemOf(tx, portal.id)) throw new TransitionError(`${portal.label} needs a default route before it can be promoted. Make one of its menu items the default first`);
    return transition(tx, portal, "production", actor);
  });
}

/** Returns a Production Portal to Prototype. */
export function returnToPrototype(db: Executor, publicId: string, input: { lockVersion: number }, actor: Actor): Portal {
  return immediate(db, (tx) => {
    const portal = getPortal(tx, publicId);
    assertCurrent(portal, input.lockVersion);
    if (portal.lifecycle === "prototype") throw new TransitionError(`${portal.label} is already a Prototype`);
    return transition(tx, portal, "prototype", actor);
  });
}

// ---------------------------------------------------------------------------
// Reading

/** The Portal's history, newest first. */
export function portalHistory(db: Executor, portalId: number) {
  return db.select().from(onboardingEvents).where(eq(onboardingEvents.portalId, portalId)).orderBy(desc(onboardingEvents.occurredAt), desc(onboardingEvents.id)).all();
}
