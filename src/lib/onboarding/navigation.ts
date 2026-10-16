import { and, asc, eq, isNull, notExists, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError, TransitionError, ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { applications, portalMenuItems } from "@/lib/db/schema";
import { type Actor, recordEvent } from "./attribution";
import { MAX_MENU_DEPTH, MAX_MENU_LABEL, MENU_ROUTE } from "./menu-rules";
import { type Portal, assertCurrent, getPortal, touchPortal } from "./portals";

export { MAX_MENU_DEPTH, MAX_MENU_LABEL, MENU_ROUTE } from "./menu-rules";

/*
 * A Portal's menu (navigation spec, design decision 8): a tree of groups and
 * items in one flat table, edited one small change at a time. Each change
 * carries the version of the Portal the operator saw, takes effect at once,
 * bumps the version, and is recorded with who stated they made it. Items
 * point at Applications of the same Portal, routes are unique within it,
 * and one item at most is its default route.
 */

type Row = typeof portalMenuItems.$inferSelect;

export interface MenuEntry {
  id: number;
  publicId: string;
  kind: "group" | "item";
  label: string;
  route: string | null;
  application: { publicId: string; name: string | null; slug: string | null } | null;
  isDefault: boolean;
  /** The group it's in, or null at the top level. */
  parentPublicId: string | null;
  /** 1 at the top level. */
  depth: number;
  /** Whether it's first or last among its siblings, so the editor knows which moves to offer. */
  first: boolean;
  last: boolean;
}

/** The Portal's menu in reading order: each group followed by what it holds, siblings by position. */
export function menuOf(db: Executor, portalId: number): MenuEntry[] {
  const rows = db
    .select({ row: portalMenuItems, application: { publicId: applications.publicId, name: applications.name, slug: applications.slug } })
    .from(portalMenuItems)
    .leftJoin(applications, eq(applications.id, portalMenuItems.applicationId))
    .where(eq(portalMenuItems.portalId, portalId))
    .orderBy(asc(portalMenuItems.position), asc(portalMenuItems.id))
    .all();
  const publicIds = new Map(rows.map(({ row }) => [row.id, row.publicId]));
  const entries: MenuEntry[] = [];
  const visit = (parentId: number | null, depth: number) => {
    const siblings = rows.filter(({ row }) => row.parentId === parentId);
    siblings.forEach(({ row, application }, index) => {
      entries.push({
        id: row.id,
        publicId: row.publicId,
        kind: row.kind,
        label: row.label,
        route: row.route,
        application: row.applicationId && application ? application : null,
        isDefault: row.isDefault,
        parentPublicId: parentId === null ? null : (publicIds.get(parentId) ?? null),
        depth,
        first: index === 0,
        last: index === siblings.length - 1,
      });
      if (row.kind === "group") visit(row.id, depth + 1);
    });
  };
  visit(null, 1);
  return entries;
}

/** The Portal's Applications, by name: the ones its menu items can point at. */
export function portalApplications(db: Executor, portalId: number) {
  return db
    .select({ id: applications.id, publicId: applications.publicId, name: applications.name, slug: applications.slug })
    .from(applications)
    .where(eq(applications.portalId, portalId))
    .orderBy(asc(sql`lower(${applications.name})`), asc(applications.id))
    .all();
}

/** The Portal's Applications that no menu item points at (navigation spec, "Applications without a menu item are listed"). */
export function unplacedApplications(db: Executor, portalId: number) {
  return db
    .select({ id: applications.id, publicId: applications.publicId, name: applications.name, slug: applications.slug })
    .from(applications)
    .where(and(eq(applications.portalId, portalId), notExists(db.select({ one: sql`1` }).from(portalMenuItems).where(eq(portalMenuItems.applicationId, applications.id)))))
    .orderBy(asc(sql`lower(${applications.name})`), asc(applications.id))
    .all();
}

// ---------------------------------------------------------------------------
// Changes

interface Change {
  lockVersion: number;
}

function entryOf(db: Executor, portal: Portal, publicId: string): Row {
  const row = db.select().from(portalMenuItems).where(and(eq(portalMenuItems.portalId, portal.id), eq(portalMenuItems.publicId, publicId))).get();
  if (!row) throw new NotFoundError(`${portal.label}'s menu has no such entry`);
  return row;
}

/** The group +publicId+ names, or null for the top level. */
function groupOf(db: Executor, portal: Portal, publicId: string | null | undefined): Row | null {
  if (!publicId) return null;
  const row = db.select().from(portalMenuItems).where(and(eq(portalMenuItems.portalId, portal.id), eq(portalMenuItems.publicId, publicId))).get();
  if (!row || row.kind !== "group") throw new ValidationError([{ field: "parent", message: `Choose a group in ${portal.label}'s menu` }]);
  return row;
}

/** How deep +row+ sits: 1 at the top level. */
function depthOf(db: Executor, row: Row | null): number {
  let depth = 0;
  for (let current = row; current; current = current.parentId ? (db.select().from(portalMenuItems).where(eq(portalMenuItems.id, current.parentId)).get() ?? null) : null) depth += 1;
  return depth;
}

/** How many levels +row+ and everything in it take: 1 for an item or an empty group. */
function heightOf(db: Executor, row: Row): number {
  const children = db.select().from(portalMenuItems).where(eq(portalMenuItems.parentId, row.id)).all();
  return 1 + Math.max(0, ...children.map((child) => heightOf(db, child)));
}

function nextPosition(db: Executor, portalId: number, parentId: number | null): number {
  const row = db
    .select({ last: sql<number | null>`max(${portalMenuItems.position})` })
    .from(portalMenuItems)
    .where(and(eq(portalMenuItems.portalId, portalId), parentId === null ? isNull(portalMenuItems.parentId) : eq(portalMenuItems.parentId, parentId)))
    .get();
  return row?.last == null ? 0 : row.last + 1;
}

function checkLabel(value: string, issues: { field: string; message: string }[]): string {
  const label = (value ?? "").trim().replace(/\s+/g, " ");
  if (!label) issues.push({ field: "label", message: "Enter a label" });
  else if (label.length > MAX_MENU_LABEL) issues.push({ field: "label", message: `Use ${MAX_MENU_LABEL} characters or fewer` });
  return label;
}

function checkDepth(db: Executor, parent: Row | null, height: number, issues: { field: string; message: string }[]): void {
  if (depthOf(db, parent) + height > MAX_MENU_DEPTH) issues.push({ field: "parent", message: `Menus nest at most ${MAX_MENU_DEPTH} levels deep` });
}

/** Runs one change to +publicId+'s menu against the version the operator saw, then bumps it and records +detail+. */
function change<T>(db: Executor, publicId: string, input: Change, actor: Actor, work: (tx: Executor, portal: Portal) => { result: T; detail: string; event?: "menu_changed" | "default_changed" }): T {
  return immediate(db, (tx) => {
    const portal = getPortal(tx, publicId);
    assertCurrent(portal, input.lockVersion);
    const { result, detail, event = "menu_changed" } = work(tx, portal);
    touchPortal(tx, portal);
    recordEvent(tx, "portal", portal.id, { event, actor, detail });
    return result;
  });
}

const where = (parent: Row | null) => (parent ? ` in ${parent.label}` : "");

/** Adds a group, at the end of +parent+ or the top level. */
export function addGroup(db: Executor, portalPublicId: string, input: Change & { label: string; parent: string | null }, actor: Actor): Row {
  return change(db, portalPublicId, input, actor, (tx, portal) => {
    const issues: { field: string; message: string }[] = [];
    const label = checkLabel(input.label, issues);
    const parent = groupOf(tx, portal, input.parent);
    checkDepth(tx, parent, 1, issues);
    if (issues.length) throw new ValidationError(issues);
    const row = tx
      .insert(portalMenuItems)
      .values({ publicId: generatePublicId("mnu"), portalId: portal.id, parentId: parent?.id ?? null, kind: "group", label, position: nextPosition(tx, portal.id, parent?.id ?? null) })
      .returning()
      .get();
    return { result: row, detail: `Added the group ${label}${where(parent)}` };
  });
}

/**
 * Adds an item: a label, a route unique in the Portal, and an Application of
 * the Portal. A route another item has is refused, naming that item.
 */
export function addItem(db: Executor, portalPublicId: string, input: Change & { label: string; route: string; application: string; parent: string | null }, actor: Actor): Row {
  return change(db, portalPublicId, input, actor, (tx, portal) => {
    const issues: { field: string; message: string }[] = [];
    const label = checkLabel(input.label, issues);
    const route = (input.route ?? "").trim();
    if (!route) issues.push({ field: "route", message: "Enter a route, such as /payees" });
    else if (!MENU_ROUTE.test(route)) issues.push({ field: "route", message: "Enter a route that starts with / and uses only lowercase letters, digits, hyphens, and slashes" });
    else {
      const holder = tx.select({ label: portalMenuItems.label }).from(portalMenuItems).where(and(eq(portalMenuItems.portalId, portal.id), eq(portalMenuItems.route, route))).get();
      if (holder) issues.push({ field: "route", message: `${route} is already used by ${holder.label}` });
    }
    const application = input.application ? tx.select().from(applications).where(eq(applications.publicId, input.application)).get() : undefined;
    if (!application || application.portalId !== portal.id) issues.push({ field: "application", message: `Choose an Application in ${portal.label}` });
    let parent: Row | null = null;
    try {
      parent = groupOf(tx, portal, input.parent);
      checkDepth(tx, parent, 1, issues);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(...error.issues);
    }
    if (issues.length) throw new ValidationError(issues);
    const row = tx
      .insert(portalMenuItems)
      .values({ publicId: generatePublicId("mnu"), portalId: portal.id, parentId: parent?.id ?? null, kind: "item", label, route, applicationId: application!.id, position: nextPosition(tx, portal.id, parent?.id ?? null) })
      .returning()
      .get();
    return { result: row, detail: `Added ${label} at ${route}${where(parent)}` };
  });
}

/** Renames a group or an item. */
export function renameEntry(db: Executor, portalPublicId: string, input: Change & { entry: string; label: string }, actor: Actor): Row {
  return change(db, portalPublicId, input, actor, (tx, portal) => {
    const row = entryOf(tx, portal, input.entry);
    const issues: { field: string; message: string }[] = [];
    const label = checkLabel(input.label, issues);
    if (issues.length) throw new ValidationError(issues);
    const updated = tx.update(portalMenuItems).set({ label }).where(eq(portalMenuItems.id, row.id)).returning().get();
    return { result: updated, detail: `Renamed ${row.label} to ${label}` };
  });
}

export type Move = { direction: "up" | "down" } | { into: string | null };

/**
 * Moves an entry up or down among its siblings, or into another group, or
 * to the top level, at the end. A group can't move into itself or what it
 * holds, and nothing can end up deeper than five levels.
 */
export function moveEntry(db: Executor, portalPublicId: string, input: Change & { entry: string; move: Move }, actor: Actor): Row {
  return change(db, portalPublicId, input, actor, (tx, portal) => {
    const row = entryOf(tx, portal, input.entry);
    if ("direction" in input.move) {
      const siblings = tx
        .select()
        .from(portalMenuItems)
        .where(and(eq(portalMenuItems.portalId, portal.id), row.parentId === null ? isNull(portalMenuItems.parentId) : eq(portalMenuItems.parentId, row.parentId)))
        .orderBy(asc(portalMenuItems.position), asc(portalMenuItems.id))
        .all();
      const index = siblings.findIndex((sibling) => sibling.id === row.id);
      const swapWith = siblings[input.move.direction === "up" ? index - 1 : index + 1];
      if (!swapWith) throw new TransitionError(`${row.label} is already ${input.move.direction === "up" ? "first" : "last"}`);
      // Renumber the siblings in their new order, so equal positions can't stall a move.
      [siblings[index], siblings[siblings.indexOf(swapWith)]] = [swapWith, row];
      siblings.forEach((sibling, position) => tx.update(portalMenuItems).set({ position }).where(eq(portalMenuItems.id, sibling.id)).run());
      return { result: entryOf(tx, portal, row.publicId), detail: `Moved ${row.label} ${input.move.direction}` };
    }
    const target = groupOf(tx, portal, input.move.into);
    if (target?.id === row.id) throw new ValidationError([{ field: "parent", message: "A group can't go inside itself" }]);
    for (let current = target; current; current = current.parentId ? (tx.select().from(portalMenuItems).where(eq(portalMenuItems.id, current.parentId)).get() ?? null) : null) {
      if (current.id === row.id) throw new ValidationError([{ field: "parent", message: `${row.label} can't go inside a group it holds` }]);
    }
    const issues: { field: string; message: string }[] = [];
    checkDepth(tx, target, heightOf(tx, row), issues);
    if (issues.length) throw new ValidationError(issues);
    const moved = tx
      .update(portalMenuItems)
      .set({ parentId: target?.id ?? null, position: nextPosition(tx, portal.id, target?.id ?? null) })
      .where(eq(portalMenuItems.id, row.id))
      .returning()
      .get();
    return { result: moved, detail: target ? `Moved ${row.label} into ${target.label}` : `Moved ${row.label} to the top level` };
  });
}

/**
 * Removes an item, or an empty group. Removing the default item leaves the
 * Portal without a default until another is chosen.
 */
export function removeEntry(db: Executor, portalPublicId: string, input: Change & { entry: string }, actor: Actor): void {
  change(db, portalPublicId, input, actor, (tx, portal) => {
    const row = entryOf(tx, portal, input.entry);
    if (row.kind === "group" && tx.select({ id: portalMenuItems.id }).from(portalMenuItems).where(eq(portalMenuItems.parentId, row.id)).limit(1).get()) {
      throw new TransitionError(`${row.label} isn't empty. Move or remove what's in it first`);
    }
    tx.delete(portalMenuItems).where(eq(portalMenuItems.id, row.id)).run();
    const detail = row.kind === "group" ? `Removed the group ${row.label}` : row.isDefault ? `Removed ${row.label}, the default route` : `Removed ${row.label}`;
    return { result: undefined, detail };
  });
}

/** Makes an item the Portal's default route, replacing any earlier default. */
export function setDefault(db: Executor, portalPublicId: string, input: Change & { entry: string }, actor: Actor): Row {
  return change(db, portalPublicId, input, actor, (tx, portal) => {
    const row = entryOf(tx, portal, input.entry);
    if (row.kind !== "item") throw new TransitionError("Only a menu item can be the default route");
    if (row.isDefault) throw new TransitionError(`${row.label} is already the default route`);
    tx.update(portalMenuItems).set({ isDefault: false }).where(and(eq(portalMenuItems.portalId, portal.id), eq(portalMenuItems.isDefault, true))).run();
    const updated = tx.update(portalMenuItems).set({ isDefault: true }).where(eq(portalMenuItems.id, row.id)).returning().get();
    return { result: updated, detail: `Made ${row.label} the default route`, event: "default_changed" };
  });
}
