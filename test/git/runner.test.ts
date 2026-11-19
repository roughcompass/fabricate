import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FabricateConfig, getConfig, withOverrides } from "@/lib/config";
import { GitError } from "@/lib/git/errors";
import { GitRunner, type Invocation } from "@/lib/git/runner";
import { type RecordingGit, recordingGit } from "../support/fake-git";

const BASE = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "core.symlinks=false",
  "-c", "submodule.recurse=false",
  "-c", "fetch.recurseSubmodules=false",
  "-c", "fetch.fsckObjects=true",
  "-c", "transfer.fsckObjects=true",
  "-c", "gc.auto=0",
  "-c", "maintenance.auto=false",
  "-c", "protocol.allow=never",
  "-c", "credential.helper=",
];

describe("GitRunner", () => {
  let storage: string;
  let config: FabricateConfig;
  let fake: RecordingGit;
  let gitDir: string;
  const saved = { secret: process.env.FRONTEND_REGISTRY_TEST_SECRET, proxy: process.env.HTTPS_PROXY, agent: process.env.SSH_AUTH_SOCK };

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runner-storage-")));
    config = withOverrides(getConfig(), { repositoryStorage: storage, gitCredentialHelper: "osxkeychain" });
    gitDir = path.join(storage, "src_aaaaaaaaaaaaaaaa.git");
    process.env.FRONTEND_REGISTRY_TEST_SECRET = "parent-process-secret";
    process.env.HTTPS_PROXY = "http://proxy.example.com:3128";
    process.env.SSH_AUTH_SOCK = "/tmp/agent.sock";
  });

  afterEach(() => {
    fake?.cleanup();
    fs.rmSync(storage, { recursive: true, force: true });
    for (const [key, value] of [["FRONTEND_REGISTRY_TEST_SECRET", saved.secret], ["HTTPS_PROXY", saved.proxy], ["SSH_AUTH_SOCK", saved.agent]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const runner = (body?: string, options: { timeoutMs?: number } = {}) => {
    fake = recordingGit(body);
    return new GitRunner({ executable: fake.executable, config, timeoutMs: options.timeoutMs });
  };

  describe("accepted operations", () => {
    it("runs version with only the base configuration", async () => {
      await runner('echo "git version 2.50.1"').version();
      expect(fake.argv()).toEqual([...BASE, "version"]);
    });

    it("initializes a managed bare repository without templates", async () => {
      await runner().initBare(gitDir);
      expect(fake.argv()).toEqual([...BASE, "init", "--bare", "--quiet", "--template=", "--end-of-options", gitDir]);
    });

    it("lists HTTPS remote refs with only the HTTPS transport and the configured credential helper", async () => {
      await runner().lsRemote("https://git.example.com/acme/orders.git", "https");

      expect(fake.argv()).toEqual([
        ...BASE,
        "-c", "protocol.https.allow=always",
        "-c", "credential.helper=osxkeychain",
        "ls-remote", "--symref", "--end-of-options", "https://git.example.com/acme/orders.git", "HEAD", "refs/heads/*", "refs/tags/*",
      ]);
      expect(fake.env()).toMatchObject({ GIT_ALLOW_PROTOCOL: "https", HTTPS_PROXY: "http://proxy.example.com:3128", GIT_TERMINAL_PROMPT: "0" });
      expect(fake.env()).not.toHaveProperty("SSH_AUTH_SOCK");
    });

    it("fetches over SSH with batch-mode SSH, the agent socket, and refspecs after --end-of-options", async () => {
      await runner().fetch(gitDir, "ssh://git@git.example.com/acme/orders.git", ["+refs/heads/main:refs/fabricate/fetch/main"], "ssh", { shallow: true });

      expect(fake.argv()).toEqual([
        ...BASE,
        "-c", "protocol.ssh.allow=always",
        `--git-dir=${gitDir}`,
        "fetch", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head", "--no-auto-gc", "--no-auto-maintenance", "--quiet", "--force", "--depth=1",
        "--end-of-options", "ssh://git@git.example.com/acme/orders.git", "+refs/heads/main:refs/fabricate/fetch/main",
      ]);
      expect(fake.env()).toMatchObject({ GIT_ALLOW_PROTOCOL: "ssh", GIT_SSH_COMMAND: "ssh -o BatchMode=yes", SSH_AUTH_SOCK: "/tmp/agent.sock" });
      expect(fake.env()).not.toHaveProperty("HTTPS_PROXY");
    });

    it("gives Git a constructed environment and never the parent's", async () => {
      await runner().fetch(gitDir, "file:///srv/fleet/orders", ["HEAD"], "file");

      expect(Object.keys(fake.env()).filter((key) => !["PWD", "SHLVL", "_", "OLDPWD"].includes(key)).sort()).toEqual([
        "GIT_ALLOW_PROTOCOL", "GIT_ATTR_NOSYSTEM", "GIT_CEILING_DIRECTORIES", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_NO_LAZY_FETCH",
        "GIT_NO_REPLACE_OBJECTS", "GIT_PROTOCOL_FROM_USER", "GIT_TERMINAL_PROMPT", "HOME", "LANG", "LC_ALL", "PATH", "SSH_ASKPASS_REQUIRE", "TMPDIR",
      ]);
      expect(fake.env()).toMatchObject({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_NO_LAZY_FETCH: "1", HOME: path.join(storage, ".git-home") });
      expect(JSON.stringify(fake.env())).not.toContain("parent-process-secret");
    });

    it("sends batch object ids on stdin rather than as arguments", async () => {
      const ids = ["a".repeat(40), "b".repeat(40)];
      await runner().catFileBatch(gitDir, ids);

      expect(fake.argv()).toEqual([...BASE, `--git-dir=${gitDir}`, "cat-file", "--batch"]);
      expect(fake.stdin()).toBe(`${ids[0]}\n${ids[1]}\n`);
    });

    it("passes shell metacharacters through literally without interpreting them", async () => {
      const sentinel = path.join(storage, "pwned");
      await runner().revParse(gitDir, `main$(touch ${sentinel});echo\`id\``);

      expect(fake.argv().at(-1)).toBe(`main$(touch ${sentinel});echo\`id\``);
      expect(fs.existsSync(sentinel)).toBe(false);
    });
  });

  describe("rejected operations", () => {
    const invocations: [string, () => Invocation][] = [
      ["an unlisted subcommand", () => ({ subcommand: "config", positionals: ["core.hooksPath"] })],
      ["clone", () => ({ subcommand: "clone", positionals: ["https://git.example.com/a"] })],
      ["checkout", () => ({ subcommand: "checkout", positionals: ["main"], gitDir })],
      ["submodule", () => ({ subcommand: "submodule", positionals: ["update"] })],
      ["upload-pack", () => ({ subcommand: "upload-pack", positionals: ["/srv/x"] })],
      ["--upload-pack", () => ({ subcommand: "fetch", options: ["--upload-pack=touch pwned"], positionals: ["https://git.example.com/a"], gitDir, protocol: "https" })],
      ["a -c override", () => ({ subcommand: "rev-parse", options: ["-c"], positionals: ["core.hooksPath=/tmp/hooks"], gitDir })],
      ["a hooks template", () => ({ subcommand: "init", options: ["--template=/tmp/hooks"], positionals: [gitDir] })],
      ["an unlisted depth", () => ({ subcommand: "fetch", options: ["--depth=999"], positionals: ["https://git.example.com/a"], gitDir, protocol: "https" })],
      ["an option-like positional", () => ({ subcommand: "rev-parse", positionals: ["--output=/tmp/x"], gitDir })],
      ["a control character", () => ({ subcommand: "rev-parse", positionals: ["main\nHEAD"], gitDir })],
      ["an empty positional", () => ({ subcommand: "rev-parse", positionals: [""], gitDir })],
      ["a network command without a protocol", () => ({ subcommand: "ls-remote", positionals: ["https://git.example.com/a"] })],
      ["an unlisted protocol", () => ({ subcommand: "ls-remote", positionals: ["https://git.example.com/a"], protocol: "ext" as never })],
      ["a protocol on a local command", () => ({ subcommand: "rev-parse", positionals: ["HEAD"], gitDir, protocol: "https" })],
      ["a URL that does not match the protocol", () => ({ subcommand: "ls-remote", positionals: ["ssh://git.example.com/a"], protocol: "https" })],
      ["a noncanonical URL", () => ({ subcommand: "ls-remote", positionals: ["https://GIT.example.com/a"], protocol: "https" })],
      ["a transport-command URL", () => ({ subcommand: "ls-remote", positionals: ["ext::sh"], protocol: "https" })],
      ["a repository outside storage", () => ({ subcommand: "rev-parse", positionals: ["HEAD"], gitDir: "/tmp/elsewhere.git" })],
      ["a relative repository path", () => ({ subcommand: "rev-parse", positionals: ["HEAD"], gitDir: "relative.git" })],
      ["a traversing repository path", () => ({ subcommand: "rev-parse", positionals: ["HEAD"], gitDir: `${storage}/../escape.git` })],
      ["storage itself", () => ({ subcommand: "rev-parse", positionals: ["HEAD"], gitDir: storage })],
      ["a repository command without a repository", () => ({ subcommand: "ls-tree", positionals: ["HEAD"] })],
      ["a repository on a global command", () => ({ subcommand: "version", gitDir })],
    ];

    it.each(invocations)("rejects %s before starting Git", async (_label, invocation) => {
      const git = runner();
      await expect(git.run(invocation())).rejects.toMatchObject({ code: "command_rejected" });
      expect(fs.existsSync(path.join(path.dirname(fake.executable), "argv"))).toBe(false);
    });

    it("rejects abbreviated ids for batch reads", async () => {
      await expect(runner().catFileBatch(gitDir, ["abc123"])).rejects.toMatchObject({ code: "command_rejected" });
    });
  });

  describe("execution", () => {
    it("terminates a command that exceeds the timeout", async () => {
      const git = runner("sleep 30", { timeoutMs: 1_000 });
      await expect(git.version()).rejects.toMatchObject({ code: "timeout" });

      // The fake records its pid first; a pid of 0 would signal this test's own process group.
      const pid = fake.pid();
      expect(pid).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(() => process.kill(pid, 0)).toThrow();
    });

    it("cancels a running command", async () => {
      const controller = new AbortController();
      const running = runner("sleep 30").lsRemote("https://git.example.com/acme/orders.git", "https", controller.signal);
      setTimeout(() => controller.abort(), 100);

      await expect(running).rejects.toMatchObject({ code: "canceled" });
    });

    it("stops a command whose output exceeds the limit", async () => {
      const git = runner("head -c 2000000 /dev/zero");
      await expect(git.run({ subcommand: "cat-file", options: ["-t"], positionals: ["a".repeat(40)], gitDir, outputLimit: 1_024 })).rejects.toMatchObject({ code: "output_limit_exceeded" });
    });

    it("redacts credentials from a failing command's diagnostics", async () => {
      const error = (await runner('echo "fatal: unable to access https://user:hunter2@git.example.com/: Authorization: Bearer abc" >&2; exit 128')
        .lsRemote("https://git.example.com/acme/orders.git", "https")
        .catch((caught: unknown) => caught)) as GitError;

      expect(error).toMatchObject({ code: "command_failed", exitCode: 128 });
      expect(error.message).not.toContain("hunter2");
      expect(error.stderr).not.toContain("abc");
    });

    it("reports a revision that does not resolve as missing", async () => {
      expect(await runner("exit 1").revParse(gitDir, "refs/heads/missing")).toBeNull();
    });

    it("reports a missing executable as unavailable", async () => {
      await expect(new GitRunner({ executable: "/nonexistent/git", config }).version()).rejects.toMatchObject({ code: "git_unavailable" });
    });
  });
});
