import { and, eq, lt } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { demoProfiles, demoShares, demoThreads, demoWorkspaces } from "@/lib/db/schema";
import { keyDigest } from "./workspace-digest";
import { isWorkspaceKey } from "./workspace-key";
import { type HintState, parseHints } from "./hints";

/**
 * Anonymous demo workspaces (template-demo/demo-mode spec; design.md,
 * decisions 3 and 16). A workspace row exists only after its first write, and
 * browsing alone leaves nothing behind.
 */

export const COMMENT_LIMIT = 2000;
export const DISPLAY_NAME_LIMIT = 60;
export const IDLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type { HintState } from "./hints";

export interface Workspace {
  readonly id: number;
  readonly displayName: string | null;
  readonly hints: HintState;
  readonly resetEpoch: number;
}

/** Raised when a workspace limit would be exceeded; the message is shown to the visitor. */
export class DemoLimitError extends Error {
  override name = "DemoLimitError";
}

export { keyDigest } from "./workspace-digest";

/** The visitor's workspace, or null when it has not been written to yet. */
export function findWorkspace(db: Executor, key: string | undefined): Workspace | null {
  if (!isWorkspaceKey(key)) return null;
  const row = db.select().from(demoWorkspaces).where(eq(demoWorkspaces.keyDigest, keyDigest(key))).get();
  return row ? toWorkspace(row) : null;
}

/** The visitor's workspace, created on the first write. */
export function ensureWorkspace(db: Executor, key: string, now = new Date()): Workspace {
  if (!isWorkspaceKey(key)) throw new ValidationError([{ field: "workspace", message: "This browser has no demo workspace. Reload the page and try again." }]);
  return immediate(db, (tx) => {
    const digest = keyDigest(key);
    const existing = tx.select().from(demoWorkspaces).where(eq(demoWorkspaces.keyDigest, digest)).get();
    if (existing) return toWorkspace(existing);
    return toWorkspace(tx.insert(demoWorkspaces).values({ keyDigest: digest, createdAt: now, lastSeenAt: now }).returning().get());
  });
}

/** Records activity at most once an hour, so reads stay cheap. */
export function touchWorkspace(db: Executor, workspaceId: number, now = new Date()): void {
  db.update(demoWorkspaces)
    .set({ lastSeenAt: now })
    .where(and(eq(demoWorkspaces.id, workspaceId), lt(demoWorkspaces.lastSeenAt, new Date(now.getTime() - HOUR_MS))))
    .run();
}

/** Deletes workspaces idle for 30 days, with everything they own. Returns how many were removed. */
export function purgeIdleWorkspaces(db: Executor, now = new Date()): number {
  const cutoff = new Date(now.getTime() - IDLE_DAYS * DAY_MS);
  return db.delete(demoWorkspaces).where(lt(demoWorkspaces.lastSeenAt, cutoff)).run().changes;
}

const purgeClock = globalThis as typeof globalThis & { __fabricateDemoPurgeAt?: number };

/** Runs the idle purge at most once an hour per process. */
export function maybePurgeIdleWorkspaces(db: Executor, now = new Date()): number | null {
  const last = purgeClock.__fabricateDemoPurgeAt;
  if (last !== undefined && now.getTime() - last < HOUR_MS) return null;
  purgeClock.__fabricateDemoPurgeAt = now.getTime();
  return purgeIdleWorkspaces(db, now);
}

/** Forgets when the purge last ran (tests only). */
export function resetPurgeClock(): void {
  purgeClock.__fabricateDemoPurgeAt = undefined;
}

export function normalizeDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name === "") throw new ValidationError([{ field: "displayName", message: "Enter a display name" }]);
  if (name.length > DISPLAY_NAME_LIMIT) throw new ValidationError([{ field: "displayName", message: `Use at most ${DISPLAY_NAME_LIMIT} characters` }]);
  return name;
}

export function setDisplayName(db: Executor, workspaceId: number, value: string): string {
  const name = normalizeDisplayName(value);
  db.update(demoWorkspaces).set({ displayName: name }).where(eq(demoWorkspaces.id, workspaceId)).run();
  return name;
}

export function setHints(db: Executor, workspaceId: number, hints: HintState): HintState {
  const next = parseHints(JSON.stringify(hints));
  db.update(demoWorkspaces).set({ hints: JSON.stringify(next) }).where(eq(demoWorkspaces.id, workspaceId)).run();
  return next;
}

/**
 * Clears a workspace: its threads and share links on reference deployments,
 * its custom session profiles, and its guidance state. Other workspaces and
 * the reference deployments are untouched. The reset epoch advances so state
 * the browser kept from before is ignored.
 */
export function resetWorkspace(db: Executor, workspaceId: number): Workspace {
  return immediate(db, (tx) => {
    tx.delete(demoThreads).where(eq(demoThreads.viewWorkspaceId, workspaceId)).run();
    tx.delete(demoShares).where(eq(demoShares.viewWorkspaceId, workspaceId)).run();
    tx.delete(demoProfiles).where(eq(demoProfiles.workspaceId, workspaceId)).run();
    const current = tx.select().from(demoWorkspaces).where(eq(demoWorkspaces.id, workspaceId)).get();
    if (!current) throw new ValidationError([{ field: "workspace", message: "This demo workspace no longer exists" }]);
    return toWorkspace(
      tx
        .update(demoWorkspaces)
        .set({ hints: "{}", resetEpoch: current.resetEpoch + 1 })
        .where(eq(demoWorkspaces.id, workspaceId))
        .returning()
        .get(),
    );
  });
}

function toWorkspace(row: typeof demoWorkspaces.$inferSelect): Workspace {
  return { id: row.id, displayName: row.displayName, hints: parseHints(row.hints), resetEpoch: row.resetEpoch };
}

