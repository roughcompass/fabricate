import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import type { PrototypesExecutor } from "./db/client";
import { feedback, prototypes, shares, templates, versions } from "./db/schema";
import type { PersonaCopy } from "./types";
import { releaseSlot } from "./workspace";

/**
 * Prototypes and their versions (prototypes/versions spec). A version never
 * changes once it is ready; refinements and forks add versions.
 */

export type Prototype = typeof prototypes.$inferSelect;
export type Version = typeof versions.$inferSelect;
/** A version that belongs to a prototype: kept, refined, or forked, so it has a number. */
export type KeptVersion = Version & { readonly prototypeId: string; readonly number: number };

export const NAME_LENGTH = 120;

export interface PrototypeRow {
  readonly prototype: Prototype;
  readonly latest: Version | null;
  readonly personas: readonly PersonaCopy[];
  /** The live template accepted from it, if any. */
  readonly template: { id: string; slug: string } | null;
}

/** The workspace's prototypes, most recently updated first, each with its latest version. */
export async function listPrototypes(db: PrototypesExecutor, workspaceId: string): Promise<PrototypeRow[]> {
  const rows = await db.select().from(prototypes).where(eq(prototypes.workspaceId, workspaceId)).orderBy(desc(prototypes.updatedAt), desc(prototypes.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const latest = await db
    .select()
    .from(versions)
    .where(and(inArray(versions.prototypeId, ids)));
  const live = await db
    .select({ id: templates.id, slug: templates.slug, prototypeId: templates.prototypeId })
    .from(templates)
    .where(and(inArray(templates.prototypeId, ids), isNull(templates.withdrawnAt)));
  return rows.map((prototype) => {
    const version = latest.filter((entry) => entry.prototypeId === prototype.id && entry.number === prototype.latestNumber)[0] ?? null;
    const template = live.find((entry) => entry.prototypeId === prototype.id);
    return { prototype, latest: version, personas: version?.provenance?.personas ?? [], template: template ? { id: template.id, slug: template.slug } : null };
  });
}

export async function getPrototype(db: PrototypesExecutor, workspaceId: string, prototypeId: string): Promise<Prototype> {
  const [prototype] = await db
    .select()
    .from(prototypes)
    .where(and(eq(prototypes.workspaceId, workspaceId), eq(prototypes.id, prototypeId)));
  if (!prototype) throw new NotFoundError("Unknown prototype");
  return prototype;
}

/** A prototype's versions, numbered from 1 in creation order. */
export async function versionsOf(db: PrototypesExecutor, prototypeId: string): Promise<KeptVersion[]> {
  return (await db.select().from(versions).where(eq(versions.prototypeId, prototypeId)).orderBy(asc(versions.number))) as KeptVersion[];
}

/** A version in the workspace, kept or not. */
export async function getVersion(db: PrototypesExecutor, workspaceId: string, versionId: string): Promise<Version> {
  const [version] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.workspaceId, workspaceId), eq(versions.id, versionId)));
  if (!version) throw new NotFoundError("Unknown version");
  return version;
}

export function validateName(name: string): string {
  const issues = new IssueCollector();
  const clean = name.trim();
  if (!clean) issues.add("name", "Enter a name.");
  else if (clean.length > NAME_LENGTH) issues.add("name", `Use at most ${NAME_LENGTH} characters.`);
  issues.throwIfAny();
  return clean;
}

export async function renamePrototype(db: PrototypesExecutor, workspaceId: string, prototypeId: string, name: string, now = new Date()): Promise<Prototype> {
  const clean = validateName(name);
  const [prototype] = await db
    .update(prototypes)
    .set({ name: clean, updatedAt: now })
    .where(and(eq(prototypes.workspaceId, workspaceId), eq(prototypes.id, prototypeId)))
    .returning();
  if (!prototype) throw new NotFoundError("Unknown prototype");
  return prototype;
}

/**
 * Deletes a prototype with its versions, feedback, and share links (versions
 * spec, "Prototypes can be renamed and deleted"). Lessons learned from it
 * remain, and so does a template accepted from it, which keeps its own copy.
 */
export async function deletePrototype(db: PrototypesExecutor, workspaceId: string, prototypeId: string): Promise<Prototype> {
  return db.transaction(async (tx) => {
    const prototype = await getPrototype(tx, workspaceId, prototypeId);
    const ids = (await tx.select({ id: versions.id }).from(versions).where(eq(versions.prototypeId, prototypeId))).map((row) => row.id);
    if (ids.length > 0) {
      await tx.delete(shares).where(inArray(shares.versionId, ids));
      await tx.delete(feedback).where(inArray(feedback.versionId, ids));
    }
    await tx.delete(feedback).where(eq(feedback.prototypeId, prototypeId));
    await tx.update(templates).set({ prototypeId: null }).where(eq(templates.prototypeId, prototypeId));
    await tx.delete(prototypes).where(eq(prototypes.id, prototypeId));
    await releaseSlot(tx, workspaceId, "prototypeCount");
    return prototype;
  });
}
