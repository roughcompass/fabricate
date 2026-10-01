"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { requireDemo } from "@/lib/demo/guard";
import { currentWorkspace } from "@/lib/demo/request";
import { resetWorkspace } from "@/lib/demo/workspaces";

/**
 * Clears the visitor's workspace: their applications, comments, share links,
 * and guidance state. Other visitors and the reference deployments are untouched.
 */
export async function resetDemo(): Promise<void> {
  requireDemo();
  const workspace = await currentWorkspace();
  if (workspace) resetWorkspace(getDb(), workspace.id);
  redirect("/new?notice=reset");
}
