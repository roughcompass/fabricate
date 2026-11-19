import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import type { FabricateConfig } from "@/lib/config";
import type { BuildPlan } from "./eligibility";
import { type CommandResult, TAR_PATH, runCommand } from "./process";
import { cacheDirectory } from "./storage";
import { buildEnvironment, managerCommand } from "./toolchain";

/**
 * `npm run previews:doctor` (design decision 10): whether this host has the
 * toolchain preview builds run. For each `previews.nodeVersions` entry, the
 * directory's `node` must report that version, and its corepack must run
 * pnpm and Yarn. Each runs in the environment a build's install gets, with
 * corepack's and the package managers' caches under `previews.storage` and a
 * throwaway HOME and TMPDIR, so nothing reads or writes the user's own. It
 * also finds `git` where the Git runner looks for it, on the worker's PATH,
 * and `tar` where extraction looks for it.
 */

export type CheckStatus = "ok" | "failed" | "skipped";

export interface ToolchainCheck {
  /** What was checked, such as `Node 22.11.0 pnpm` or `git`. */
  readonly subject: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface CheckCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** Runs one command to completion and returns how it ended and what it printed. */
export type CheckRunner = (command: CheckCommand) => Promise<{ result: CommandResult; output: string }>;

export interface DoctorOptions {
  /** Runs the checks' commands; runCommand by default. */
  run?: CheckRunner;
  /** Where the Git runner finds git: the worker's PATH by default. */
  gitPath?: string;
  /** Where extraction finds tar. */
  tarPath?: string;
  /** Receives each check as it completes. */
  onCheck?: (check: ToolchainCheck) => void;
}

/** How long one command may run; corepack may download a package manager first. */
const COMMAND_TIMEOUT_MS = 2 * 60_000;
/** How much of a command's output a check keeps. */
const OUTPUT_LIMIT = 16 * 1024;

type Manager = BuildPlan["packageManager"];
const MANAGERS: readonly { label: string; plan: Manager }[] = [
  { label: "pnpm", plan: { name: "pnpm", version: null, lockfile: "pnpm-lock.yaml" } },
  { label: "Yarn", plan: { name: "yarn", version: null, lockfile: "yarn.lock" } },
];
/** The plan whose environment runs `node --version`: Node's own npm, so no package manager cache matters. */
const NODE_ONLY: Manager = { name: "npm", version: null, lockfile: "package-lock.json" };

/** Checks every configured Node version, then git and tar. */
export async function checkToolchain(config: FabricateConfig, options: DoctorOptions = {}): Promise<ToolchainCheck[]> {
  const run = options.run ?? runWithLimit;
  const checks: ToolchainCheck[] = [];
  const report = (subject: string, status: CheckStatus, detail: string) => {
    const check = { subject, status, detail };
    checks.push(check);
    options.onCheck?.(check);
    return check;
  };
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "fabricate-previews-doctor-"));
  try {
    const home = path.join(scratch, "home");
    const tmp = path.join(scratch, "tmp");
    await fsp.mkdir(home);
    await fsp.mkdir(tmp);
    const environment = (manager: Manager, nodeBin: string) => buildEnvironment({ manager, nodeBin, shims: null, home, tmp, cache: cacheDirectory(config), step: "install" });

    const versions = Object.entries(config.previews.nodeVersions).sort(([a], [b]) => semver.compare(a, b));
    if (versions.length === 0) report("previews.nodeVersions", "failed", "No Node versions are configured, so previews can't build anything. Install one with mise and add its bin directory (docs/previews.md).");
    for (const [version, nodeBin] of versions) {
      const subject = `Node ${version}`;
      const node = path.join(nodeBin, "node");
      let usable = false;
      if (!isExecutable(node)) {
        report(subject, "failed", `${nodeBin} has no node executable`);
      } else {
        const { result, output } = await attempt(run, { command: node, args: ["--version"], cwd: home, env: environment(NODE_ONLY, nodeBin) });
        const reported = lastLine(output);
        if (!succeeded(result)) report(subject, "failed", `${node} --version ${ending(result, output)}`);
        else if (semver.clean(reported) !== version) {
          usable = true;
          report(subject, "failed", `${node} reports ${reported || "nothing"}, not v${version}`);
        } else {
          usable = true;
          report(subject, "ok", `${node} reports ${reported}`);
        }
      }

      const corepack = path.join(nodeBin, "corepack");
      for (const manager of MANAGERS) {
        const label = `${subject} ${manager.label}`;
        if (!usable) {
          report(label, "skipped", `needs Node ${version}'s node to run`);
          continue;
        }
        if (!isExecutable(corepack)) {
          report(label, "failed", `${nodeBin} has no corepack, which builds that install with pnpm or Yarn need`);
          continue;
        }
        const invocation = managerCommand(manager.plan, nodeBin);
        const { result, output } = await attempt(run, { command: invocation.command, args: [...invocation.args, "--version"], cwd: home, env: environment(manager.plan, nodeBin) });
        const reported = lastLine(output);
        if (!succeeded(result)) report(label, "failed", `corepack ${manager.plan.name} --version ${ending(result, output)}`);
        else if (!semver.valid(reported)) report(label, "failed", `corepack ${manager.plan.name} --version printed ${reported ? JSON.stringify(reported) : "nothing"}, not a version`);
        else report(label, "ok", `corepack runs ${manager.label} ${reported}`);
      }
    }

    for (const [tool, searchPath, where] of [
      ["git", options.gitPath ?? process.env.PATH ?? "", "the worker's PATH"],
      ["tar", options.tarPath ?? TAR_PATH, TAR_PATH],
    ] as const) {
      const found = searchPath
        .split(path.delimiter)
        .filter((directory) => path.isAbsolute(directory))
        .map((directory) => path.join(directory, tool))
        .find(isExecutable);
      if (!found) {
        report(tool, "failed", `${tool} isn't in ${where}`);
        continue;
      }
      const { result, output } = await attempt(run, { command: found, args: ["--version"], cwd: home, env: { PATH: searchPath, HOME: home, LC_ALL: "C" } });
      if (succeeded(result)) report(tool, "ok", `${found}, ${firstLine(output) || "which runs"}`);
      else report(tool, "failed", `${found} --version ${ending(result, output)}`);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
  return checks;
}

/** One check as the doctor prints it. */
export function formatCheck(check: ToolchainCheck): string {
  const label = { ok: "ok", failed: "FAIL", skipped: "skip" }[check.status];
  return `${label.padEnd(5)}${check.subject}: ${check.detail}`;
}

/** The doctor's last line: whether everything passed, or what failed. */
export function summarize(checks: readonly ToolchainCheck[]): string {
  const failed = checks.filter((check) => check.status === "failed");
  if (failed.length === 0) return `All ${checks.length} checks passed.`;
  return `${failed.length} of ${checks.length} checks failed: ${failed.map((check) => check.subject).join(", ")}.`;
}

async function runWithLimit(command: CheckCommand): Promise<{ result: CommandResult; output: string }> {
  let output = "";
  const result = await runCommand({
    ...command,
    output: (chunk) => {
      if (output.length < OUTPUT_LIMIT) output += chunk.toString("utf8");
    },
    deadline: Date.now() + COMMAND_TIMEOUT_MS,
  });
  return { result, output };
}

/** Runs +command+, reporting a process that couldn't start as its output. */
async function attempt(run: CheckRunner, command: CheckCommand): Promise<{ result: CommandResult | null; output: string }> {
  try {
    return await run(command);
  } catch (error) {
    return { result: null, output: error instanceof Error ? error.message : String(error) };
  }
}

function succeeded(result: CommandResult | null): boolean {
  return result?.outcome === "exited" && result.code === 0;
}

/** How a command that didn't succeed ended, with the end of what it printed. */
function ending(result: CommandResult | null, output: string): string {
  const said = lastLines(output);
  const how =
    result === null
      ? "couldn't start"
      : result.outcome === "timed_out"
        ? `didn't finish within ${COMMAND_TIMEOUT_MS / 60_000} minutes`
        : result.outcome === "aborted"
          ? "was stopped"
          : result.code === null
            ? `was stopped by ${result.signal}`
            : `exited with code ${result.code}`;
  return said ? `${how}: ${said}` : how;
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function lines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function firstLine(output: string): string {
  return lines(output)[0] ?? "";
}

function lastLine(output: string): string {
  return lines(output).at(-1) ?? "";
}

function lastLines(output: string): string {
  return lines(output).slice(-2).join(" / ");
}
