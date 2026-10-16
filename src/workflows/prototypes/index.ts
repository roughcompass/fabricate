import { orchestrateGeneration, orchestrateLessonCheck, orchestrateLessons, orchestratePairwise, orchestrateRecheck, orchestrateRefinement, orchestrateRetry, orchestrateSandbox } from "./orchestrate";

/*
 * The Vercel Workflows for Prototypes (design.md, decision 5). Each only
 * sequences steps; the inline runner runs the same sequences without
 * Workflow when FABRICATE_PROTOTYPES_RUNNER=inline.
 */

export async function generateWorkflow(generationId: string): Promise<void> {
  "use workflow";
  await orchestrateGeneration(generationId);
}

export async function refineWorkflow(generationId: string): Promise<void> {
  "use workflow";
  await orchestrateRefinement(generationId);
}

export async function retryWorkflow(generationId: string, variantId: string): Promise<void> {
  "use workflow";
  await orchestrateRetry(generationId, variantId);
}

export async function pairwiseWorkflow(reviewId: string): Promise<void> {
  "use workflow";
  await orchestratePairwise(reviewId);
}

export async function lessonsWorkflow(workspaceId: string, feedbackIds: string[]): Promise<void> {
  "use workflow";
  await orchestrateLessons(workspaceId, feedbackIds);
}

export async function recheckWorkflow(recheckId: string): Promise<void> {
  "use workflow";
  await orchestrateRecheck(recheckId);
}

export async function lessonCheckWorkflow(checkId: string): Promise<void> {
  "use workflow";
  await orchestrateLessonCheck(checkId);
}

export async function sandboxWorkflow(runId: string): Promise<void> {
  "use workflow";
  await orchestrateSandbox(runId);
}
