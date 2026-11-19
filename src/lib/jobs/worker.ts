import crypto from "node:crypto";
import os from "node:os";
import type { Executor } from "@/lib/db/client";
import type { JsonObject } from "@repo-facts/contract";
import { DEFAULT_LEASE_MS, type Job, type KindLimits, claimNext, fail, jobPayload, renewLease, succeed } from "./queue";

/**
 * Runs queued jobs with bounded concurrency, overall and per limited kind.
 * While a handler runs, its lease is renewed automatically; if the lease is
 * lost, the handler's signal aborts so it can stop before another worker
 * takes over.
 */

interface JobContext {
  job: Job;
  /** Aborts when the lease is lost or the worker stops. */
  signal: AbortSignal;
}

type JobHandler = (payload: JsonObject, context: JobContext) => Promise<void> | void;
export type HandlerRegistry = Readonly<Record<string, JobHandler>>;

/** Thrown by a handler whose failure retrying cannot fix. */
export class NonRetryableError extends Error {
  override name = "NonRetryableError";
}

export type JobResult = "succeeded" | "retrying" | "failed" | "lease_lost";

export interface RunOptions {
  workerId: string;
  leaseMs?: number;
  /** Aborts every running handler, for example when the worker is stopping. */
  signal?: AbortSignal;
}

export async function runJob(db: Executor, job: Job, handlers: HandlerRegistry, options: RunOptions): Promise<JobResult> {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const handler = handlers[job.kind];
  if (!handler) {
    fail(db, job, options.workerId, new NonRetryableError(`No handler is registered for ${job.kind} jobs`), { retryable: false });
    return "failed";
  }

  const controller = new AbortController();
  const onStop = () => controller.abort(new Error("The worker is stopping"));
  options.signal?.addEventListener("abort", onStop, { once: true });
  const heartbeat = setInterval(() => {
    if (!renewLease(db, job, options.workerId, { leaseMs })) controller.abort(new Error("The job's lease was lost"));
  }, Math.max(50, Math.floor(leaseMs / 3)));

  try {
    await handler(jobPayload(job), { job, signal: controller.signal });
    return succeed(db, job, options.workerId) ? "succeeded" : "lease_lost";
  } catch (error) {
    const retryable = !(error instanceof NonRetryableError);
    if (!fail(db, job, options.workerId, error, { retryable })) return "lease_lost";
    return retryable && job.attempts < job.maxAttempts ? "retrying" : "failed";
  } finally {
    clearInterval(heartbeat);
    options.signal?.removeEventListener("abort", onStop);
  }
}

/**
 * The inline test queue: runs claimable jobs one at a time, oldest first,
 * until none remain or +limit+ jobs have run. Deterministic because it never
 * runs two jobs at once. Returns the processed jobs in order.
 * @public Tests and end-to-end runs drain the queue through this.
 */
export async function drainJobs(db: Executor, handlers: HandlerRegistry, options: { limit?: number; now?: () => Date } = {}): Promise<Job[]> {
  const processed: Job[] = [];
  const limit = options.limit ?? 1_000;
  while (processed.length < limit) {
    const job = claimNext(db, { workerId: "inline", now: options.now?.() });
    if (!job) break;
    await runJob(db, job, handlers, { workerId: "inline" });
    processed.push(job);
  }
  return processed;
}

export interface WorkerOptions {
  db: Executor;
  handlers: HandlerRegistry;
  concurrency: number;
  /** Per-kind limits on jobs running at once, enforced where jobs are claimed. */
  limits?: KindLimits;
  /** Kinds whose queued or running jobs hold background work back. */
  holdBackground?: readonly string[];
  pollIntervalMs?: number;
  leaseMs?: number;
  workerId?: string;
  log?: (message: string) => void;
}

export class Worker {
  readonly workerId: string;
  private readonly active = new Set<Promise<void>>();
  private readonly stopping = new AbortController();
  private wake: (() => void) | null = null;
  private loop: Promise<void> | null = null;

  constructor(private readonly options: WorkerOptions) {
    this.workerId = options.workerId ?? `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
  }

  get runningCount(): number {
    return this.active.size;
  }

  start(): void {
    this.loop ??= this.run();
  }

  /** Stops claiming new jobs and waits for running ones to finish. */
  async stop(): Promise<void> {
    this.stopping.abort();
    this.wake?.();
    await this.loop;
    await Promise.allSettled([...this.active]);
  }

  private async run(): Promise<void> {
    const { db, handlers, concurrency, leaseMs, limits, holdBackground } = this.options;
    const pollIntervalMs = this.options.pollIntervalMs ?? 1_000;

    while (!this.stopping.signal.aborted) {
      let claimed = false;
      while (this.active.size < concurrency && !this.stopping.signal.aborted) {
        const job = claimNext(db, { workerId: this.workerId, leaseMs, limits, holdBackground });
        if (!job) break;
        claimed = true;
        const running = runJob(db, job, handlers, { workerId: this.workerId, leaseMs })
          .then((result) => this.options.log?.(`${job.kind} #${job.id}: ${result}`))
          .catch((error: unknown) => this.options.log?.(`${job.kind} #${job.id}: worker error ${String(error)}`))
          .finally(() => {
            this.active.delete(running);
            this.wake?.();
          });
        this.active.add(running);
      }
      if (!claimed || this.active.size >= concurrency) await this.sleep(pollIntervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = () => {
        this.wake = null;
        done();
      };
    });
  }
}
