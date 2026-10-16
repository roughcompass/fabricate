import { eq } from "drizzle-orm";
import { getPrototypesDb } from "@/lib/prototypes/db/client";
import { generations, variants } from "@/lib/prototypes/db/schema";
import { VariantFailure } from "@/lib/prototypes/pipeline/errors";
import { generationHasRecurringFailure, proposeLessons } from "@/lib/prototypes/pipeline/learn";
import { runPairwise } from "@/lib/prototypes/pipeline/pairwise";
import { failPlan, planGeneration } from "@/lib/prototypes/pipeline/plan";
import { reviewVariant } from "@/lib/prototypes/pipeline/review";
import { finishGeneration } from "@/lib/prototypes/pipeline/start";
import { type AttemptOutcome, attemptVariant, failVariant } from "@/lib/prototypes/pipeline/variant";
import { judgeLessonCheck, lessonCheckGenerations } from "@/lib/prototypes/lesson-check";
import { runRecheck } from "@/lib/prototypes/rechecks";
import { runSandbox } from "@/lib/prototypes/sandbox";

/*
 * The generation's steps (design.md, decision 5). Each is a plain async
 * function over the Prototypes store. Inside a Vercel Workflow run, "use
 * step" makes each a durable, retried step; the inline runner calls the same
 * functions in-process. Their arguments and results are ids and strings, so
 * they serialize.
 */

export async function planStep(generationId: string): Promise<"planned" | "failed"> {
  "use step";
  const db = await getPrototypesDb();
  try {
    await planGeneration(db, generationId);
    return "planned";
  } catch (error) {
    if (!(error instanceof VariantFailure)) throw error;
    await failPlan(db, generationId, error.failure);
    return "failed";
  }
}

export async function variantIdsStep(generationId: string): Promise<string[]> {
  "use step";
  const db = await getPrototypesDb();
  const rows = await db.select({ id: variants.id }).from(variants).where(eq(variants.generationId, generationId)).orderBy(variants.position);
  return rows.map((row) => row.id);
}

export async function attemptStep(variantId: string): Promise<AttemptOutcome> {
  "use step";
  return attemptVariant(await getPrototypesDb(), variantId);
}
// An attempt calls a model, so a crashed one is retried once, not three times.
attemptStep.maxRetries = 1;

export async function reviewStep(variantId: string): Promise<void> {
  "use step";
  await reviewVariant(await getPrototypesDb(), variantId);
}

export async function failVariantStep(variantId: string, message: string): Promise<void> {
  "use step";
  await failVariant(await getPrototypesDb(), variantId, { kind: "internal", message });
}

export async function finishStep(generationId: string): Promise<void> {
  "use step";
  await finishGeneration(await getPrototypesDb(), generationId);
}

export async function pairwiseStep(reviewId: string): Promise<void> {
  "use step";
  await runPairwise(await getPrototypesDb(), reviewId);
}
pairwiseStep.maxRetries = 1;

export async function proposeLessonsStep(workspaceId: string, feedbackIds: string[]): Promise<number> {
  "use step";
  return proposeLessons(await getPrototypesDb(), workspaceId, feedbackIds);
}
proposeLessonsStep.maxRetries = 1;

/** After a generation: a failure that now recurs in two generations is worth a lesson (design.md, decision 11). */
export async function recurringFailureStep(generationId: string): Promise<string | null> {
  "use step";
  const db = await getPrototypesDb();
  if (!(await generationHasRecurringFailure(db, generationId))) return null;
  const [generation] = await db.select({ workspaceId: generations.workspaceId }).from(generations).where(eq(generations.id, generationId));
  return generation?.workspaceId ?? null;
}

/** Re-checks a template version against the current runtime build (design.md, decision 17). It calls no model. */
export async function recheckStep(recheckId: string): Promise<void> {
  "use step";
  await runRecheck(await getPrototypesDb(), recheckId);
}
recheckStep.maxRetries = 1;

export async function lessonCheckGenerationsStep(checkId: string): Promise<string[]> {
  "use step";
  return lessonCheckGenerations(await getPrototypesDb(), checkId);
}

/** Judges a lesson check's pairs once its generations finish (learning spec, "A lesson check measures whether lessons help"). */
export async function judgeLessonCheckStep(checkId: string): Promise<void> {
  "use step";
  await judgeLessonCheck(await getPrototypesDb(), checkId);
}
judgeLessonCheckStep.maxRetries = 1;

/** Starts a version as a standalone app in Vercel Sandbox (preview spec). A failed start is recorded, not retried. */
export async function sandboxStep(runId: string): Promise<void> {
  "use step";
  await runSandbox(await getPrototypesDb(), runId);
}
sandboxStep.maxRetries = 0;
