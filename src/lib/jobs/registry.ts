import { COORDINATE_ASSESSMENT, FINALIZE_ASSESSMENT, PROCESS_TARGET, coordinateAssessment, finalizeAssessment, processTarget } from "@/lib/assessments/orchestration";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, getDb } from "@/lib/db/client";
import { FINALIZE_EVALUATION, finalizeEvaluation, runEvaluationRelease } from "@/lib/evaluations/jobs";
import { EVALUATE_RELEASE } from "@/lib/evaluations/start";
import { READ_DE_CONSOLE, runScheduledDeConsoleRead } from "@/lib/ownership/de-console-schedule";
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
  };
}
