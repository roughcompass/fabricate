import { cookies } from "next/headers";
import { getDb } from "@/lib/db/client";
import { WORKSPACE_COOKIE } from "./workspace-key";
import { type Workspace, ensureWorkspace, findWorkspace, maybePurgeIdleWorkspaces, touchWorkspace } from "./workspaces";

/** The workspace credential the request proxy issued to this browser. */
async function workspaceKey(): Promise<string | undefined> {
  return (await cookies()).get(WORKSPACE_COOKIE)?.value;
}

/**
 * The visitor's workspace for reading, or null before their first write.
 * Reading records activity (at most hourly) and runs the idle purge (at most
 * hourly per process).
 */
export async function currentWorkspace(): Promise<Workspace | null> {
  const db = getDb();
  maybePurgeIdleWorkspaces(db);
  const workspace = findWorkspace(db, await workspaceKey());
  if (workspace) touchWorkspace(db, workspace.id);
  return workspace;
}

/** The visitor's workspace for writing, created on first use. */
export async function writableWorkspace(): Promise<Workspace> {
  const key = await workspaceKey();
  return ensureWorkspace(getDb(), key ?? "");
}
