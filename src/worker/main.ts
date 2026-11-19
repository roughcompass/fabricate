// Frontend Registry worker: runs acquisition, analysis, evaluation, profiling check, Catalog build, and preview jobs outside
// the web server. Started with `npm run dev:worker` or `npm run worker`.
import path from "node:path";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { HOLD_BACKGROUND, jobHandlers, jobLimits } from "@/lib/jobs/registry";
import { Worker } from "@/lib/jobs/worker";
import { scheduleCatalogChecks } from "@/lib/catalog/check";
import { scheduleProfileChecks } from "@/lib/profiling/check";
import { verifyStartup } from "@/lib/startup";
import { WorkerLockError, claimWorkerLock } from "./lock";

async function main(): Promise<void> {
  await verifyStartup("worker");
  // One worker per database: its lock file sits beside the database.
  const release = claimWorkerLock(path.join(path.dirname(getConfig().database), "worker.lock"));
  process.once("exit", release);

  const worker = new Worker({
    db: getDb(),
    handlers: jobHandlers(),
    concurrency: getConfig().workerConcurrency,
    // Preview builds run at most previews.concurrency at once, across workers, so they can't hold every slot.
    limits: jobLimits(),
    // Background surveys wait for Catalog builds, so they compare against the entries being built.
    holdBackground: HOLD_BACKGROUND,
    log: (message) => console.log(`[worker] ${message}`),
  });
  // The Catalog check runs first, so the entries surveys need are queued before the profiling check queues surveys.
  scheduleCatalogChecks(getDb());
  // The profiling check reschedules itself; this starts it, and it also queues the first version of every repository without one.
  scheduleProfileChecks(getDb(), getConfig());
  worker.start();
  console.log(`[worker] ready as ${worker.workerId}`);

  await new Promise<void>((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => resolve());
  });
  console.log("[worker] stopping; waiting for running jobs");
  await worker.stop();
  console.log("[worker] stopped");
}

main().catch((error: unknown) => {
  if (error instanceof WorkerLockError) console.error(`[worker] ${error.message}`);
  else console.error("[worker] fatal", error);
  process.exit(1);
});
