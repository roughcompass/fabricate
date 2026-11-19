import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkerLockError, claimWorkerLock } from "@/worker/lock";
import { createTestDbFile } from "../support/db";

describe("worker lock", () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "worker-lock-"));
    file = path.join(directory, "worker.lock");
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("records this process, and removes the file on release", () => {
    const release = claimWorkerLock(file);
    expect(fs.readFileSync(file, "utf8").trim()).toBe(String(process.pid));
    release();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("refuses to start a second worker while a live one holds the lock, with a clear message", async () => {
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    try {
      fs.writeFileSync(file, `${other.pid}\n`);
      expect(() => claimWorkerLock(file)).toThrow(WorkerLockError);
      expect(() => claimWorkerLock(file)).toThrow(`Another worker (process ${other.pid}) is running against this database. Stop it first; if it isn't running, delete ${file}.`);
      expect(fs.readFileSync(file, "utf8").trim()).toBe(String(other.pid));
    } finally {
      other.kill();
    }
  });

  it("takes over a lock left by a worker that stopped without releasing it", async () => {
    const stopped = spawn(process.execPath, ["-e", ""]);
    await new Promise((resolve) => stopped.once("exit", resolve));
    fs.writeFileSync(file, `${stopped.pid}\n`);

    const release = claimWorkerLock(file);
    expect(fs.readFileSync(file, "utf8").trim()).toBe(String(process.pid));
    release();
  });

  it("leaves a lock another worker took over in place on release", () => {
    const release = claimWorkerLock(file);
    fs.writeFileSync(file, "999999999\n");
    release();
    expect(fs.readFileSync(file, "utf8").trim()).toBe("999999999");
  });

  it("stops a second worker process with the message, before it runs any job", async () => {
    const database = path.join(directory, "fabricate.sqlite3");
    createTestDbFile(database);
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    fs.writeFileSync(file, `${other.pid}\n`);
    try {
      const env = { ...process.env, FABRICATE_ENV: "test", FABRICATE_DATABASE: database, FABRICATE_REPOSITORY_STORAGE: path.join(directory, "repositories") };
      const exit = await promisify(execFile)(process.execPath, ["--import", "tsx", "src/worker/main.ts"], { cwd: process.cwd(), env, timeout: 60_000 }).then(
        () => ({ code: 0, stderr: "" }),
        (error: { code: number; stderr: string }) => ({ code: error.code, stderr: error.stderr }),
      );

      expect(exit.code).toBe(1);
      expect(exit.stderr).toContain(`[worker] Another worker (process ${other.pid}) is running against this database.`);
    } finally {
      other.kill();
    }
  }, 90_000);
});
