import fs from "node:fs";

/*
 * One worker process per database (design decision 11). Repository updates
 * are serialized by a lock in the worker's memory, so a second worker would
 * update the same local copies at once. The worker claims a lock file that
 * records its process ID, and refuses to start while a live process holds it.
 * A lock left by a worker that stopped without releasing it is taken over.
 */

export class WorkerLockError extends Error {}

/** Claims +file+ for this process, or throws WorkerLockError naming the live worker that holds it. Returns the release. */
export function claimWorkerLock(file: string): () => void {
  for (;;) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = holderOf(file);
    if (holder !== null && Number.isInteger(holder) && holder !== process.pid && isAlive(holder)) {
      throw new WorkerLockError(`Another worker (process ${holder}) is running against this database. Stop it first; if it isn't running, delete ${file}.`);
    }
    fs.rmSync(file, { force: true });
  }
  return () => {
    if (holderOf(file) === process.pid) fs.rmSync(file, { force: true });
  };
}

function holderOf(file: string): number | null {
  try {
    return Number.parseInt(fs.readFileSync(file, "utf8"), 10);
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
