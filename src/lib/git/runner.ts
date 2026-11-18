import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CloneUrl, InvalidCloneUrl } from "@/lib/catalog/clone-url";
import { type FabricateConfig, getConfig, isInside } from "@/lib/config";
import { GitError } from "./errors";
import { redact } from "./redact";

/**
 * The only path from Fabricate to the Git executable, and the only module
 * allowed to import child_process.
 *
 * Every invocation is an argv array passed to spawn with `shell: false`, built
 * from an allowlist of subcommands and options. User-derived positional
 * arguments always follow --end-of-options and can never look like options.
 * Repository commands may only address managed object databases inside the
 * configured repository storage.
 *
 * The child receives a constructed environment rather than the parent's:
 * system and global Git configuration are ignored, hooks point at /dev/null,
 * prompts are disabled, lazy fetching is off, and only the transport protocol
 * the current operation needs is allowed. The -c overrides below also reach
 * any upload-pack Git spawns inside a local source repository, because Git
 * passes command-line configuration to child processes, and command-line
 * configuration outranks the repository's own.
 */

const PROTOCOLS = ["file", "https", "ssh"] as const;
export type Protocol = (typeof PROTOCOLS)[number];

/** subcommand => permitted options. */
const COMMANDS: Readonly<Record<string, readonly string[]>> = {
  version: [],
  init: ["--bare", "--quiet", "--template="],
  "ls-remote": ["--symref"],
  fetch: ["--no-tags", "--no-recurse-submodules", "--no-write-fetch-head", "--no-auto-gc", "--no-auto-maintenance", "--quiet", "--force", "--depth=1"],
  "rev-parse": ["--verify", "--quiet"],
  "update-ref": ["--no-deref", "-d"],
  "for-each-ref": ["--format=%(objectname) %(refname)"],
  "cat-file": ["--batch", "-t"],
  "ls-tree": ["-r", "-z", "-l", "-t", "--full-tree"],
};

const REPOSITORY_COMMANDS = new Set(["fetch", "rev-parse", "update-ref", "for-each-ref", "cat-file", "ls-tree"]);
const NETWORK_COMMANDS = new Set(["ls-remote", "fetch"]);
/** Commands whose positionals include a clone URL in the first position. */
const URL_COMMANDS = new Set(["ls-remote", "fetch"]);

const BASE_CONFIG = [
  "core.hooksPath=/dev/null",
  "core.fsmonitor=false",
  "core.symlinks=false",
  "submodule.recurse=false",
  "fetch.recurseSubmodules=false",
  "fetch.fsckObjects=true",
  "transfer.fsckObjects=true",
  "gc.auto=0",
  "maintenance.auto=false",
  "protocol.allow=never",
  "credential.helper=",
];

const PASSTHROUGH_ENV: Readonly<Record<Protocol, readonly string[]>> = {
  file: [],
  https: ["SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"],
  ssh: ["SSH_AUTH_SOCK"],
};

const DEFAULT_OUTPUT_LIMIT = 8 * 1024 * 1024;
const TREE_OUTPUT_LIMIT = 256 * 1024 * 1024;
const STDERR_LIMIT = 64 * 1024;
const KILL_GRACE_MS = 1_000;

export interface GitResult {
  stdout: Buffer;
  stderr: string;
}

export interface GitRunnerOptions {
  executable?: string;
  timeoutMs?: number;
  home?: string;
  config?: FabricateConfig;
}

export interface Invocation {
  subcommand: string;
  options?: readonly string[];
  positionals?: readonly string[];
  /** A managed bare repository inside repository storage. */
  gitDir?: string;
  /** Required for, and only for, network commands. */
  protocol?: Protocol;
  input?: string | Buffer;
  signal?: AbortSignal;
  outputLimit?: number;
}

export class GitRunner {
  readonly executable: string;
  readonly timeoutMs: number;
  readonly home: string;
  readonly storage: string;
  readonly credentialHelper: string | null;

  constructor(options: GitRunnerOptions = {}) {
    const config = options.config ?? getConfig();
    this.executable = options.executable ?? "git";
    this.timeoutMs = options.timeoutMs ?? config.gitTimeoutSeconds * 1_000;
    this.storage = config.repositoryStorage;
    this.home = options.home ?? path.join(config.repositoryStorage, ".git-home");
    this.credentialHelper = config.gitCredentialHelper;
  }

  // -- Named operations ------------------------------------------------------

  async version(): Promise<string> {
    return (await this.run({ subcommand: "version" })).stdout.toString("utf8").trim();
  }

  async initBare(gitDir: string): Promise<void> {
    this.assertManaged(gitDir);
    await this.run({ subcommand: "init", options: ["--bare", "--quiet", "--template="], positionals: [gitDir] });
  }

