"use server";

import { redirect } from "next/navigation";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { startPairwise } from "@/lib/prototypes/pipeline/pairwise";
import { prototypesRequest } from "@/lib/prototypes/request";
import { dispatch } from "@/lib/prototypes/runner";
import { text } from "@/lib/web/form-data";

/** Asks for a pairwise review of the pair shown; it counts toward the daily limit (quality-checks spec). */
export async function pairwiseAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const prototypeId = text(formData, "prototype", 40);
  const [versionA, versionB] = [text(formData, "versionA", 40), text(formData, "versionB", 40)];
  if (!isPublicId(prototypeId, "pro") || !isPublicId(versionA, "ver") || !isPublicId(versionB, "ver")) throw new NotFoundError("Unknown version");
  const back = `/prototypes/${prototypeId}/compare?${new URLSearchParams({ a: text(formData, "a", 10), b: text(formData, "b", 10) })}`;
  const { db, workspace } = await prototypesRequest();
  let reviewId: string;
  try {
    reviewId = await startPairwise(db, workspace.id, versionA, versionB);
  } catch (error) {
    if (error instanceof PrototypesLimitError) redirect(`${back}&notice=limit`);
    throw error;
  }
  await dispatch({ kind: "pairwise", reviewId });
  redirect(back);
}
