import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, immediate } from "@/lib/db/client";
import { JOB_PRIORITIES, jobs } from "@/lib/db/schema";
import { claimNext, enqueue, fail, renewLease, succeed } from "@/lib/jobs/queue";
import { jobCounts } from "../support/jobs";
import { NonRetryableError, Worker, drainJobs, runJob } from "@/lib/jobs/worker";
import { PROCESS_TARGET } from "@/lib/assessments/orchestration";
import { getConfig, withOverrides } from "@/lib/config";
import { jobLimits } from "@/lib/jobs/registry";
import { BUILD_PREVIEW } from "@/lib/previews/records";
import type { JsonObject } from "@repo-facts/contract";
import { createTestDb, rawRun, withSharedFileDb } from "../support/db";

const job = (key: string, extra: Partial<Parameters<typeof enqueue>[1]> = {}) => ({ kind: "test.work", payload: { key }, idempotencyKey: `test.work:${key}`, ...extra });
const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms);
const reload = (db: Db, id: number) => db.select().from(jobs).where(eq(jobs.id, id)).get()!;

describe("job queue", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  describe("transactional enqueue", () => {
    it("makes a job visible to other connections only when its transaction commits", () =>
      withSharedFileDb((writer, reader) => {
        const visible = () => reader.select().from(jobs).all().length;

        immediate(writer, (tx) => {
          enqueue(tx, job("a"));
          expect(visible()).toBe(0);
        });
        expect(visible()).toBe(1);
      }));

    it("discards a job when its transaction rolls back", () => {
      expect(() =>
        immediate(db, (tx) => {
          enqueue(tx, job("rolled-back"));
          throw new Error("scope resolution failed");
        }),
      ).toThrow("scope resolution failed");
      expect(db.select().from(jobs).all()).toEqual([]);
    });
  });

  it("suppresses duplicates by idempotency key, even after the first job finished", () => {
    const first = enqueue(db, job("once"));
    expect(enqueue(db, job("once")).id).toBe(first.id);

    const claimed = claimNext(db, { workerId: "w" })!;
    succeed(db, claimed, "w");
    expect(enqueue(db, job("once")).state).toBe("succeeded");
    expect(db.select().from(jobs).all()).toHaveLength(1);
  });

  it("claims the oldest due job first and waits for scheduled jobs", () => {
    enqueue(db, job("later", { runAfter: at(5_000) }));
    enqueue(db, job("first", { runAfter: at(0) }));
    enqueue(db, job("second", { runAfter: at(0) }));

    expect(claimNext(db, { workerId: "w", now: at(10) })?.idempotencyKey).toBe("test.work:first");
    expect(claimNext(db, { workerId: "w", now: at(10) })?.idempotencyKey).toBe("test.work:second");
    expect(claimNext(db, { workerId: "w", now: at(10) })).toBeUndefined();
    expect(claimNext(db, { workerId: "w", now: at(5_000) })?.idempotencyKey).toBe("test.work:later");
  });

  it("claims background jobs only when no normal job is due, however long they have waited", () => {
    enqueue(db, job("profile", { runAfter: at(0), priority: JOB_PRIORITIES.background }));
    enqueue(db, job("assessment", { runAfter: at(500) }));
    enqueue(db, job("scheduled", { runAfter: at(5_000) }));

    expect(claimNext(db, { workerId: "w", now: at(1_000) })?.idempotencyKey).toBe("test.work:assessment");
    expect(claimNext(db, { workerId: "w", now: at(1_000) })?.idempotencyKey).toBe("test.work:profile");
    expect(claimNext(db, { workerId: "w", now: at(1_000) })).toBeUndefined();
    expect(reload(db, 1).priority).toBe(JOB_PRIORITIES.background);
  });

  it("claims a background job joined at normal priority ahead of other background work", () => {
    enqueue(db, job("older", { runAfter: at(0), priority: JOB_PRIORITIES.background }));
    const joined = enqueue(db, job("joined", { runAfter: at(500), priority: JOB_PRIORITIES.background }));

    // Joining without raising leaves the job as it is.
    expect(enqueue(db, job("joined")).priority).toBe(JOB_PRIORITIES.background);
    expect(enqueue(db, job("joined", { raisePriority: true }))).toMatchObject({ id: joined.id, priority: JOB_PRIORITIES.normal });
    // A later background request never lowers it again.
    expect(enqueue(db, job("joined", { priority: JOB_PRIORITIES.background, raisePriority: true })).priority).toBe(JOB_PRIORITIES.normal);

    expect(claimNext(db, { workerId: "w", now: at(1_000) })?.idempotencyKey).toBe("test.work:joined");
    expect(claimNext(db, { workerId: "w", now: at(1_000) })?.idempotencyKey).toBe("test.work:older");
  });

  it("raises only a job still waiting in the queue", () => {
    enqueue(db, job("started", { priority: JOB_PRIORITIES.background }));
    const claimed = claimNext(db, { workerId: "w" })!;

    expect(enqueue(db, job("started", { raisePriority: true }))).toMatchObject({ id: claimed.id, state: "running", priority: JOB_PRIORITIES.background });
  });

  it("resumes a job whose lease expired and ignores the stale worker", () => {
    enqueue(db, job("leased", { runAfter: at(0) }));
    const first = claimNext(db, { workerId: "w1", now: at(0), leaseMs: 1_000 })!;

    expect(claimNext(db, { workerId: "w2", now: at(500) })).toBeUndefined();
    const resumed = claimNext(db, { workerId: "w2", now: at(1_000), leaseMs: 1_000 })!;
    expect(resumed).toMatchObject({ id: first.id, attempts: 2, leaseOwner: "w2" });
    expect(renewLease(db, first, "w1")).toBe(false);
    expect(succeed(db, first, "w1")).toBe(false);
    expect(succeed(db, resumed, "w2")).toBe(true);
  });

  it("fails an abandoned job that has used every attempt", () => {
    const queued = enqueue(db, job("abandoned", { runAfter: at(0), maxAttempts: 1 }));
    claimNext(db, { workerId: "w1", now: at(0), leaseMs: 100 });

    expect(claimNext(db, { workerId: "w2", now: at(200) })).toBeUndefined();
    expect(reload(db, queued.id)).toMatchObject({ state: "failed", lastError: expect.stringContaining("Abandoned") });
  });

  it("retries with backoff, redacts the error, and fails after the last attempt", async () => {
    const queued = enqueue(db, job("flaky", { maxAttempts: 2 }));
    const handlers = {
      "test.work": () => {
        throw new Error("fetch https://user:hunter2@git.example.com failed");
      },
    };

    expect(await runJob(db, claimNext(db, { workerId: "w" })!, handlers, { workerId: "w" })).toBe("retrying");
    const retried = reload(db, queued.id);
    expect(retried.state).toBe("queued");
    expect(retried.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(retried.lastError).not.toContain("hunter2");

    const again = claimNext(db, { workerId: "w", now: new Date(Date.now() + 60_000) })!;
    expect(await runJob(db, again, handlers, { workerId: "w" })).toBe("failed");
    expect(reload(db, queued.id)).toMatchObject({ state: "failed", attempts: 2 });
  });

  it("fails immediately on a non-retryable error or an unknown job kind", async () => {
    const permanent = enqueue(db, job("permanent"));
    const unknown = enqueue(db, { kind: "test.unknown", payload: {}, idempotencyKey: "unknown" });
    const handlers = {
      "test.work": () => {
        throw new NonRetryableError("the source was deleted");
      },
    };

    await drainJobs(db, handlers);
    expect(reload(db, permanent.id)).toMatchObject({ state: "failed", attempts: 1, lastError: "NonRetryableError: the source was deleted" });
    expect(reload(db, unknown.id)).toMatchObject({ state: "failed", lastError: expect.stringContaining("No handler is registered") });
  });

  it("drains jobs deterministically, including jobs enqueued by handlers", async () => {
    const order: string[] = [];
    enqueue(db, job("a"));
    enqueue(db, job("b"));
    const handlers = {
      "test.work": (payload: Record<string, unknown>) => {
        order.push(String(payload.key));
        if (payload.key === "a") enqueue(db, job("a-follow-up"));
      },
    };

    await drainJobs(db, handlers);
    expect(order).toEqual(["a", "b", "a-follow-up"]);
    expect(jobCounts(db)).toEqual({ succeeded: 3 });
  });

  it("skips a kind while its limit of jobs hold live leases, and counts an expired lease as free", () => {
    const limits = { "test.limited": 1 };
    const first = enqueue(db, job("first", { kind: "test.limited", idempotencyKey: "limited:first" }));
    enqueue(db, job("second", { kind: "test.limited", idempotencyKey: "limited:second" }));
    enqueue(db, job("other"));
    const later = (ms: number) => new Date(Date.now() + ms);

    expect(claimNext(db, { workerId: "w", now: later(1), limits })!.id).toBe(first.id);
    // The second limited job waits, though it's older than the other kind's job.
    expect(claimNext(db, { workerId: "w", now: later(2), limits })!.kind).toBe("test.work");
    expect(claimNext(db, { workerId: "w", now: later(3), limits })).toBeUndefined();
    // Without limits, it's claimable.
    expect(claimNext(db, { workerId: "w", now: later(4) })!.kind).toBe("test.limited");

    // Once the first job's lease expires it no longer counts, and it's claimable again itself.
    rawRun(db, "update jobs set state = 'queued', lease_owner = null, lease_expires_at = null, attempts = 0 where idempotency_key = 'limited:second'");
    expect(claimNext(db, { workerId: "w2", now: later(120_000), limits })!.id).toBe(first.id);
    // The other kind's expired job is claimable too, but the queued limited job still waits.
    expect(claimNext(db, { workerId: "w2", now: later(120_001), limits })!.kind).toBe("test.work");
    expect(claimNext(db, { workerId: "w2", now: later(120_002), limits })).toBeUndefined();
  });

  it("records a failure only while the worker still holds the lease", () => {
    enqueue(db, job("lost"));
    const claimed = claimNext(db, { workerId: "w1" })!;
    rawRun(db, "update jobs set lease_owner = 'w2' where id = ?", claimed.id);

    expect(fail(db, claimed, "w1", new Error("late"))).toBe(false);
  });

  describe("worker", () => {
    it("never runs more jobs at once than its concurrency", async () => {
      const gates: (() => void)[] = [];
      let running = 0;
      let peak = 0;
      const handlers = {
        "test.work": () =>
          new Promise<void>((resolve) => {
            running++;
            peak = Math.max(peak, running);
            gates.push(() => {
              running--;
              resolve();
            });
          }),
      };
      for (const key of ["1", "2", "3", "4", "5"]) enqueue(db, job(key));

      const worker = new Worker({ db, handlers, concurrency: 2, pollIntervalMs: 10 });
      worker.start();
      await waitFor(() => running === 2);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(jobCounts(db).running).toBe(2);

      while (jobCounts(db).succeeded !== 5) {
        gates.shift()?.();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await worker.stop();
      expect(peak).toBe(2);
    });

    it("runs only one preview build at a time, while other jobs keep running", async () => {
      const gates = new Map<string, () => void>();
      const running = new Set<string>();
      let previewPeak = 0;
      let assessmentAlongsidePreview = false;
      const handler = (kind: string) => (payload: JsonObject) =>
        new Promise<void>((resolve) => {
          const key = `${kind}:${String(payload.key)}`;
          running.add(key);
          const previews = [...running].filter((name) => name.startsWith(BUILD_PREVIEW)).length;
          previewPeak = Math.max(previewPeak, previews);
          if (kind === PROCESS_TARGET && previews > 0) assessmentAlongsidePreview = true;
          gates.set(key, () => {
            running.delete(key);
            resolve();
          });
        });
      const handlers = { [BUILD_PREVIEW]: handler(BUILD_PREVIEW), [PROCESS_TARGET]: handler(PROCESS_TARGET) };
      for (const key of ["a", "b"]) enqueue(db, job(key, { kind: BUILD_PREVIEW, idempotencyKey: `${BUILD_PREVIEW}:${key}` }));
      enqueue(db, job("t", { kind: PROCESS_TARGET, idempotencyKey: `${PROCESS_TARGET}:t` }));

      const config = withOverrides(getConfig(), { previews: { concurrency: 1 } });
      const worker = new Worker({ db, handlers, concurrency: 3, limits: jobLimits(config), pollIntervalMs: 10 });
      worker.start();
      // One preview and the assessment job run; the second preview waits though a slot is free.
      await waitFor(() => running.size === 2);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect([...running].sort()).toEqual([`${PROCESS_TARGET}:t`, `${BUILD_PREVIEW}:a`]);
      expect(jobCounts(db)).toMatchObject({ running: 2, queued: 1 });

      gates.get(`${BUILD_PREVIEW}:a`)!();
      await waitFor(() => running.has(`${BUILD_PREVIEW}:b`));
      gates.get(`${PROCESS_TARGET}:t`)!();
      gates.get(`${BUILD_PREVIEW}:b`)!();
      await waitFor(() => jobCounts(db).succeeded === 3);
      await worker.stop();
      expect(previewPeak).toBe(1);
      expect(assessmentAlongsidePreview).toBe(true);
    });

    it("renews the lease while a long job runs and aborts the handler when the lease is lost", async () => {
      const long = enqueue(db, job("long"));
      let aborted = false;
      const handlers = {
        "test.work": (_payload: unknown, { signal }: { signal: AbortSignal }) =>
          new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            });
          }),
      };

      const result = runJob(db, claimNext(db, { workerId: "w", leaseMs: 150 })!, handlers, { workerId: "w", leaseMs: 150 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(claimNext(db, { workerId: "other" })).toBeUndefined();

      rawRun(db, "update jobs set lease_owner = 'thief' where id = ?", long.id);
      expect(await result).toBe("lease_lost");
      expect(aborted).toBe(true);
    });
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