  /** Lists remote refs, including the symbolic target of HEAD. */
  async lsRemote(url: string, protocol: Protocol, signal?: AbortSignal): Promise<string> {
    return (await this.run({ subcommand: "ls-remote", options: ["--symref"], positionals: [url, "HEAD", "refs/heads/*", "refs/tags/*"], protocol, signal })).stdout.toString("utf8");
  }

  async fetch(gitDir: string, url: string, refspecs: readonly string[], protocol: Protocol, options: { signal?: AbortSignal; shallow?: boolean } = {}): Promise<void> {
    const flags = ["--no-tags", "--no-recurse-submodules", "--no-write-fetch-head", "--no-auto-gc", "--no-auto-maintenance", "--quiet", "--force"];
    if (options.shallow) flags.push("--depth=1");
    await this.run({ subcommand: "fetch", options: flags, positionals: [url, ...refspecs], gitDir, protocol, signal: options.signal });
  }

  /** Resolves a revision to an object id, or null if it does not exist. */
  async revParse(gitDir: string, revision: string): Promise<string | null> {
    try {
      const output = (await this.run({ subcommand: "rev-parse", options: ["--verify", "--quiet"], positionals: [revision], gitDir })).stdout.toString("utf8").trim();
      return output || null;
    } catch (error) {
      if (error instanceof GitError && error.code === "command_failed") return null;
      throw error;
    }
  }

  async updateRef(gitDir: string, ref: string, newValue: string, oldValue?: string): Promise<void> {
    await this.run({ subcommand: "update-ref", options: ["--no-deref"], positionals: oldValue ? [ref, newValue, oldValue] : [ref, newValue], gitDir });
  }

  async deleteRef(gitDir: string, ref: string): Promise<void> {
    await this.run({ subcommand: "update-ref", options: ["--no-deref", "-d"], positionals: [ref], gitDir });
  }

