import { cookies } from "next/headers";
import { WORKSPACE_COOKIE } from "@/lib/demo/workspace-key";
import { type PrototypesExecutor, getPrototypesDb } from "./db/client";
import { requirePrototypes } from "./guard";
import { type PrototypesWorkspace, ensurePrototypesWorkspace, findPrototypesWorkspace, maybePurgeIdlePrototypesWorkspaces, touchPrototypesWorkspace } from "./workspace";

/**
 * The visitor's Prototypes workspace, from the anonymous credential the
 * request proxy issues on Prototypes paths (design.md, decision 2).
 */

export interface PrototypesRequest {
  readonly db: PrototypesExecutor;
  readonly workspace: PrototypesWorkspace;
}

async function workspaceKey(): Promise<string | undefined> {
  return (await cookies()).get(WORKSPACE_COOKIE)?.value;
}

/**
 * For pages and Server Actions: the visitor's workspace, created and seeded
 * on their first Prototypes request. It renders the not-found page while
 * Prototypes is disabled. Reading records activity (at most
 * hourly) and runs the idle purge (at most hourly per instance).
 */
export async function prototypesRequest(): Promise<PrototypesRequest> {
  // The switch comes first, so a disabled Prototypes never creates a workspace.
  requirePrototypes();
  const db = await getPrototypesDb();
  await maybePurgeIdlePrototypesWorkspaces(db);
  const key = await workspaceKey();
  if (!key) throw new Error("The request proxy didn't issue a workspace credential; Prototypes paths must be in its matcher");
  const workspace = await ensurePrototypesWorkspace(db, key);
  await touchPrototypesWorkspace(db, workspace.id);
  return { db, workspace };
}

/** For render routes and endpoints: the visitor's workspace if it exists, without creating one. */
export async function existingPrototypesRequest(): Promise<PrototypesRequest | null> {
  const db = await getPrototypesDb();
  const workspace = await findPrototypesWorkspace(db, await workspaceKey());
  return workspace ? { db, workspace } : null;
}
