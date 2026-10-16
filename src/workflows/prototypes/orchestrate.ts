import { attemptStep, failVariantStep, finishStep, judgeLessonCheckStep, lessonCheckGenerationsStep, pairwiseStep, planStep, proposeLessonsStep, recheckStep, recurringFailureStep, reviewStep, sandboxStep, variantIdsStep } from "./steps";

/*
 * The order of a generation's steps (design.md, decision 5): plan once, then
 * every variant at the same time, each written, checked, and repaired until
 * it is ready or fails, then reviewed. One variant failing never stops the
 * others. This only sequences steps, so it runs unchanged as a workflow's
 * body and in-process.
 */

/** At most the first attempt and the repair limit's repairs, with room for a retried crash. */
const MAX_ATTEMPTS = 8;

async function runVariant(variantId: string): Promise<void> {
  try {
    let outcome = await attemptStep(variantId);
    for (let attempt = 1; outcome === "retry" && attempt < MAX_ATTEMPTS; attempt++) outcome = await attemptStep(variantId);
    if (outcome === "ready") await reviewStep(variantId);
  } catch (error) {
    await failVariantStep(variantId, `Generation stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}. Retry.`);
  }
}

/** A generation's failures may now recur across generations, which proposes a lesson. A failure to propose never fails the generation. */
async function learnFromFailures(generationId: string): Promise<void> {
  try {
    const workspaceId = await recurringFailureStep(generationId);
    if (workspaceId) await proposeLessonsStep(workspaceId, []);
  } catch {
    // Lessons are advisory; the generation's own result stands.
  }
}

export async function orchestrateGeneration(generationId: string): Promise<void> {
  const planned = await planStep(generationId);
  if (planned === "planned") {
    const ids = await variantIdsStep(generationId);
    await Promise.allSettled(ids.map((id) => runVariant(id)));
  }
  await finishStep(generationId);
  await learnFromFailures(generationId);
}

/** A refinement has one variant, built on its base version, and no plan of its own. */
export async function orchestrateRefinement(generationId: string): Promise<void> {
  const ids = await variantIdsStep(generationId);
  await Promise.allSettled(ids.map((id) => runVariant(id)));
  await finishStep(generationId);
  await learnFromFailures(generationId);
}

/** Retrying one failed variant: the plan step finds the plan stored, unless the plan itself failed. */
export async function orchestrateRetry(generationId: string, variantId: string): Promise<void> {
  const planned = await planStep(generationId);
  if (planned === "planned") await runVariant(variantId);
  await finishStep(generationId);
}

export async function orchestratePairwise(reviewId: string): Promise<void> {
  await pairwiseStep(reviewId);
}

/** Proposes lessons from new text feedback (learning spec, "The agent proposes lessons from feedback and checks"). */
export async function orchestrateLessons(workspaceId: string, feedbackIds: readonly string[]): Promise<void> {
  await proposeLessonsStep(workspaceId, [...feedbackIds]);
}

export async function orchestrateRecheck(recheckId: string): Promise<void> {
  await recheckStep(recheckId);
}

/** A lesson check: its generations, with and without lessons, all at once, then the pairwise judgments. */
export async function orchestrateLessonCheck(checkId: string): Promise<void> {
  const ids = await lessonCheckGenerationsStep(checkId);
  await Promise.allSettled(ids.map((id) => orchestrateGeneration(id)));
  await judgeLessonCheckStep(checkId);
}

export async function orchestrateSandbox(runId: string): Promise<void> {
  await sandboxStep(runId);
}
