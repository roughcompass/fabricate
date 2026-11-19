// Fabricate worker: runs acquisition, analysis, evaluation, DE Console read, profiling check, and preview jobs outside
// the web server. Started with `npm run dev:worker` or `npm run worker`.
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { jobHandlers, jobLimits } from "@/lib/jobs/registry";
import { Worker } from "@/lib/jobs/worker";
import { scheduleDeConsoleReads } from "@/lib/ownership/de-console-schedule";
import { scheduleProfileChecks } from "@/lib/profiling/check";
import { verifyStartup } from "@/lib/startup";

async function main(): Promise<void> {
  await verifyStartup("worker");

  const worker = new Worker({
    db: getDb(),
    handlers: jobHandlers(),
    concurrency: getConfig().workerConcurrency,
    // Preview builds run at most previews.concurrency at once, across workers, so they can't hold every slot.
    limits: jobLimits(),
    log: (message) => console.log(`[worker] ${message}`),
  });
  // The DE Console read reschedules itself; this starts it, at most once per slot across workers.
  scheduleDeConsoleReads(getDb(), getConfig());
  // So does the profiling check, which also queues the first version of every repository without one.
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
  console.error("[worker] fatal", error);
  process.exit(1);
});
