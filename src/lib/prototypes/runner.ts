import { after } from "next/server";
import { start } from "workflow/api";
import { getConfig } from "@/lib/config";
import { generateWorkflow, lessonCheckWorkflow, lessonsWorkflow, pairwiseWorkflow, recheckWorkflow, refineWorkflow, retryWorkflow, sandboxWorkflow } from "@/workflows/prototypes";
import { orchestrateGeneration, orchestrateLessonCheck, orchestrateLessons, orchestratePairwise, orchestrateRecheck, orchestrateRefinement, orchestrateRetry, orchestrateSandbox } from "@/workflows/prototypes/orchestrate";

/**
 * Runs a Prototypes job (design.md, decision 5): as a Vercel Workflow run, or,
 * with FABRICATE_PROTOTYPES_RUNNER=inline, in-process after the response is
 * sent. Both run the same steps, and every step writes its progress to the
 * Prototypes store, which the pages poll.
 */

export type Job =
  | { readonly kind: "generate" | "refine"; readonly generationId: string }
  | { readonly kind: "retry"; readonly generationId: string; readonly variantId: string }
  | { readonly kind: "pairwise"; readonly reviewId: string }
  | { readonly kind: "recheck"; readonly recheckId: string }
  | { readonly kind: "lesson-check"; readonly checkId: string }
  | { readonly kind: "sandbox"; readonly runId: string }
  | { readonly kind: "lessons"; readonly workspaceId: string; readonly feedbackIds: readonly string[] };

export async function dispatch(job: Job): Promise<void> {
  const inline = getConfig().prototypes.runner === "inline";
  if (job.kind === "lessons") {
    if (inline) after(() => orchestrateLessons(job.workspaceId, job.feedbackIds));
    else await start(lessonsWorkflow, [job.workspaceId, [...job.feedbackIds]]);
    return;
  }
  if (job.kind === "sandbox") {
    if (inline) after(() => orchestrateSandbox(job.runId));
    else await start(sandboxWorkflow, [job.runId]);
    return;
  }
  if (job.kind === "lesson-check") {
    if (inline) after(() => orchestrateLessonCheck(job.checkId));
    else await start(lessonCheckWorkflow, [job.checkId]);
    return;
  }
  if (job.kind === "recheck") {
    if (inline) after(() => orchestrateRecheck(job.recheckId));
    else await start(recheckWorkflow, [job.recheckId]);
    return;
  }
  if (job.kind === "pairwise") {
    if (inline) after(() => orchestratePairwise(job.reviewId));
    else await start(pairwiseWorkflow, [job.reviewId]);
    return;
  }
  if (job.kind === "retry") {
    if (inline) after(() => orchestrateRetry(job.generationId, job.variantId));
    else await start(retryWorkflow, [job.generationId, job.variantId]);
    return;
  }
  const [workflow, sequence] = job.kind === "generate" ? [generateWorkflow, orchestrateGeneration] : [refineWorkflow, orchestrateRefinement];
  if (inline) after(() => sequence(job.generationId));
  else await start(workflow, [job.generationId]);
}
