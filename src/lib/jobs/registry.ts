import { type Executor, getDb } from "@/lib/db/client";
import { runEvaluationRelease } from "@/lib/evaluations/jobs";
import { EVALUATE_RELEASE } from "@/lib/evaluations/start";
import type { HandlerRegistry } from "./worker";

/**
 * Every job kind the worker runs, bound to +db+. Handlers are registered here
 * as the assessment and evaluation pipelines are built.
 */
export function jobHandlers(db: Executor = getDb()): HandlerRegistry {
  return {
    [EVALUATE_RELEASE]: async (payload) => void (await runEvaluationRelease(db, { evaluation: String(payload.evaluation), position: Number(payload.position) })),
  };
}