  async forEachRef(gitDir: string, pattern: string): Promise<{ objectId: string; ref: string }[]> {
    const output = (await this.run({ subcommand: "for-each-ref", options: ["--format=%(objectname) %(refname)"], positionals: [pattern], gitDir })).stdout.toString("utf8");
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [objectId, ref] = line.split(" ", 2);
        return { objectId: objectId!, ref: ref! };
      });
  }

  async objectType(gitDir: string, objectId: string): Promise<string> {
    return (await this.run({ subcommand: "cat-file", options: ["-t"], positionals: [objectId], gitDir })).stdout.toString("utf8").trim();
  }

  /** NUL-separated recursive tree listing with object sizes. */
  async lsTree(gitDir: string, treeish: string): Promise<Buffer> {
    return (await this.run({ subcommand: "ls-tree", options: ["-r", "-z", "-l", "-t", "--full-tree"], positionals: [treeish], gitDir, outputLimit: TREE_OUTPUT_LIMIT })).stdout;
  }

  /** Reads objects through `cat-file --batch`; ids are sent on stdin, never as arguments. */
  async catFileBatch(gitDir: string, objectIds: readonly string[], outputLimit = DEFAULT_OUTPUT_LIMIT): Promise<Buffer> {
    for (const objectId of objectIds) {
      if (!/^[0-9a-f]{40}$/.test(objectId)) throw new GitError("command_rejected", "cat-file --batch accepts only full object ids");
    }
    return (await this.run({ subcommand: "cat-file", options: ["--batch"], gitDir, input: objectIds.map((objectId) => `${objectId}\n`).join(""), outputLimit })).stdout;
  }

  // -- Allowlisted execution ---------------------------------------------------

  async run(invocation: Invocation): Promise<GitResult> {
    const argv = this.argv(invocation);
    return this.execute(invocation.subcommand, argv, this.environment(invocation.protocol), invocation);
  }

  /** Validates an invocation and builds its argv. Throws command_rejected on any deviation. */
  argv(invocation: Invocation): string[] {
    const { subcommand, options = [], positionals = [], gitDir, protocol } = invocation;
    const permitted = COMMANDS[subcommand];
    if (!permitted) throw rejected(`git ${subcommand} is not an allowed operation`);
    for (const option of options) if (!permitted.includes(option)) throw rejected(`option ${JSON.stringify(option)} is not allowed for git ${subcommand}`);
    for (const value of positionals) {
      if (value === "" || value.startsWith("-") || /[\x00-\x1f\x7f]/.test(value)) throw rejected(`argument ${JSON.stringify(redact(value))} is not allowed for git ${subcommand}`);
    }

    if (NETWORK_COMMANDS.has(subcommand)) {
      if (!protocol || !PROTOCOLS.includes(protocol)) throw rejected(`git ${subcommand} requires an allowed protocol`);
    } else if (protocol) {
      throw rejected(`git ${subcommand} does not use a transport protocol`);
    }
    if (URL_COMMANDS.has(subcommand)) this.assertUrl(positionals[0], protocol!);

    const needsRepository = REPOSITORY_COMMANDS.has(subcommand);
    if (needsRepository && !gitDir) throw rejected(`git ${subcommand} requires a managed repository`);
    if (!needsRepository && gitDir) throw rejected(`git ${subcommand} does not accept a repository`);
    if (gitDir) this.assertManaged(gitDir);

    return [
      ...this.configArguments(protocol),
      ...(gitDir ? [`--git-dir=${gitDir}`] : []),
      subcommand,
      ...options,
      ...(positionals.length ? ["--end-of-options", ...positionals] : []),
    ];
  }

  environment(protocol?: Protocol): Record<string, string> {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: this.home,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_PROTOCOL_FROM_USER: "0",
      GIT_ALLOW_PROTOCOL: protocol ?? "",
      GIT_CEILING_DIRECTORIES: this.home,
      SSH_ASKPASS_REQUIRE: "never",
    };
    if (protocol === "ssh") env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
    for (const key of protocol ? PASSTHROUGH_ENV[protocol] : []) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    return env;
  }

  private configArguments(protocol?: Protocol): string[] {
    const config = [...BASE_CONFIG];
    if (protocol) config.push(`protocol.${protocol}.allow=always`);
    if (protocol === "https" && this.credentialHelper) config.push(`credential.helper=${this.credentialHelper}`);
    return config.flatMap((entry) => ["-c", entry]);
  }

  private assertManaged(gitDir: string): void {
    const resolved = path.resolve(gitDir);
    if (resolved !== gitDir || !resolved.endsWith(".git") || !isInside(this.storage, resolved) || resolved === this.storage) {
      throw rejected("Git may only address managed repositories inside repository storage");
    }
  }

  private assertUrl(value: string | undefined, protocol: Protocol): void {
    let url: CloneUrl;
    try {
      url = CloneUrl.parse(value ?? "");
    } catch (error) {
      if (error instanceof InvalidCloneUrl) throw rejected(`clone URL rejected: ${error.message}`);
      throw error;
    }
    if (url.protocol !== protocol || url.toString() !== value) throw rejected("the clone URL must be canonical and match the allowed protocol");
  }

  private execute(subcommand: string, argv: string[], env: Record<string, string>, invocation: Invocation): Promise<GitResult> {
    const outputLimit = invocation.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
    fs.mkdirSync(this.home, { recursive: true });

    return new Promise<GitResult>((resolve, reject) => {
      if (invocation.signal?.aborted) return reject(new GitError("canceled", `git ${subcommand} canceled`));

      const child = spawn(this.executable, argv, {
        shell: false,
        // A constructed environment, not the parent's. Next.js types require
        // NODE_ENV on ProcessEnv, which Git deliberately does not receive.
        env: env as NodeJS.ProcessEnv,
        cwd: this.home,
        stdio: [invocation.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        detached: true,
        windowsHide: true,
      });

      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderr = "";
      let failure: GitError | null = null;
      let settled = false;

      const stop = (error: GitError) => {
        if (failure) return;
        failure = error;
        terminate(child.pid);
      };

      const timer = setTimeout(() => stop(new GitError("timeout", `git ${subcommand} exceeded the ${this.timeoutMs / 1_000}s timeout`)), this.timeoutMs);
      const onAbort = () => stop(new GitError("canceled", `git ${subcommand} canceled`));
      invocation.signal?.addEventListener("abort", onAbort, { once: true });

      if (invocation.input !== undefined && child.stdin) {
        child.stdin.on("error", () => {}); // the child may exit before reading everything
        child.stdin.end(invocation.input);
      }
      child.stdout!.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > outputLimit) return stop(new GitError("output_limit_exceeded", `git ${subcommand} produced more than ${outputLimit} bytes`));
        stdout.push(chunk);
      });
      child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
        if (stderr.length < STDERR_LIMIT) stderr += chunk;
      });

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        invocation.signal?.removeEventListener("abort", onAbort);
        callback();
      };

      child.on("error", (error: NodeJS.ErrnoException) => {
        finish(() => reject(new GitError("git_unavailable", `The Git executable could not be started (${error.code ?? error.name})`)));
      });

      child.on("close", (code, signal) => {
        finish(() => {
          const safeStderr = redact(stderr);
          if (failure) return reject(failure);
          if (code !== 0) {
            return reject(new GitError("command_failed", `git ${subcommand} failed (${code === null ? `signal ${signal}` : `exit ${code}`}): ${safeStderr.trim()}`, code, safeStderr));
          }
          resolve({ stdout: Buffer.concat(stdout), stderr: safeStderr });
        });
      });
    });
  }
}

function rejected(message: string): GitError {
  return new GitError("command_rejected", message);
}

// Signals the child's whole process group, escalating to SIGKILL.
function terminate(pid: number | undefined): void {
  if (pid === undefined) return;
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      // The process group has already exited.
    }
  };
  signalGroup("SIGTERM");
  setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS).unref();
}
