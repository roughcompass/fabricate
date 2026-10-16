"use server";

import { redirect } from "next/navigation";
import { ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { heroSlugOf } from "@/lib/prototypes/heroes/use";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { GenerationUnavailableError, startGeneration } from "@/lib/prototypes/pipeline/start";
import { prototypesRequest } from "@/lib/prototypes/request";
import { dispatch } from "@/lib/prototypes/runner";
import type { Scope } from "@/lib/prototypes/types";
import { resetPrototypesWorkspace } from "@/lib/prototypes/workspace";
import { errorsFrom, text, texts } from "@/lib/web/form-data";
import type { ComposerState, ComposerValues } from "./form-state";

/** Starts a generation from New prototype and opens its variants page (generation spec, "Starting a generation"). */
export async function generateAction(_previous: ComposerState, formData: FormData): Promise<ComposerState> {
  requirePrototypes();
  const values: ComposerValues = { intent: text(formData, "intent", 4_000), scope: text(formData, "scope", 20), personas: texts(formData, "personas", 40, 10), variants: text(formData, "variants", 2), template: text(formData, "template", 40) };
  const { db, workspace } = await prototypesRequest();
  let generationId: string;
  try {
    generationId = await startGeneration(db, workspace.id, { intent: values.intent, scope: values.scope as Scope, personaIds: values.personas, variants: Number.parseInt(values.variants, 10), templateId: isPublicId(values.template, "ptp") || heroSlugOf(values.template) ? values.template : null });
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof PrototypesLimitError || error instanceof GenerationUnavailableError) return { values, errors: { base: [error.message] } };
    throw error;
  }
  await dispatch({ kind: "generate", generationId });
  redirect(`/prototypes/generations/${generationId}`);
}

/** Resets the visitor's Prototypes workspace to its seeded content, after confirmation (availability spec, "Resetting"). */
export async function resetPrototypesAction(): Promise<void> {
  requirePrototypes();
  const { db, workspace } = await prototypesRequest();
  await resetPrototypesWorkspace(db, workspace.id);
  redirect("/prototypes?notice=reset");
}
