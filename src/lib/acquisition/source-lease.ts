import { AcquisitionError } from "./errors";

/**
 * One update at a time to each source's managed object database (design
 * decision 11). Only one worker process runs (src/worker/lock.ts), so a queue
 * per repository in its memory is enough; work on different repositories
 * runs in parallel.
 */
export interface LockOptions {
  /** How long to wait for the work ahead of it before failing. */
  waitMs: number;
  signal?: AbortSignal;
}

/** The end of each repository's queue: settles when the last work queued on it is done. */
const queues = new Map<number, Promise<void>>();

/** Runs +work+ once every earlier work on +repositorySourceId+ is done, or fails after waiting +waitMs+. */
export async function withSourceLock<T>(repositorySourceId: number, options: LockOptions, work: () => Promise<T>): Promise<T> {
  const ahead = queues.get(repositorySourceId) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  // Whoever queues next waits for this work, and for everything ahead of it even if this one gives up waiting.
  const tail = ahead.then(() => done);
  queues.set(repositorySourceId, tail);
  try {
    await waitFor(ahead, options);
    return await work();
  } finally {
    release();
    // Forgotten once everything queued up to here is done, unless more work queued behind it.
    void tail.then(() => queues.get(repositorySourceId) === tail && queues.delete(repositorySourceId));
  }
}

function waitFor(ahead: Promise<void>, { waitMs, signal }: LockOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const canceled = () => finish(new AcquisitionError("canceled", "Acquisition was canceled while waiting for the source mirror"));
    const timer = setTimeout(() => finish(new AcquisitionError("lock_timeout", `Other work held this source's mirror for more than ${Math.round(waitMs / 1_000)}s`)), waitMs);
    function finish(error?: AcquisitionError) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", canceled);
      if (error) reject(error);
      else resolve();
    }
    if (signal?.aborted) return canceled();
    signal?.addEventListener("abort", canceled, { once: true });
    void ahead.then(() => finish());
  });
}
