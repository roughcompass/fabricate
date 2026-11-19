import { COORDINATE_RUN, FINALIZE_RUN, PROCESS_TARGET, coordinateRun, finalizeRun, processTarget } from "@/lib/runs/orchestration";
import { BUILD_ENTRY, buildRequest, runBuild } from "@/lib/catalog/build";
import { CHECK_CATALOG, runCatalogCheck } from "@/lib/catalog/check";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, getDb } from "@/lib/db/client";
import { FINALIZE_EVALUATION, finalizeEvaluation, runEvaluationRelease } from "@/lib/evaluations/jobs";
import { EVALUATE_RELEASE } from "@/lib/evaluations/start";
import { runPreviewBuild } from "@/lib/previews/build";
import { runPreparation } from "@/lib/previews/preparation";
import { BUILD_PREVIEW, PREPARE_PREVIEW } from "@/lib/previews/records";
import { CHECK_PROFILES, runScheduledProfileCheck } from "@/lib/profiling/check";
import { findRepository } from "@/lib/repositories/repository-records";
import { type BackgroundTrigger, REQUEST_SURVEY, surveyRepository } from "@/lib/surveys/background";
import { RUN_SURVEY, runSurvey } from "@/lib/surveys/run";
import type { KindLimits } from "./queue";
import type { HandlerRegistry } from "./worker";

/** Every job kind the worker runs, bound to +db+ and +config+. */
export function jobHandlers(db: Executor = getDb(), config: FrontendRegistryConfig = getConfig()): HandlerRegistry {
  // Job kinds and payloads are stored with each job, so they keep their stored names: a Run's payload key is `assessment`.
  return {
    [COORDINATE_RUN]: (payload) => coordinateRun(db, String(payload.assessment)),
    [PROCESS_TARGET]: async (payload, context) => void (await processTarget(db, String(payload.target), { config, signal: context.signal })),
    [FINALIZE_RUN]: (payload) => void finalizeRun(db, String(payload.assessment)),
    [EVALUATE_RELEASE]: async (payload) => void (await runEvaluationRelease(db, { evaluation: String(payload.evaluation), position: Number(payload.position) })),
    [FINALIZE_EVALUATION]: (payload) => void finalizeEvaluation(db, String(payload.evaluation)),
    [CHECK_PROFILES]: (payload) => void runScheduledProfileCheck(db, config, { slot: String(payload.slot), log: (message) => console.log(`[worker] ${message}`) }),
    [RUN_SURVEY]: async (payload, context) => void (await runSurvey(db, String(payload.survey), { config, signal: context.signal })),
    // A deleted Repository isn't surveyed; a reference that can't be read fails the job, which records why.
    [REQUEST_SURVEY]: async (payload, context) => {
      const repository = findRepository(db, String(payload.repository));
      if (repository) await surveyRepository(db, repository, String(payload.trigger) as BackgroundTrigger, { config, signal: context.signal });
    },
    [CHECK_CATALOG]: async (payload) =>
      void (await runCatalogCheck(db, config, { ...(typeof payload.slot === "string" && { slot: payload.slot }), ...(typeof payload.after === "string" && { after: payload.after }) }, { log: (message) => console.log(`[worker] ${message}`) })),
    // A build that fails stores nothing; its job's last error says why, and only an unreachable registry is retried.
    [BUILD_ENTRY]: async (payload, context) => void (await runBuild(db, buildRequest(payload), { config, jobId: context.job.id })),
    // Fails the preparation, rather than running it, while previews are off or the Repository isn't enrolled.
    [PREPARE_PREVIEW]: async (payload, context) => void (await runPreparation(db, { preparation: String(payload.preparation), requested: Number(payload.requested), afterSurvey: payload.afterSurvey === true }, { config, signal: context.signal })),
    // Each claim of the job is its own claim of the attempt (job attempts count claims), so only the latest can publish.
    [BUILD_PREVIEW]: async (payload, context) =>
      void (await runPreviewBuild(db, { preview: String(payload.preview), attempt: Number(payload.attempt) }, { config, signal: context.signal, claim: `${context.job.leaseOwner ?? "worker"}#${context.job.id}.${context.job.attempts}` })),
  };
}

/**
 * Job kinds that hold background work back while they're queued or running:
 * Catalog builds, so background surveys, such as every Repository's after a
 * Surveyor upgrade, run with the entries being built rather than before them.
 */
export const HOLD_BACKGROUND: readonly string[] = [BUILD_ENTRY];

/** Job kinds with their own limit on how many run at once, apart from the worker's concurrency (design decision 8). */
export function jobLimits(config: FrontendRegistryConfig = getConfig()): KindLimits {
  return { [BUILD_PREVIEW]: config.previews.concurrency };
}
