"use server";

import { revalidatePath } from "next/cache";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { acceptLesson, addLesson, deleteLesson, dismissLesson, editLesson, scopeFor, setLessonActive } from "@/lib/prototypes/lessons";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { prototypesRequest } from "@/lib/prototypes/request";
import type { FormState } from "@/components/ui/form";
import { startLessonCheck, updateBenchmark } from "@/lib/prototypes/lesson-check";
import { GenerationUnavailableError } from "@/lib/prototypes/pipeline/start";
import { dispatch } from "@/lib/prototypes/runner";
import { errorsFrom, text, texts } from "@/lib/web/form-data";

export type LessonFormState = FormState<{ text: string; category: string; scope: string }> & { saved?: number };

const PAGE = "/prototypes/lessons";

function read(formData: FormData) {
  return { text: text(formData, "text", 1_000), category: text(formData, "category", 40), scope: text(formData, "scope", 40) };
}

function lessonId(formData: FormData): string {
  const id = text(formData, "lesson", 40);
  if (!isPublicId(id, "lsn")) throw new NotFoundError("Unknown lesson");
  return id;
}

/**
 * Saves a lesson form: adding one written directly, editing one, or accepting
 * a proposal with the visitor's edits (learning spec, "Lessons are visible
 * and under the visitor's control").
 */
export async function saveLessonAction(mode: "add" | "edit" | "accept", id: string | null, previous: LessonFormState, formData: FormData): Promise<LessonFormState> {
  requirePrototypes();
  const values = read(formData);
  const { db, workspace } = await prototypesRequest();
  try {
    const scope = await scopeFor(db, workspace.id, values.scope);
    if (mode === "add") await addLesson(db, workspace.id, { ...values, scope });
    else if (!id || !isPublicId(id, "lsn")) throw new NotFoundError("Unknown lesson");
    else if (mode === "edit") await editLesson(db, workspace.id, id, { ...values, scope });
    else await acceptLesson(db, workspace.id, id, { ...values, scope });
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof PrototypesLimitError) return { values, errors: { base: [error.message] } };
    throw error;
  }
  revalidatePath(PAGE);
  return { values: mode === "add" ? { text: "", category: values.category, scope: values.scope } : values, errors: {}, saved: (previous.saved ?? 0) + 1 };
}

export async function acceptLessonAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const { db, workspace } = await prototypesRequest();
  await acceptLesson(db, workspace.id, lessonId(formData));
  revalidatePath(PAGE);
}

export async function dismissLessonAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const { db, workspace } = await prototypesRequest();
  await dismissLesson(db, workspace.id, lessonId(formData));
  revalidatePath(PAGE);
}

export async function toggleLessonAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const { db, workspace } = await prototypesRequest();
  await setLessonActive(db, workspace.id, lessonId(formData), text(formData, "active", 6) === "true");
  revalidatePath(PAGE);
}

export async function deleteLessonAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const { db, workspace } = await prototypesRequest();
  await deleteLesson(db, workspace.id, lessonId(formData));
  revalidatePath(PAGE);
}

export type LessonCheckState = { readonly error: string | null };

/** Starts a lesson check (learning spec, "A lesson check measures whether lessons help"). */
export async function runLessonCheckAction(_previous: LessonCheckState): Promise<LessonCheckState> {
  requirePrototypes();
  const { db, workspace } = await prototypesRequest();
  let checkId: string;
  try {
    checkId = await startLessonCheck(db, workspace.id);
  } catch (error) {
    if (error instanceof PrototypesLimitError || error instanceof GenerationUnavailableError) return { error: error.message };
    throw error;
  }
  await dispatch({ kind: "lesson-check", checkId });
  revalidatePath(PAGE);
  return { error: null };
}

export type BenchmarkFormState = FormState<{ intent: string; scope: string; personas: string[] }> & { saved?: number };

/** Saves a benchmark intent; earlier lesson checks keep the intents they used (learning spec, "Editing a benchmark intent"). */
export async function saveBenchmarkAction(benchmarkId: string, previous: BenchmarkFormState, formData: FormData): Promise<BenchmarkFormState> {
  requirePrototypes();
  if (!isPublicId(benchmarkId, "bmi")) throw new NotFoundError("Unknown benchmark intent");
  const values = { intent: text(formData, "intent", 4_000), scope: text(formData, "scope", 20), personas: texts(formData, "personas", 40, 10) };
  const { db, workspace } = await prototypesRequest();
  try {
    await updateBenchmark(db, workspace.id, benchmarkId, { intent: values.intent, scope: values.scope, personaIds: values.personas });
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    throw error;
  }
  revalidatePath(PAGE);
  return { values, errors: {}, saved: (previous.saved ?? 0) + 1 };
}
