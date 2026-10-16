"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ComposerFormState } from "@/components/ui/composer";
import type { FormState } from "@/components/ui/form";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { startRefinement } from "@/lib/prototypes/pipeline/refine";
import { GenerationUnavailableError } from "@/lib/prototypes/pipeline/start";
import { addNote, rateVersion, setNoteStatus } from "@/lib/prototypes/feedback";
import { forkVersion } from "@/lib/prototypes/fork";
import { deletePrototype, renamePrototype } from "@/lib/prototypes/prototypes";
import type { NotedElement } from "@/lib/prototypes/types";
import { prototypesRequest } from "@/lib/prototypes/request";
import { dispatch } from "@/lib/prototypes/runner";
import { errorsFrom, text } from "@/lib/web/form-data";

function assertIds(prototypeId: string, versionId?: string): void {
  if (!isPublicId(prototypeId, "pro") || (versionId !== undefined && !isPublicId(versionId, "ver"))) throw new NotFoundError("Unknown prototype");
}

/** Sends a refinement built on the version shown (generation spec, "Refining a version"). */
export async function refineAction(prototypeId: string, versionId: string, _previous: ComposerFormState, formData: FormData): Promise<ComposerFormState> {
  requirePrototypes();
  assertIds(prototypeId, versionId);
  const values = { message: text(formData, "message", 4_000) };
  const { db, workspace } = await prototypesRequest();
  let generationId: string;
  try {
    generationId = await startRefinement(db, workspace.id, prototypeId, versionId, values.message);
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof PrototypesLimitError || error instanceof GenerationUnavailableError) return { values, errors: { base: [error.message] } };
    throw error;
  }
  await dispatch({ kind: "refine", generationId });
  redirect(`/prototypes/${prototypeId}?notice=refining`);
}

export async function renameAction(prototypeId: string, _previous: FormState<{ name: string }>, formData: FormData): Promise<FormState<{ name: string }>> {
  requirePrototypes();
  assertIds(prototypeId);
  const values = { name: text(formData, "name", 400) };
  const { db, workspace } = await prototypesRequest();
  try {
    await renamePrototype(db, workspace.id, prototypeId, values.name);
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    throw error;
  }
  redirect(`/prototypes/${prototypeId}?notice=renamed`);
}

/** Deletes a prototype; its lessons and any template accepted from it remain (versions spec). */
export async function deletePrototypeAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const prototypeId = text(formData, "prototype", 40);
  assertIds(prototypeId);
  const { db, workspace } = await prototypesRequest();
  await deletePrototype(db, workspace.id, prototypeId);
  redirect("/prototypes?notice=deleted");
}

/** Forks the version shown into a new prototype, without a model call (versions spec, "Any version can be forked"). */
export async function forkAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const prototypeId = text(formData, "prototype", 40);
  const versionId = text(formData, "version", 40);
  assertIds(prototypeId, versionId);
  const { db, workspace } = await prototypesRequest();
  let forkId: string;
  try {
    forkId = await forkVersion(db, workspace.id, versionId);
  } catch (error) {
    if (error instanceof PrototypesLimitError) redirect(`/prototypes/${prototypeId}?notice=fork-limit`);
    throw error;
  }
  redirect(`/prototypes/${forkId}?notice=forked`);
}

export type RatingState = FormState<{ rating: string; note: string }> & { saved?: boolean };

/** Rates the version shown; a note proposes lessons, and a rating alone never does (learning spec). */
export async function rateAction(prototypeId: string, versionId: string, _previous: RatingState, formData: FormData): Promise<RatingState> {
  requirePrototypes();
  assertIds(prototypeId, versionId);
  const values = { rating: text(formData, "rating", 2), note: text(formData, "note", 4_000) };
  const { db, workspace } = await prototypesRequest();
  let feedbackId: string;
  try {
    feedbackId = (await rateVersion(db, workspace.id, versionId, Number.parseInt(values.rating, 10), values.note)).id;
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    throw error;
  }
  if (values.note.trim()) await dispatch({ kind: "lessons", workspaceId: workspace.id, feedbackIds: [feedbackId] });
  // The page stays where it is, so rating again is the same address; refreshing it shows the new rating.
  revalidatePath(`/prototypes/${prototypeId}`);
  return { values, errors: {}, saved: true };
}

/** Pins a note to the element a visitor selected in the preview, and proposes lessons from it. */
export async function addNoteAction(prototypeId: string, versionId: string, input: { text: string; element: NotedElement }): Promise<{ ok: true } | { ok: false; error: string }> {
  requirePrototypes();
  assertIds(prototypeId, versionId);
  const { db, workspace } = await prototypesRequest();
  const element: NotedElement = {
    component: String(input.element.component).slice(0, 80),
    locator: String(input.element.locator).slice(0, 600),
    text: String(input.element.text).slice(0, 200),
    image: typeof input.element.image === "string" && input.element.image.startsWith("data:image/png;base64,") && input.element.image.length < 400_000 ? input.element.image : null,
  };
  try {
    const note = await addNote(db, workspace.id, versionId, String(input.text), element);
    await dispatch({ kind: "lessons", workspaceId: workspace.id, feedbackIds: [note.id] });
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, error: error.issues.map((issue) => issue.message).join(" ") };
    throw error;
  }
  return { ok: true };
}

export async function noteStatusAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const prototypeId = text(formData, "prototype", 40);
  const noteId = text(formData, "note", 40);
  assertIds(prototypeId);
  if (!isPublicId(noteId, "fbk")) throw new NotFoundError("Unknown note");
  const { db, workspace } = await prototypesRequest();
  await setNoteStatus(db, workspace.id, noteId, text(formData, "status", 10) === "resolved" ? "resolved" : "open");
  const v = text(formData, "v", 6);
  redirect(`/prototypes/${prototypeId}?${new URLSearchParams({ ...(v ? { v } : {}), tab: "feedback" })}`);
}
