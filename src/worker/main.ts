// Fabricate worker: runs acquisition, analysis, evaluation, DE Console, and onboarding read jobs outside
// the web server. Started with `npm run dev:worker` or `npm run worker`.
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { jobHandlers } from "@/lib/jobs/registry";
import { Worker } from "@/lib/jobs/worker";
import { scheduleOnboardingRefresh } from "@/lib/onboarding/external/refresh";
import { scheduleDeConsoleReads } from "@/lib/ownership/de-console-schedule";
import { verifyStartup } from "@/lib/startup";

async function main(): Promise<void> {
  await verifyStartup("worker");

  const worker = new Worker({
    db: getDb(),
    handlers: jobHandlers(),
    concurrency: getConfig().workerConcurrency,
    log: (message) => console.log(`[worker] ${message}`),
  });
  // The DE Console read reschedules itself; this starts it, at most once per slot across workers.
  scheduleDeConsoleReads(getDb(), getConfig());
  // So do onboarding's reads of Studio and CDaaS, when either is configured.
  scheduleOnboardingRefresh(getDb(), getConfig());
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
