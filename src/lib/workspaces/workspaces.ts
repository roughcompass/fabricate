import { and, eq, lt } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { sessionPresetChoices, shareLinks, commentThreads, workspaces } from "@/lib/db/schema";
import { clearWorkspaceChoices } from "@/lib/mocks/active";
import { keyDigest } from "./workspace-digest";
import { isWorkspaceKey } from "./workspace-key";
import { type HintState, parseHints } from "./hints";

/**
 * Anonymous workspaces (template-demo/demo-mode spec, "Each visitor works in
 * an anonymous workspace"): a visitor's comment threads and share links on
 * applications, their display name, and their guidance state. A workspace
 * row exists only after its first write, and browsing alone leaves nothing
 * behind.
 */

export const COMMENT_LIMIT = 2000;
/** The open comment threads a workspace can hold (template-demo/demo-mode spec, "Workspace comments are bounded"). */
export const THREAD_LIMIT = 500;
const DISPLAY_NAME_LIMIT = 60;
const IDLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type { HintState } from "./hints";

export interface Workspace {
  readonly id: number;
  readonly displayName: string | null;
  readonly hints: HintState;
}

/** Raised when a workspace limit would be exceeded; the message is shown to the visitor. */
export class WorkspaceLimitError extends Error {
  override name = "WorkspaceLimitError";
}

export { keyDigest } from "./workspace-digest";

/** The visitor's workspace, or null when it has not been written to yet. */
export function findWorkspace(db: Executor, key: string | undefined): Workspace | null {
  if (!isWorkspaceKey(key)) return null;
  const row = db.select().from(workspaces).where(eq(workspaces.keyDigest, keyDigest(key))).get();
  return row ? toWorkspace(row) : null;
}

/** The visitor's workspace, created on the first write. */
export function ensureWorkspace(db: Executor, key: string, now = new Date()): Workspace {
  if (!isWorkspaceKey(key)) throw new ValidationError([{ field: "workspace", message: "This browser has no workspace yet. Reload the page and try again." }]);
  return immediate(db, (tx) => {
    const digest = keyDigest(key);
    const existing = tx.select().from(workspaces).where(eq(workspaces.keyDigest, digest)).get();
    if (existing) return toWorkspace(existing);
    return toWorkspace(tx.insert(workspaces).values({ keyDigest: digest, createdAt: now, lastSeenAt: now }).returning().get());
  });
}

/** Records activity at most once an hour, so reads stay cheap. */
export function touchWorkspace(db: Executor, workspaceId: number, now = new Date()): void {
  db.update(workspaces)
    .set({ lastSeenAt: now })
    .where(and(eq(workspaces.id, workspaceId), lt(workspaces.lastSeenAt, new Date(now.getTime() - HOUR_MS))))
    .run();
}

/** Deletes workspaces idle for 30 days, with everything they own. Returns how many were removed. */
export function purgeIdleWorkspaces(db: Executor, now = new Date()): number {
  const cutoff = new Date(now.getTime() - IDLE_DAYS * DAY_MS);
  return db.delete(workspaces).where(lt(workspaces.lastSeenAt, cutoff)).run().changes;
}

const purgeClock = globalThis as typeof globalThis & { __frontendRegistryDemoPurgeAt?: number };

/** Runs the idle purge at most once an hour per process. */
export function maybePurgeIdleWorkspaces(db: Executor, now = new Date()): number | null {
  const last = purgeClock.__frontendRegistryDemoPurgeAt;
  if (last !== undefined && now.getTime() - last < HOUR_MS) return null;
  purgeClock.__frontendRegistryDemoPurgeAt = now.getTime();
  return purgeIdleWorkspaces(db, now);
}

/** Forgets when the purge last ran (tests only).
 * @public Tests use it.
 */
export function resetPurgeClock(): void {
  purgeClock.__frontendRegistryDemoPurgeAt = undefined;
}

export function normalizeDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name === "") throw new ValidationError([{ field: "displayName", message: "Enter a display name" }]);
  if (name.length > DISPLAY_NAME_LIMIT) throw new ValidationError([{ field: "displayName", message: `Use at most ${DISPLAY_NAME_LIMIT} characters` }]);
  return name;
}

export function setDisplayName(db: Executor, workspaceId: number, value: string): string {
  const name = normalizeDisplayName(value);
  db.update(workspaces).set({ displayName: name }).where(eq(workspaces.id, workspaceId)).run();
  return name;
}

export function setHints(db: Executor, workspaceId: number, hints: HintState): HintState {
  const next = parseHints(JSON.stringify(hints));
  db.update(workspaces).set({ hints: JSON.stringify(next) }).where(eq(workspaces.id, workspaceId)).run();
  return next;
}

/**
 * Clears a workspace (template-demo/demo-mode spec, "Visitors can reset
 * their workspace's comments and share links"): its comment threads, its
 * share links, which stop working, its choices of session presets and mock
 * sets, and its display name, and restores its guidance state. Applications,
 * their saved previews, session presets, and mock sets, and other workspaces
 * are untouched, and so
 * are replies the visitor left in views others shared, which are theirs.
 */
export function resetWorkspace(db: Executor, workspaceId: number): Workspace {
  return immediate(db, (tx) => {
    tx.delete(commentThreads).where(eq(commentThreads.viewWorkspaceId, workspaceId)).run();
    tx.delete(shareLinks).where(eq(shareLinks.viewWorkspaceId, workspaceId)).run();
    tx.delete(sessionPresetChoices).where(eq(sessionPresetChoices.workspaceId, workspaceId)).run();
    // Mock set choices go; the mock sets stay with their applications (add-mock-sets, task 2.6).
    clearWorkspaceChoices(tx, workspaceId);
    const current = tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
    if (!current) throw new ValidationError([{ field: "workspace", message: "This workspace no longer exists" }]);
    return toWorkspace(
      tx
        .update(workspaces)
        .set({ displayName: null, hints: "{}" })
        .where(eq(workspaces.id, workspaceId))
        .returning()
        .get(),
    );
  });
}

function toWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  return { id: row.id, displayName: row.displayName, hints: parseHints(row.hints) };
}

