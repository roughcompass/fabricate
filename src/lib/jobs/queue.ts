import { and, asc, desc, eq, gt, inArray, lte, notInArray, or, sql } from "drizzle-orm";
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
 * only when no normal job is runnable. A kind can be limited to a number of
 * jobs running at once, so long jobs of one kind can't hold every slot.
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
  /** When a job with the key is still queued at a lower priority, raise it to +priority+, as a Run joining a background survey does. */
  raisePriority?: boolean;
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
  if (inserted) return inserted;
  const existing = db.select().from(jobs).where(eq(jobs.idempotencyKey, options.idempotencyKey)).get()!;
  const priority = options.priority ?? JOB_PRIORITIES.normal;
  if (!options.raisePriority || existing.state !== "queued" || existing.priority >= priority) return existing;
  return db.update(jobs).set({ priority, updatedAt: now }).where(eq(jobs.id, existing.id)).returning().get();
}

export function jobPayload(job: Job): JsonObject {
  return parseCanonical(job.payload) as JsonObject;
}

/** The most jobs of a kind that may run at once, across every worker sharing the database. */
export type KindLimits = Readonly<Record<string, number>>;

export interface ClaimOptions {
  workerId: string;
  now?: Date;
  leaseMs?: number;
  limits?: KindLimits;
}

/**
 * Claims the oldest runnable job of the highest priority: a queued job whose
 * time has come, or a running job whose lease expired. A job that has used every attempt is
 * failed instead of claimed. A kind with a limit is skipped while that many
 * of its jobs hold live leases, so other kinds keep running.
 */
export function claimNext(db: Executor, options: ClaimOptions): Job | undefined {
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;

  return immediate(db, (tx) => {
    const saturated = saturatedKinds(tx, options.limits ?? {}, now);
    for (;;) {
      const candidate = tx
        .select()
        .from(jobs)
        .where(
          and(
            or(and(eq(jobs.state, "queued"), lte(jobs.runAfter, now)), and(eq(jobs.state, "running"), lte(jobs.leaseExpiresAt, now))),
            saturated.length ? notInArray(jobs.kind, saturated) : undefined,
          ),
        )
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

/** The limited kinds with as many jobs running under live leases as their limit allows. An expired lease no longer counts. */
function saturatedKinds(db: Executor, limits: KindLimits, now: Date): string[] {
  const kinds = Object.keys(limits);
  if (kinds.length === 0) return [];
  const running = db
    .select({ kind: jobs.kind, count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.state, "running"), gt(jobs.leaseExpiresAt, now), inArray(jobs.kind, kinds)))
    .groupBy(jobs.kind)
    .all();
  return running.filter((row) => row.count >= limits[row.kind]!).map((row) => row.kind);
}

/** Writes +values+ to a running job only while +workerId+ still holds its lease. Returns false if the lease was lost. */
function updateHeld(db: Executor, job: Job, workerId: string, values: Partial<typeof jobs.$inferInsert>): boolean {
  return db.update(jobs).set(values).where(and(eq(jobs.id, job.id), eq(jobs.state, "running"), eq(jobs.leaseOwner, workerId))).run().changes === 1;
}

/** Extends a lease the worker still holds. Returns false if it was lost. */
export function renewLease(db: Executor, job: Job, workerId: string, options: { now?: Date; leaseMs?: number } = {}): boolean {
  const now = options.now ?? new Date();
  return updateHeld(db, job, workerId, { leaseExpiresAt: new Date(now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS)), updatedAt: now });
}

/** Marks a job the worker still holds as succeeded. Returns false if the lease was lost. */
export function succeed(db: Executor, job: Job, workerId: string, now = new Date()): boolean {
  return updateHeld(db, job, workerId, { state: "succeeded", leaseOwner: null, leaseExpiresAt: null, lastError: null, finishedAt: now, updatedAt: now });
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

  return updateHeld(
    db,
    job,
    workerId,
    retry
      ? { state: "queued", runAfter: new Date(now.getTime() + backoff), leaseOwner: null, leaseExpiresAt: null, lastError: message, updatedAt: now }
      : { state: "failed", leaseOwner: null, leaseExpiresAt: null, lastError: message, finishedAt: now, updatedAt: now },
  );
}
