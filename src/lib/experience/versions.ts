import { and, asc, desc, eq, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { StaleRecordError, TransitionError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { applications, portalExperienceVersions, portalMenuItems } from "@/lib/db/schema";
import { type Actor, recordEvent } from "@/lib/onboarding/attribution";
import { type Portal, assertCurrent, getPortal, touchPortal } from "@/lib/onboarding/portals";
import type { Catalogs } from "./catalogs";
import { type Experience, type ExperienceIssue, type MenuNode, defaultExperience, experienceSchema, menuDepth, validateExperience } from "./document";
import { diffExperience } from "./fields";

/*
 * Saved experience versions (add-portal-experience-editor, design decisions
 * 2 and 3). A Portal's current experience is its newest saved version, or
 * the default; its menu always comes from portal_menu_items, which a save
 * rewrites from the document in the same transaction, so promotion,
 * Applications, and the Production checklist keep reading one menu. A save
 * is refused when it's based on an older version or lock version, or when
 * the document breaks a rule, and writes nothing then.
 */

export type ExperienceVersion = typeof portalExperienceVersions.$inferSelect;

/** A save refused because the document breaks rules, each at its field. */
export class ExperienceValidationError extends Error {
  override name = "ExperienceValidationError";

  constructor(readonly issues: readonly ExperienceIssue[]) {
    super(`The experience has ${issues.length} problem${issues.length === 1 ? "" : "s"}`);
  }
}

/** The Portal's saved menu as the document holds it: parents before children, siblings by position. */
export function savedMenu(db: Executor, portalId: number): MenuNode[] {
  const rows = db
    .select({ row: portalMenuItems, application: applications.publicId })
    .from(portalMenuItems)
    .leftJoin(applications, eq(applications.id, portalMenuItems.applicationId))
    .where(eq(portalMenuItems.portalId, portalId))
    .orderBy(asc(portalMenuItems.position), asc(portalMenuItems.id))
    .all();
  const publicIds = new Map(rows.map(({ row }) => [row.id, row.publicId]));
  const ordered: MenuNode[] = [];
  const visit = (parentId: number | null) => {
    for (const { row, application } of rows.filter(({ row }) => row.parentId === parentId)) {
      ordered.push({ id: row.publicId, parentId: parentId === null ? null : publicIds.get(parentId)!, kind: row.kind, label: row.label, route: row.route, application: application ?? null, isDefault: row.isDefault });
      if (row.kind === "group") visit(row.id);
    }
  };
  visit(null);
  return ordered;
}

/** The Portal's newest saved version, if it has one. */
export function latestVersion(db: Executor, portalId: number): ExperienceVersion | undefined {
  return db.select().from(portalExperienceVersions).where(eq(portalExperienceVersions.portalId, portalId)).orderBy(desc(portalExperienceVersions.number)).limit(1).get();
}

/** Every saved version, newest first. */
export function experienceVersions(db: Executor, portalId: number): ExperienceVersion[] {
  return db.select().from(portalExperienceVersions).where(eq(portalExperienceVersions.portalId, portalId)).orderBy(desc(portalExperienceVersions.number)).all();
}

export interface CurrentExperience {
  experience: Experience;
  /** The saved version it is, or 0 for the default. */
  number: number;
}

/** The Portal's current experience: its newest saved version with its saved menu, or the default. */
export function currentExperience(db: Executor, portal: Pick<Portal, "id" | "label">, catalogs: Pick<Catalogs, "toolkits" | "themes">): CurrentExperience {
  const menu = savedMenu(db, portal.id);
  const latest = latestVersion(db, portal.id);
  const parsed = latest ? experienceSchema.safeParse(JSON.parse(latest.document)) : null;
  if (latest && parsed?.success) return { experience: { ...parsed.data, menu }, number: latest.number };
  return { experience: defaultExperience(portal, menu, catalogs.toolkits, catalogs.themes), number: latest?.number ?? 0 };
}

export interface SaveInput {
  /** The saved version the editor loaded, 0 for the default. */
  baseNumber: number;
  lockVersion: number;
  document: unknown;
}

/**
 * Saves +input.document+ as +portalPublicId+'s next version: refuses a save
 * based on an older version or lock version (StaleRecordError), a document
 * with problems (ExperienceValidationError), or one with nothing to save
 * (TransitionError). Otherwise records the version, rewrites the Portal's
 * menu from it, bumps the Portal's version, and records the save in its
 * history, in one transaction.
 */
export function saveExperience(db: Executor, portalPublicId: string, input: SaveInput, actor: Actor, catalogs: Catalogs, now = new Date()): { version: ExperienceVersion; experience: Experience } {
  return immediate(db, (tx) => {
    const portal = getPortal(tx, portalPublicId);
    assertCurrent(portal, input.lockVersion);
    const current = currentExperience(tx, portal, catalogs);
    if (current.number !== input.baseNumber) throw new StaleRecordError(`${portal.label} changed since you opened it`);

    const parsed = experienceSchema.safeParse(input.document);
    if (!parsed.success) throw new ExperienceValidationError([{ path: parsed.error.issues[0]?.path.join(".") ?? "", message: "The experience isn't in the expected shape. Reload the editor and try again", view: "frame-zones" }]);
    const portalApplications = tx.select({ id: applications.id, publicId: applications.publicId }).from(applications).where(eq(applications.portalId, portal.id)).all();
    const issues = validateExperience(parsed.data, { catalogs, applications: portalApplications });
    if (issues.length) throw new ExperienceValidationError(issues);

    // New menu entries get their lasting ids, and their children follow.
    const renamed = new Map<string, string>();
    const menu = parsed.data.menu.map((node) => {
      const id = node.id.startsWith("mnu_") ? node.id : generatePublicId("mnu");
      renamed.set(node.id, id);
      return node;
    }).map((node) => ({ ...node, id: renamed.get(node.id)!, parentId: node.parentId === null ? null : renamed.get(node.parentId) ?? null }));
    const document: Experience = { ...parsed.data, menu };

    const changes = diffExperience(current.experience, document);
    if (changes.length === 0) throw new TransitionError("There are no changes to save");

    const number = current.number + 1;
    const version = tx
      .insert(portalExperienceVersions)
      .values({
        publicId: generatePublicId("pxv"),
        portalId: portal.id,
        number,
        document: JSON.stringify(document),
        changeCount: changes.length,
        changes: JSON.stringify(changes.slice(0, 200).map((change) => `${change.section}: ${change.field}`)),
        actor: actor.name,
        attribution: actor.attribution,
        createdAt: now,
      })
      .returning()
      .get();

    rewriteMenu(tx, portal, menu, new Map(portalApplications.map((application) => [application.publicId, application.id])));
    touchPortal(tx, portal);
    const named = changes.filter((change) => change.field === "Menu entry").map((change) => (change.next === "None" ? `removed ${change.original}` : change.original === "None" ? `added ${change.next}` : `changed ${change.next}`));
    recordEvent(tx, "portal", portal.id, { event: "experience_saved", actor, at: now, detail: `Saved version ${number} with ${changes.length} change${changes.length === 1 ? "" : "s"}${named.length ? `: ${named.join("; ")}` : ""}` });
    return { version, experience: document };
  });
}

/** Replaces +portal+'s menu rows with +menu+, keeping each entry's public id. */
function rewriteMenu(tx: Executor, portal: Portal, menu: MenuNode[], applicationIds: Map<string, number>): void {
  // Children first, so no row is deleted while another points at it.
  for (let remaining = true; remaining; ) {
    const leaves = tx.select({ id: portalMenuItems.id }).from(portalMenuItems).where(and(eq(portalMenuItems.portalId, portal.id), sql`NOT EXISTS (SELECT 1 FROM portal_menu_items AS child WHERE child.parent_id = ${portalMenuItems.id})`)).all();
    remaining = leaves.length > 0;
    for (const leaf of leaves) tx.delete(portalMenuItems).where(eq(portalMenuItems.id, leaf.id)).run();
  }
  const rowIds = new Map<string, number>();
  const positions = new Map<string | null, number>();
  // Parents before children: the document already lists them that way, but sort by depth to be sure.
  for (const node of [...menu].sort((a, b) => menuDepth(menu, a) - menuDepth(menu, b))) {
    const position = positions.get(node.parentId) ?? 0;
    positions.set(node.parentId, position + 1);
    const row = tx
      .insert(portalMenuItems)
      .values({
        publicId: node.id,
        portalId: portal.id,
        parentId: node.parentId === null ? null : rowIds.get(node.parentId)!,
        kind: node.kind,
        label: node.label.trim(),
        route: node.kind === "item" ? node.route!.trim() : null,
        applicationId: node.kind === "item" ? applicationIds.get(node.application!)! : null,
        position,
        isDefault: node.isDefault,
      })
      .returning({ id: portalMenuItems.id })
      .get();
    rowIds.set(node.id, row.id);
  }
}
