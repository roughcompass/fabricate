import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { generatePublicId } from "@/lib/db/ids";
import { keyDigest } from "@/lib/demo/workspace-digest";
import { isWorkspaceKey } from "@/lib/demo/workspace-key";
import type { PrototypesExecutor } from "./db/client";
import { benchmarkIntents, feedback, generations, lessonChecks, lessons, pageShells, pairwiseReviews, personas, prototypes, sandboxRuns, shares, templateVersions, templates, versions, workspaces } from "./db/schema";
import { IDLE_DAYS, PrototypesLimitError } from "./limits";
import { seedWorkspace } from "./seed/import";

/**
 * Prototypes workspaces (prototypes/availability spec; design.md, decision 2).
 * A browser's workspace is keyed by the digest of the template demo's
 * workspace cookie, so one browser has one identity in both. Unlike the demo,
 * the row is created and seeded on the first Prototypes request, because a
 * new workspace already has content to show.
 */

export type PrototypesWorkspace = typeof workspaces.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The UTC day a counter covers: the limit resets at midnight UTC. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** When today's limit resets. */
export function limitResetsAt(now: Date): Date {
  return new Date(`${utcDay(new Date(now.getTime() + DAY_MS))}T00:00:00.000Z`);
}

/** The visitor's workspace, created and seeded in one transaction on their first Prototypes request. */
export async function ensurePrototypesWorkspace(db: PrototypesExecutor, key: string, now = new Date()): Promise<PrototypesWorkspace> {
  if (!isWorkspaceKey(key)) throw new Error("This browser has no workspace credential");
  const digest = keyDigest(key);
  const existing = await findByDigest(db, digest);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    // Two first requests can race; the loser finds the winner's row.
    const [created] = await tx
      .insert(workspaces)
      .values({ id: generatePublicId("pws"), credentialDigest: digest, counterDay: utcDay(now), createdAt: now, lastActiveAt: now })
      .onConflictDoNothing({ target: workspaces.credentialDigest })
      .returning();
    if (!created) return (await findByDigest(tx, digest))!;
    await seedWorkspace(tx, created.id, now);
    return (await findByDigest(tx, digest))!;
  });
}

export async function findPrototypesWorkspace(db: PrototypesExecutor, key: string | undefined): Promise<PrototypesWorkspace | null> {
  return isWorkspaceKey(key) ? findByDigest(db, keyDigest(key)) : null;
}

async function findByDigest(db: PrototypesExecutor, digest: string): Promise<PrototypesWorkspace | null> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.credentialDigest, digest));
  return row ?? null;
}

/** How many variants the workspace may still generate today. */
export function remainingToday(workspace: Pick<PrototypesWorkspace, "counterDay" | "variantsToday">, limit: number, now = new Date()): number {
  const used = workspace.counterDay === utcDay(now) ? workspace.variantsToday : 0;
  return Math.max(0, limit - used);
}

/**
 * Takes `count` variants from today's allowance in one conditional update,
 * or refuses before any model is called (availability spec, "Limit
 * reached"). Concurrent requests serialize on the workspace row, so two can't
 * both take the last ones.
 */
export async function claimVariants(db: PrototypesExecutor, workspaceId: string, count: number, limit: number, now = new Date()): Promise<{ remaining: number }> {
  const today = utcDay(now);
  const used = sql<number>`case when ${workspaces.counterDay} = ${today} then ${workspaces.variantsToday} else 0 end`;
  const [row] = await db
    .update(workspaces)
    .set({ counterDay: today, variantsToday: sql`${used} + ${count}` })
    .where(and(eq(workspaces.id, workspaceId), sql`${used} + ${count} <= ${limit}`))
    .returning({ variantsToday: workspaces.variantsToday });
  if (row) return { remaining: limit - row.variantsToday };
  const [current] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  throw new PrototypesLimitError(limitMessage(current ? remainingToday(current, limit, now) : 0, limit, now));
}

/** Returns variants a request took but didn't use, such as when the request fails before any model call. */
export async function releaseVariants(db: PrototypesExecutor, workspaceId: string, count: number, now = new Date()): Promise<void> {
  await db
    .update(workspaces)
    .set({ variantsToday: sql`greatest(${workspaces.variantsToday} - ${count}, 0)` })
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.counterDay, utcDay(now))));
}

export function limitMessage(remaining: number, limit: number, now: Date): string {
  const resets = `More are available from ${limitResetsAt(now).toISOString().slice(11, 16)} UTC tomorrow.`;
  if (remaining === 0) return `This workspace has used all ${limit} of today's generations. ${resets}`;
  return `Only ${remaining} of today's ${limit} generations ${remaining === 1 ? "remains" : "remain"}, so ask for ${remaining} or fewer variants. ${resets}`;
}

type CountColumn = "prototypeCount" | "personaCount" | "lessonCount";

/**
 * Takes one place under a workspace bound in one conditional update, or
 * throws with `message`. Call it in the transaction that writes the row, so
 * a refused write saves nothing.
 */
