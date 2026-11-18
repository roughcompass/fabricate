import { and, asc, desc, eq, lte, or, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { JOB_PRIORITIES, jobs } from "@/lib/db/schema";
import { type JsonObject, dump, parseCanonical } from "@repo-facts/contract";
import { redact } from "@/lib/git/redact";

/**
 * A durable job queue in the application database.
 *
 * Enqueueing is an insert in the caller's transaction, so a job becomes
 * visible only when the records it depends on commit, and disappears if they
 * roll back. Workers claim jobs under a lease inside an immediate
 * transaction; a job whose lease expires is claimable again. A repeated
 * idempotency key never creates a second job. Background jobs are claimed
 * only when no normal job is runnable.
 */

export type Job = typeof jobs.$inferSelect;

export const DEFAULT_LEASE_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;

export interface EnqueueOptions {
  kind: string;
  payload: JsonObject;
  idempotencyKey: string;
  runAfter?: Date;
  maxAttempts?: number;
  /** JOB_PRIORITIES.normal unless given. */
  priority?: number;
}

/** Adds a job unless one with the same idempotency key exists; returns the job either way. */
export function enqueue(db: Executor, options: EnqueueOptions): Job {
  const now = new Date();
  const inserted = db
    .insert(jobs)
    .values({
      kind: options.kind,
      payload: dump(options.payload),
      idempotencyKey: options.idempotencyKey,
      maxAttempts: options.maxAttempts ?? 3,
      priority: options.priority ?? JOB_PRIORITIES.normal,
      runAfter: options.runAfter ?? now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning()
    .get();
  return inserted ?? db.select().from(jobs).where(eq(jobs.idempotencyKey, options.idempotencyKey)).get()!;
}

export function jobPayload(job: Job): JsonObject {
  return parseCanonical(job.payload) as JsonObject;
}

export interface ClaimOptions {
  workerId: string;
  now?: Date;
  leaseMs?: number;
}

/**
 * Claims the oldest runnable job of the highest priority: a queued job whose
 * time has come, or a running job whose lease expired. A job that has used every attempt is
 * failed instead of claimed.
 */
export function claimNext(db: Executor, options: ClaimOptions): Job | undefined {
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;

  return immediate(db, (tx) => {
    for (;;) {
      const candidate = tx
        .select()
        .from(jobs)
        .where(or(and(eq(jobs.state, "queued"), lte(jobs.runAfter, now)), and(eq(jobs.state, "running"), lte(jobs.leaseExpiresAt, now))))
        .orderBy(desc(jobs.priority), asc(jobs.runAfter), asc(jobs.id))
        .limit(1)
        .get();
      if (!candidate) return undefined;

      if (candidate.attempts >= candidate.maxAttempts) {
        tx.update(jobs)
          .set({
            state: "failed",
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: candidate.lastError ?? "Abandoned: the worker holding this job stopped before it finished",
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(jobs.id, candidate.id))
          .run();
        continue;
      }

      return tx
        .update(jobs)
        .set({ state: "running", attempts: candidate.attempts + 1, leaseOwner: options.workerId, leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now })
        .where(eq(jobs.id, candidate.id))
        .returning()
        .get();
    }
  });
}

/** Extends a lease the worker still holds. Returns false if it was lost. */
export function renewLease(db: Executor, job: Job, workerId: string, options: { now?: Date; leaseMs?: number } = {}): boolean {
  const now = options.now ?? new Date();
  const result = db
    .update(jobs)
    .set({ leaseExpiresAt: new Date(now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS)), updatedAt: now })
    .where(and(eq(jobs.id, job.id), eq(jobs.state, "running"), eq(jobs.leaseOwner, workerId)))
    .run();
  return result.changes === 1;
}

/** Marks a job the worker still holds as succeeded. Returns false if the lease was lost. */
export function succeed(db: Executor, job: Job, workerId: string, now = new Date()): boolean {
  const result = db
    .update(jobs)
    .set({ state: "succeeded", leaseOwner: null, leaseExpiresAt: null, lastError: null, finishedAt: now, updatedAt: now })
    .where(and(eq(jobs.id, job.id), eq(jobs.state, "running"), eq(jobs.leaseOwner, workerId)))
    .run();
  return result.changes === 1;
}

/**
 * Records a failure. A retryable failure with attempts left returns the job
 * to the queue after an exponential backoff; otherwise the job fails.
 */
export function fail(db: Executor, job: Job, workerId: string, error: unknown, options: { retryable?: boolean; now?: Date } = {}): boolean {
  const now = options.now ?? new Date();
  const message = redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  const retry = (options.retryable ?? true) && job.attempts < job.maxAttempts;
  const backoff = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.max(0, job.attempts - 1));

  const result = db
    .update(jobs)
    .set(
      retry
        ? { state: "queued", runAfter: new Date(now.getTime() + backoff), leaseOwner: null, leaseExpiresAt: null, lastError: message, updatedAt: now }
        : { state: "failed", leaseOwner: null, leaseExpiresAt: null, lastError: message, finishedAt: now, updatedAt: now },
    )
    .where(and(eq(jobs.id, job.id), eq(jobs.state, "running"), eq(jobs.leaseOwner, workerId)))
    .run();
  return result.changes === 1;
}

export function jobCounts(db: Executor): Record<string, number> {
  const rows = db.select({ state: jobs.state, count: sql<number>`count(*)` }).from(jobs).groupBy(jobs.state).all();
  return Object.fromEntries(rows.map((row) => [row.state, row.count]));
}
