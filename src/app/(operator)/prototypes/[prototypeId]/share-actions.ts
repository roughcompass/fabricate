"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { prototypesRequest } from "@/lib/prototypes/request";
import { dispatch } from "@/lib/prototypes/runner";
import { startSandboxRun } from "@/lib/prototypes/sandbox";
import { createShare, revokeShare } from "@/lib/prototypes/shares";
import { text } from "@/lib/web/form-data";

export type ShareState = { readonly path: string | null; readonly error: string | null; readonly submission: number };

/** Creates a read-only link to the version shown (sharing-and-export spec, "A version can be shared read-only"). The token is shown once. */
export async function createShareAction(prototypeId: string, versionId: string, previous: ShareState): Promise<ShareState> {
  requirePrototypes();
  if (!isPublicId(prototypeId, "pro") || !isPublicId(versionId, "ver")) throw new NotFoundError("Unknown version");
  const { db, workspace } = await prototypesRequest();
  const submission = previous.submission + 1;
  try {
    const token = await createShare(db, workspace.id, versionId);
    // The page lists the new link beside the others.
    revalidatePath(`/prototypes/${prototypeId}`);
    return { path: `/p/${token}`, error: null, submission };
  } catch (error) {
    if (error instanceof PrototypesLimitError) return { path: null, error: error.message, submission };
    throw error;
  }
}

/** Revokes a link, after which it answers not found (sharing-and-export spec, "Share links can be revoked"). */
export async function revokeShareAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const prototypeId = text(formData, "prototype", 40);
  const shareId = text(formData, "share", 40);
  if (!isPublicId(prototypeId, "pro") || !isPublicId(shareId, "shr")) throw new NotFoundError("Unknown share link");
  const { db, workspace } = await prototypesRequest();
  await revokeShare(db, workspace.id, shareId);
  redirect(`/prototypes/${prototypeId}?notice=share-revoked`);
}

/** Starts the version shown as a standalone app in Vercel Sandbox (preview spec, "Running in Sandbox"). */
export async function startSandboxAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const prototypeId = text(formData, "prototype", 40);
  const versionId = text(formData, "version", 40);
  if (!isPublicId(prototypeId, "pro") || !isPublicId(versionId, "ver")) throw new NotFoundError("Unknown version");
  const { db, workspace } = await prototypesRequest();
  const runId = await startSandboxRun(db, workspace.id, versionId);
  await dispatch({ kind: "sandbox", runId });
  revalidatePath(`/prototypes/${prototypeId}`);
}