export async function claimSlot(db: PrototypesExecutor, workspaceId: string, column: CountColumn, limit: number, message: string): Promise<void> {
  const target = workspaces[column];
  const [row] = await db
    .update(workspaces)
    .set({ [column]: sql`${target} + 1` })
    .where(and(eq(workspaces.id, workspaceId), lt(target, limit)))
    .returning({ id: workspaces.id });
  if (!row) throw new PrototypesLimitError(message);
}

/** Gives a place back when a row is deleted. */
export async function releaseSlot(db: PrototypesExecutor, workspaceId: string, column: CountColumn, count = 1): Promise<void> {
  const target = workspaces[column];
  await db
    .update(workspaces)
    .set({ [column]: sql`greatest(${target} - ${count}, 0)` })
    .where(eq(workspaces.id, workspaceId));
}

/** Records activity at most once an hour, so reads stay cheap. */
export async function touchPrototypesWorkspace(db: PrototypesExecutor, workspaceId: string, now = new Date()): Promise<void> {
  await db
    .update(workspaces)
    .set({ lastActiveAt: now })
    .where(and(eq(workspaces.id, workspaceId), lt(workspaces.lastActiveAt, new Date(now.getTime() - HOUR_MS))));
}

/**
 * Deletes workspaces idle for 30 days with all their Prototypes data
 * (availability spec, "Workspace data is bounded"). Templates they accepted
 * stay in the gallery: every template version keeps its own copy and only
 * a plain reference to the workspace, which is cleared.
 */
export async function purgeIdlePrototypesWorkspaces(db: PrototypesExecutor, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDLE_DAYS * DAY_MS);
  return db.transaction(async (tx) => {
    const idle = await tx.select({ id: workspaces.id }).from(workspaces).where(lt(workspaces.lastActiveAt, cutoff));
    if (idle.length === 0) return 0;
    const ids = idle.map((row) => row.id);
    await tx
      .update(templates)
      .set({ workspaceId: null })
      .where(inArray(templates.workspaceId, ids));
    await tx
      .update(templateVersions)
      .set({ workspaceId: null })
      .where(inArray(templateVersions.workspaceId, ids));
    await tx.delete(workspaces).where(inArray(workspaces.id, ids));
    return ids.length;
  });
}

/**
 * Resets a workspace's Prototypes data (availability spec, "Visitors can reset
 * their Prototypes workspace"): its prototypes, versions, feedback, lessons,
 * personas, page shell, and share links are deleted, and the seeded content
 * comes back, in one transaction. The workspace keeps its identity and today's
 * generation count, so a reset never refills the daily limit. Templates it
 * accepted stay in the gallery and stay its to withdraw; the template demo's
 * data is in another store and is untouched.
 */
export async function resetPrototypesWorkspace(db: PrototypesExecutor, workspaceId: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    // Share links first, so none outlives its version; generations take their variants with them.
    await tx.delete(shares).where(eq(shares.workspaceId, workspaceId));
    await tx.delete(feedback).where(eq(feedback.workspaceId, workspaceId));
    await tx.delete(pairwiseReviews).where(eq(pairwiseReviews.workspaceId, workspaceId));
    await tx.delete(lessonChecks).where(eq(lessonChecks.workspaceId, workspaceId));
    await tx.delete(lessons).where(eq(lessons.workspaceId, workspaceId));
    await tx.delete(sandboxRuns).where(eq(sandboxRuns.workspaceId, workspaceId));
    await tx.delete(versions).where(eq(versions.workspaceId, workspaceId));
    await tx.delete(prototypes).where(eq(prototypes.workspaceId, workspaceId));
    await tx.delete(generations).where(eq(generations.workspaceId, workspaceId));
    await tx.delete(benchmarkIntents).where(eq(benchmarkIntents.workspaceId, workspaceId));
    await tx.delete(personas).where(eq(personas.workspaceId, workspaceId));
    await tx.delete(pageShells).where(eq(pageShells.workspaceId, workspaceId));
    await tx.update(templates).set({ prototypeId: null }).where(eq(templates.workspaceId, workspaceId));
    await tx.update(workspaces).set({ prototypeCount: 0, personaCount: 0, lessonCount: 0, lastActiveAt: now }).where(eq(workspaces.id, workspaceId));
    await seedWorkspace(tx, workspaceId, now);
  });
}

const purgeClock = globalThis as typeof globalThis & { __fabricatePrototypesPurgeAt?: number };

/** Runs the idle purge at most once an hour per instance. */
export async function maybePurgeIdlePrototypesWorkspaces(db: PrototypesExecutor, now = new Date()): Promise<number | null> {
  const last = purgeClock.__fabricatePrototypesPurgeAt;
  if (last !== undefined && now.getTime() - last < HOUR_MS) return null;
  purgeClock.__fabricatePrototypesPurgeAt = now.getTime();
  return purgeIdlePrototypesWorkspaces(db, now);
}
