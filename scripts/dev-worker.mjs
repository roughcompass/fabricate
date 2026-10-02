// Runs the worker for `npm run dev`.
//
//   node scripts/dev-worker.mjs
//
// Like `tsx watch`, it restarts the worker when the worker's code or the
// configuration changes. Unlike `tsx watch`, it also restarts the worker when
// it exits on its own, after a delay that grows while it keeps failing, and it
// says so. A crashed worker therefore never leaves the web server running
// with nothing to pick up queued runs.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = "src/worker/main.ts";
// The worker imports only src/lib and src/worker, and reads config/ at startup.
const WATCHED = ["src/lib", "src/worker", "config"];
const SOURCE = /\.(?:[cm]?[jt]sx?|json)$/;
const DEBOUNCE_MS = 200;
const FIRST_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
// A worker that ran this long before exiting starts the delays over.
const HEALTHY_MS = 60_000;
// A worker that is still finishing jobs this long after a restart is stopped.
const STOP_GRACE_MS = 10_000;

const log = (message) => console.log(`[dev-worker] ${message}`);

let child = null;
let startedAt = 0;
let delay = FIRST_DELAY_MS;
let retry = null;
let restarting = false;
let stopping = false;

function start() {
  retry = null;
  startedAt = Date.now();
  child = spawn(process.execPath, ["--import", "tsx", ENTRY], { cwd: ROOT, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) process.exit(0);
    if (restarting) {
      restarting = false;
      start();
      return;
    }
    if (Date.now() - startedAt >= HEALTHY_MS) delay = FIRST_DELAY_MS;
    log(`the worker exited (${signal ?? `code ${code}`}); restarting it in ${delay / 1000}s`);
    retry = setTimeout(start, delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  });
}

function restart(reason) {
  log(`${reason}; restarting the worker`);
  delay = FIRST_DELAY_MS;
  if (retry) {
    clearTimeout(retry);
    start();
  } else if (child && !restarting) {
    restarting = true;
    const stopped = child;
    stopped.kill("SIGTERM");
    setTimeout(() => stopped.exitCode === null && stopped.signalCode === null && stopped.kill("SIGKILL"), STOP_GRACE_MS).unref();
  }
}

let pending = null;
for (const directory of WATCHED) {
  fs.watch(path.join(ROOT, directory), { recursive: true }, (_event, file) => {
    if (!file || !SOURCE.test(file)) return;
    clearTimeout(pending);
    pending = setTimeout(() => restart(`${path.join(directory, file)} changed`), DEBOUNCE_MS);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopping = true;
    clearTimeout(retry);
    clearTimeout(pending);
    // The worker finishes its running jobs before it exits.
    if (child) child.kill(signal);
    else process.exit(0);
  });
}

start();
