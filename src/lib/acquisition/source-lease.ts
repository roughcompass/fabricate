import { and, eq } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { sourceLeases } from "@/lib/db/schema";
import { AcquisitionError } from "./errors";

/**
 * Runs +work+ while holding the lease on one source's managed object
 * database, so worker processes never update the same mirror at once. Other
 * sources proceed concurrently. The lease is renewed while +work+ runs and
 * expires on its own if the holder stops without releasing it.
 */
export interface LeaseOptions {
  holder: string;
  /** How long to wait for another holder before failing. */
  waitMs: number;
  /** How long an unrenewed lease lasts. */
  ttlMs: number;
  signal?: AbortSignal;
  pollMs?: number;
}

export async function withSourceLease<T>(db: Executor, repositorySourceId: number, options: LeaseOptions, work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + options.waitMs;
  while (!tryAcquire(db, repositorySourceId, options.holder, options.ttlMs)) {
    if (options.signal?.aborted) throw new AcquisitionError("canceled", "Acquisition was canceled while waiting for the source mirror");
    if (Date.now() >= deadline) {
      throw new AcquisitionError("lock_timeout", `Another worker held this source's mirror for more than ${Math.round(options.waitMs / 1_000)}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 100));
  }

  const renewal = setInterval(() => renew(db, repositorySourceId, options.holder, options.ttlMs), Math.max(50, Math.floor(options.ttlMs / 3)));
  try {
    return await work();
  } finally {
    clearInterval(renewal);
    db.delete(sourceLeases).where(and(eq(sourceLeases.repositorySourceId, repositorySourceId), eq(sourceLeases.holder, options.holder))).run();
  }
}

function tryAcquire(db: Executor, repositorySourceId: number, holder: string, ttlMs: number): boolean {
  return immediate(db, (tx) => {
    const now = new Date();
    const current = tx.select().from(sourceLeases).where(eq(sourceLeases.repositorySourceId, repositorySourceId)).get();
    if (current && current.holder !== holder && current.expiresAt > now) return false;

    const values = { holder, acquiredAt: now, expiresAt: new Date(now.getTime() + ttlMs) };
    tx.insert(sourceLeases)
      .values({ repositorySourceId, ...values })
      .onConflictDoUpdate({ target: sourceLeases.repositorySourceId, set: values })
      .run();
    return true;
  });
}

function renew(db: Executor, repositorySourceId: number, holder: string, ttlMs: number): void {
  db.update(sourceLeases)
    .set({ expiresAt: new Date(Date.now() + ttlMs) })
    .where(and(eq(sourceLeases.repositorySourceId, repositorySourceId), eq(sourceLeases.holder, holder)))
    .run();
}
