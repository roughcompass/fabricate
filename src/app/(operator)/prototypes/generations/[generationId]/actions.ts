"use server";

import { redirect } from "next/navigation";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { prototypesRequest } from "@/lib/prototypes/request";
import { dispatch } from "@/lib/prototypes/runner";
import { deleteGeneration, discardVariant, keepVariant, retryVariant } from "@/lib/prototypes/variants";
import { text } from "@/lib/web/form-data";

function ids(formData: FormData): { generationId: string; variantId: string } {
  const generationId = text(formData, "generation", 40);
  const variantId = text(formData, "variant", 40);
  if (!isPublicId(generationId, "gen") || !isPublicId(variantId, "var")) throw new NotFoundError("Unknown variant");
  return { generationId, variantId };
}

/** Keeps or discards a variant, with an optional reason (versions spec, "Keeping a variant creates a prototype"). */
export async function decideVariantAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const { generationId, variantId } = ids(formData);
  const { db, workspace } = await prototypesRequest();
  // The single-variant view sends its own address, so the visitor stays on it.
  const requested = text(formData, "back", 200);
  const back = requested.startsWith(`/prototypes/generations/${generationId}/`) ? requested : `/prototypes/generations/${generationId}`;
  let notice: string;
  let feedbackId: string | null;
  try {
    if (text(formData, "decision", 20) === "kept") {
      const kept = await keepVariant(db, workspace.id, variantId, text(formData, "reason", 4_000));
      notice = `kept&prototype=${kept.prototypeId}`;
      feedbackId = kept.feedbackId;
    } else {
      feedbackId = await discardVariant(db, workspace.id, variantId, text(formData, "reason", 4_000));
      notice = "discarded";
    }
  } catch (error) {
    if (error instanceof PrototypesLimitError || error instanceof ValidationError) redirect(`${back}?notice=refused&variant=${variantId}&reason=${error instanceof ValidationError ? "reason" : "limit"}`);
    throw error;
  }
  // A reason teaches later generations (learning spec, "The agent proposes lessons from feedback and checks").
  if (feedbackId) await dispatch({ kind: "lessons", workspaceId: workspace.id, feedbackIds: [feedbackId] });
  redirect(`${back}?notice=${notice}`);
}

/** Retries a failed variant; the retry counts toward today's limit. */
export async function retryVariantAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const { generationId, variantId } = ids(formData);
  const { db, workspace } = await prototypesRequest();
  try {
    await retryVariant(db, workspace.id, variantId);
  } catch (error) {
    if (error instanceof PrototypesLimitError) redirect(`/prototypes/generations/${generationId}?notice=limit`);
    throw error;
  }
  await dispatch({ kind: "retry", generationId, variantId });
  redirect(`/prototypes/generations/${generationId}`);
}

/** Deletes a generation and its unkept variants, after confirmation; prototypes kept from it stay. */
export async function deleteGenerationAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const generationId = text(formData, "generation", 40);
  if (!isPublicId(generationId, "gen")) throw new NotFoundError("Unknown generation");
  const { db, workspace } = await prototypesRequest();
  try {
    await deleteGeneration(db, workspace.id, generationId);
  } catch (error) {
    if (error instanceof PrototypesLimitError) redirect(`/prototypes/generations/${generationId}?notice=delete-running`);
    throw error;
  }
  redirect("/prototypes?notice=generation-deleted");
}
