import { spawn } from "node:child_process";
import type { GitRunner } from "@/lib/git/runner";

/**
 * Processes a repository preview build starts (openspec add-repository-previews,
 * design decision 4): the package manager's install and build, and the `tar`
 * that unpacks `git archive`. Besides GitRunner, it's the only module allowed
 * to import child_process. Previews are the one place Fabricate runs
 * repository code, and only for remotes an operator enrolled as trusted.
 *
 * Every process gets an argv array with `shell: false`, the environment its
 * caller constructed, and a process group of its own. On timeout or abort
 * the whole group is stopped, SIGTERM then SIGKILL, so nothing a script
 * spawned outlives it; when the process exits, anything it left behind in
 * its group is killed too.
 */

/** How long a stopped group gets between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 2_000;
/** How long to wait for output after the process exited, when something outside its group holds its pipes. */
const CLOSE_GRACE_MS = 5_000;
/** Directories tar is looked up in, which `npm run previews:doctor` checks too. */
export const TAR_PATH = "/usr/local/bin:/usr/bin:/bin";

export interface CommandSpec {
  /** An absolute path to the executable. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** The complete environment; nothing is inherited. */
  readonly env: Readonly<Record<string, string>>;
  /** Receives standard output and standard error as they arrive. */
  readonly output: (chunk: Buffer) => void;
  /** When the process is stopped, in epoch milliseconds. */
  readonly deadline: number;
  readonly signal?: AbortSignal;
}

export type CommandResult = { readonly outcome: "exited"; readonly code: number | null; readonly signal: NodeJS.Signals | null } | { readonly outcome: "timed_out" } | { readonly outcome: "aborted" };

/** Runs one command to completion, or until its deadline or +signal+ stops its process group. */
export function runCommand(spec: CommandSpec): Promise<CommandResult> {
  if (spec.signal?.aborted) return Promise.resolve({ outcome: "aborted" });
  if (spec.deadline <= Date.now()) return Promise.resolve({ outcome: "timed_out" });

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      // A constructed environment, not the parent's. Next.js types require NODE_ENV on ProcessEnv.
      env: spec.env as NodeJS.ProcessEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true,
    });
    let stopped: "timed_out" | "aborted" | null = null;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let settled = false;
    let closeTimer: NodeJS.Timeout | undefined;

    const stop = (reason: "timed_out" | "aborted") => {
      if (stopped || exit) return;
      stopped = reason;
      terminate(child.pid);
    };
    const timer = setTimeout(() => stop("timed_out"), spec.deadline - Date.now());
    const onAbort = () => stop("aborted");
    spec.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout!.on("data", spec.output);
    child.stderr!.on("data", spec.output);

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(closeTimer);
      spec.signal?.removeEventListener("abort", onAbort);
      settle();
    };
    const result = (): CommandResult => (stopped ? { outcome: stopped } : { outcome: "exited", ...exit! });

    child.on("error", (error: NodeJS.ErrnoException) => finish(() => reject(new Error(`${spec.command} could not be started (${error.code ?? error.name})`))));
    child.on("exit", (code, signal) => {
      exit = { code, signal };
      // Whatever the process left running in its group goes with it.
      signalGroup(child.pid, "SIGKILL");
      closeTimer = setTimeout(() => finish(() => resolve(result())), CLOSE_GRACE_MS);
    });
    child.on("close", () => finish(() => resolve(result())));
  });
}

/**
 * Unpacks the tree of +commit+ into +destination+: `git archive` from the
 * managed clone, piped into `tar`. Nothing is checked out, and no hook,
 * filter, or submodule runs.
 */
export async function extractCommit(runner: GitRunner, gitDir: string, commit: string, destination: string, signal?: AbortSignal): Promise<void> {
  const tar = spawn("tar", ["-x", "--no-same-owner", "-f", "-", "-C", destination], {
    cwd: destination,
    env: { PATH: TAR_PATH, LC_ALL: "C" } as unknown as NodeJS.ProcessEnv,
    shell: false,
    stdio: ["pipe", "ignore", "pipe"],
    detached: true,
    windowsHide: true,
  });
  let stderr = "";
  tar.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
    if (stderr.length < 4_096) stderr += chunk;
  });
  // tar may exit before reading everything; git then reports the broken pipe.
  tar.stdin!.on("error", () => {});
  const exited = new Promise<number | null>((resolve, reject) => {
    tar.on("error", (error: NodeJS.ErrnoException) => reject(new Error(`tar could not be started (${error.code ?? error.name})`)));
    tar.on("close", (code) => resolve(code));
  });
  exited.catch(() => {});
  try {
    await runner.archive(gitDir, commit, tar.stdin!, signal);
  } catch (error) {
    terminate(tar.pid);
    // When tar couldn't start, that's why the archive had nowhere to go.
    throw (await exited.then(() => null, (failure: unknown) => failure)) ?? error;
  }
  const code = await exited;
  if (code !== 0) throw new Error(`tar couldn't unpack the commit (exit ${code}): ${stderr.trim()}`);
}

/** Signals a process group, SIGTERM and then SIGKILL. */
function terminate(pid: number | undefined): void {
  signalGroup(pid, "SIGTERM");
  setTimeout(() => signalGroup(pid, "SIGKILL"), KILL_GRACE_MS).unref();
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The group has already exited.
  }
}
