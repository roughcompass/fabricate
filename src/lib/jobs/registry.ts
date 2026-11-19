import { COORDINATE_ASSESSMENT, FINALIZE_ASSESSMENT, PROCESS_TARGET, coordinateAssessment, finalizeAssessment, processTarget } from "@/lib/assessments/orchestration";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, getDb } from "@/lib/db/client";
import { FINALIZE_EVALUATION, finalizeEvaluation, runEvaluationRelease } from "@/lib/evaluations/jobs";
import { EVALUATE_RELEASE } from "@/lib/evaluations/start";
import { READ_DE_CONSOLE, runScheduledDeConsoleRead } from "@/lib/ownership/de-console-schedule";
import { runPreviewBuild } from "@/lib/previews/build";
import { runPreparation } from "@/lib/previews/preparation";
import { BUILD_PREVIEW, PREPARE_PREVIEW } from "@/lib/previews/records";
import { CHECK_PROFILES, runScheduledProfileCheck } from "@/lib/profiling/check";
import type { KindLimits } from "./queue";
import type { HandlerRegistry } from "./worker";

/** Every job kind the worker runs, bound to +db+ and +config+. */
export function jobHandlers(db: Executor = getDb(), config: FabricateConfig = getConfig()): HandlerRegistry {
  return {
    [COORDINATE_ASSESSMENT]: (payload) => coordinateAssessment(db, String(payload.assessment)),
    [PROCESS_TARGET]: async (payload, context) => void (await processTarget(db, String(payload.target), { config, signal: context.signal, holder: `${context.job.leaseOwner ?? "worker"}:${String(payload.target)}` })),
    [FINALIZE_ASSESSMENT]: (payload) => void finalizeAssessment(db, String(payload.assessment)),
    [EVALUATE_RELEASE]: async (payload) => void (await runEvaluationRelease(db, { evaluation: String(payload.evaluation), position: Number(payload.position) })),
    [FINALIZE_EVALUATION]: (payload) => void finalizeEvaluation(db, String(payload.evaluation)),
    [READ_DE_CONSOLE]: (_payload, context) => runScheduledDeConsoleRead(db, config, { signal: context.signal }),
    [CHECK_PROFILES]: async (_payload, context) => void (await runScheduledProfileCheck(db, config, { signal: context.signal, log: (message) => console.log(`[worker] ${message}`) })),
    // Fails the preparation, rather than running it, while previews are off or the Repository isn't enrolled.
    [PREPARE_PREVIEW]: async (payload, context) => void (await runPreparation(db, { preparation: String(payload.preparation), requested: Number(payload.requested) }, { config, signal: context.signal })),
    // Each claim of the job is its own claim of the attempt (job attempts count claims), so only the latest can publish.
    [BUILD_PREVIEW]: async (payload, context) =>
      void (await runPreviewBuild(db, { preview: String(payload.preview), attempt: Number(payload.attempt) }, { config, signal: context.signal, claim: `${context.job.leaseOwner ?? "worker"}#${context.job.id}.${context.job.attempts}` })),
  };
}

/** Job kinds with their own limit on how many run at once, apart from the worker's concurrency (design decision 8). */
export function jobLimits(config: FabricateConfig = getConfig()): KindLimits {
  return { [BUILD_PREVIEW]: config.previews.concurrency };
}
