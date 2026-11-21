import { COORDINATE_RUN, FINALIZE_RUN, PROCESS_TARGET, coordinateRun, finalizeRun, processTarget } from "@/lib/runs/orchestration";
import { BUILD_ENTRY, buildRequest, runBuild } from "@/lib/catalog/build";
import { CHECK_CATALOG, runCatalogCheck } from "@/lib/catalog/check";
import { TAKE_SNAPSHOTS, runSnapshots } from "@/lib/adoption/snapshots";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, getDb } from "@/lib/db/client";
import { FINALIZE_EVALUATION, finalizeEvaluation, runEvaluationRelease } from "@/lib/evaluations/jobs";
import { EVALUATE_RELEASE } from "@/lib/evaluations/start";
import { checkApplications } from "@/lib/applications/check";
import { runPreviewBuild } from "@/lib/previews/build";
import { runScreenshot } from "@/lib/previews/capture";
import { runPreparation } from "@/lib/previews/preparation";
import { BUILD_PREVIEW, PREPARE_PREVIEW } from "@/lib/previews/records";
import { CAPTURE_SCREENSHOT } from "@/lib/previews/screenshots";
import { CHECK_PROFILES, runScheduledProfileCheck } from "@/lib/profiling/check";
import { findRepository } from "@/lib/repositories/repository-records";
import { type BackgroundTrigger, REQUEST_SURVEY, surveyRepository } from "@/lib/surveys/background";
import { RUN_SURVEY, runSurvey } from "@/lib/surveys/run";
import type { KindLimits } from "./queue";
import type { HandlerRegistry } from "./worker";
import { sweepMockStorage } from "@/lib/mocks/storage";

/** Every job kind the worker runs, bound to +db+ and +config+. */
export function jobHandlers(db: Executor = getDb(), config: FrontendRegistryConfig = getConfig()): HandlerRegistry {
  // Job kinds and payloads are stored with each job, so they keep their stored names: a Run's payload key is `assessment`.
  return {
    [COORDINATE_RUN]: (payload) => coordinateRun(db, String(payload.assessment)),
    [PROCESS_TARGET]: async (payload, context) => void (await processTarget(db, String(payload.target), { config, signal: context.signal })),
    [FINALIZE_RUN]: (payload) => void finalizeRun(db, String(payload.assessment)),
    [EVALUATE_RELEASE]: async (payload) => void (await runEvaluationRelease(db, { evaluation: String(payload.evaluation), position: Number(payload.position) })),
    [FINALIZE_EVALUATION]: (payload) => void finalizeEvaluation(db, String(payload.evaluation)),
    // The profiling check, then the applications check for new commits on tracked branches, in the same slot (add-applications, design decision 3).
    [CHECK_PROFILES]: async (payload, context) => {
      const log = (message: string) => console.log(`[worker] ${message}`);
      runScheduledProfileCheck(db, config, { slot: String(payload.slot), log });
      const result = await checkApplications(db, config, { signal: context.signal, log });
      if (result.checked > 0) log(`applications check: ${result.checked} tracked and saved refs, ${result.started} builds started, ${result.unreadable} unreadable`);
      // Mock set bodies no set owns any more, and HAR drafts past their expiry (add-mock-sets, design decision 9).
      const swept = await sweepMockStorage(db, config).catch(() => 0);
      if (swept > 0) log(`mock set storage: removed ${swept} directories no set or draft owns`);
    },
    [RUN_SURVEY]: async (payload, context) => void (await runSurvey(db, String(payload.survey), { config, signal: context.signal })),
    // A deleted Repository isn't surveyed; a reference that can't be read fails the job, which records why.
    [REQUEST_SURVEY]: async (payload, context) => {
      const repository = findRepository(db, String(payload.repository));
      if (repository) await surveyRepository(db, repository, String(payload.trigger) as BackgroundTrigger, { config, signal: context.signal });
    },
    [TAKE_SNAPSHOTS]: (payload) => void runSnapshots(db, config, { slot: String(payload.slot), log: (message) => console.log(`[worker] ${message}`) }),
    [CHECK_CATALOG]: async (payload) =>
      void (await runCatalogCheck(db, config, { ...(typeof payload.slot === "string" && { slot: payload.slot }), ...(typeof payload.after === "string" && { after: payload.after }) }, { log: (message) => console.log(`[worker] ${message}`) })),
    // A build that fails stores nothing; its job's last error says why, and only an unreachable registry is retried.
    [BUILD_ENTRY]: async (payload, context) => void (await runBuild(db, buildRequest(payload), { config, jobId: context.job.id })),
    // Fails the preparation, rather than running it, while previews are off or the Repository isn't enrolled.
    [PREPARE_PREVIEW]: async (payload, context) => void (await runPreparation(db, { preparation: String(payload.preparation), requested: Number(payload.requested), afterSurvey: payload.afterSurvey === true }, { config, signal: context.signal })),
    // Each claim of the job is its own claim of the attempt (job attempts count claims), so only the latest can publish.
    [BUILD_PREVIEW]: async (payload, context) =>
      void (await runPreviewBuild(db, { preview: String(payload.preview), attempt: Number(payload.attempt) }, { config, signal: context.signal, claim: `${context.job.leaseOwner ?? "worker"}#${context.job.id}.${context.job.attempts}` })),
    // A capture that fails records the screenshot as unavailable rather than failing the job; only a stopped worker's is run again.
    [CAPTURE_SCREENSHOT]: async (payload, context) => void (await runScreenshot(db, { preview: String(payload.preview), requested: Number(payload.requested) }, { config, signal: context.signal })),
  };
}

/**
 * Job kinds that hold background work back while they're queued or running:
 * Catalog builds, so background surveys, such as every Repository's after a
 * Surveyor upgrade, run with the entries being built rather than before them.
 */
export const HOLD_BACKGROUND: readonly string[] = [BUILD_ENTRY];

/** Job kinds with their own limit on how many run at once, apart from the worker's concurrency (design decision 8): preview builds, and screenshots, one browser at a time. */
export function jobLimits(config: FrontendRegistryConfig = getConfig()): KindLimits {
  return { [BUILD_PREVIEW]: config.previews.concurrency, [CAPTURE_SCREENSHOT]: 1 };
}
