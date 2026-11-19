import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FabricateConfig, getConfig, withOverrides } from "@/lib/config";
import { type CheckCommand, type CheckRunner, checkToolchain, formatCheck, summarize } from "@/lib/previews/doctor";

/*
 * `npm run previews:doctor` (design decision 10): every configured Node
 * version reports itself and runs pnpm and Yarn through its corepack, in a
 * build's install environment, and git and tar are where the worker finds
 * them. The commands are stubbed; only the files they'd run are real.
 */

describe("preview toolchain doctor", () => {
  let directory: string;
  let storage: string;
  let tools: string;
  let calls: CheckCommand[];

  beforeEach(() => {
    directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-doctor-")));
    storage = path.join(directory, "previews");
    tools = path.join(directory, "tools");
    for (const tool of ["git", "tar"]) executable(path.join(tools, tool));
    calls = [];
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  function executable(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "", { mode: 0o755 });
  }

  /** A Node install's bin directory holding node, and corepack unless +corepack+ is false. */
  function install(version: string, options: { corepack?: boolean } = {}): string {
    const bin = path.join(directory, "node", version, "bin");
    executable(path.join(bin, "node"));
    if (options.corepack !== false) executable(path.join(bin, "corepack"));
    return bin;
  }

  const configWith = (nodeVersions: Record<string, string>): FabricateConfig => withOverrides(getConfig(), { previews: { nodeVersions, storage } });

  /** Answers each command by its name and first argument, as +answers+ say; anything else exits 0 with a version. */
  function runner(answers: Record<string, { code?: number; output: string } | Error> = {}): CheckRunner {
    return async (command) => {
      calls.push(command);
      const key = [path.basename(command.command), command.args[0]].join(" ");
      const answer = answers[key] ?? answers[path.basename(command.command)];
      if (answer instanceof Error) throw answer;
      const defaults: Record<string, string> = { "corepack pnpm": "10.4.1\n", "corepack yarn": "1.22.22\n", "git --version": "git version 2.50.1\n", "tar --version": "bsdtar 3.5.3\n" };
      return { result: { outcome: "exited", code: answer?.code ?? 0, signal: null }, output: answer?.output ?? defaults[key] ?? "" };
    };
  }

  const check = (config: FabricateConfig, run: CheckRunner) => checkToolchain(config, { run, gitPath: tools, tarPath: tools });

  it("passes a Node version that reports itself and runs pnpm and Yarn through its corepack", async () => {
    const bin = install("24.22.0");
    const checks = await check(configWith({ "24.22.0": bin }), runner({ "node --version": { output: "v24.22.0\n" }, "corepack pnpm": { output: "Downloading the pnpm 10.4.1 binary for darwin-arm64...\n10.4.1\n" } }));

    expect(checks).toEqual([
      { subject: "Node 24.22.0", status: "ok", detail: `${bin}/node reports v24.22.0` },
      { subject: "Node 24.22.0 pnpm", status: "ok", detail: "corepack runs pnpm 10.4.1" },
      { subject: "Node 24.22.0 Yarn", status: "ok", detail: "corepack runs Yarn 1.22.22" },
      { subject: "git", status: "ok", detail: `${tools}/git, git version 2.50.1` },
      { subject: "tar", status: "ok", detail: `${tools}/tar, bsdtar 3.5.3` },
    ]);
    expect(summarize(checks)).toBe("All 5 checks passed.");
    expect(calls.map((call) => [path.basename(call.command), ...call.args].join(" "))).toEqual(["node --version", "corepack pnpm --version", "corepack yarn --version", "git --version", "tar --version"]);
  });

  it("runs corepack in a build's install environment, with caches under preview storage and a throwaway HOME", async () => {
    const bin = install("24.22.0");
    const secret = "FABRICATE_SECRET_TOKEN";
    process.env[secret] = "doctor-secret";
    try {
      await check(configWith({ "24.22.0": bin }), runner({ "node --version": { output: "v24.22.0\n" } }));
    } finally {
      delete process.env[secret];
    }

    const pnpm = calls.find((call) => call.args[0] === "pnpm")!;
    expect(pnpm.command).toBe(path.join(bin, "corepack"));
    expect(pnpm.env).toMatchObject({ COREPACK_HOME: path.join(storage, ".cache", "corepack"), COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", CI: "1", pnpm_config_store_dir: path.join(storage, ".cache", "pnpm", "store") });
    expect(pnpm.env.PATH!.split(":")[0]).toBe(bin);
    expect(pnpm.env.HOME).not.toBe(os.homedir());
    expect(pnpm.cwd).toBe(pnpm.env.HOME);
    expect(Object.keys(pnpm.env).filter((key) => key.startsWith("FABRICATE_") || key === "NODE_ENV")).toEqual([]);
    expect(calls.find((call) => call.args[0] === "yarn")!.env).toMatchObject({ YARN_CACHE_FOLDER: path.join(storage, ".cache", "yarn", "classic") });
    // The throwaway HOME is gone afterwards.
    expect(fs.existsSync(pnpm.env.HOME!)).toBe(false);
  });

  it("names a configured version whose directory has no node, and skips its package managers", async () => {
    const bin = install("24.22.0");
    const checks = await check(configWith({ "24.22.0": bin, "22.11.0": "/nonexistent/node-22/bin" }), runner({ "node --version": { output: "v24.22.0\n" } }));

    expect(checks.slice(0, 3)).toEqual([
      { subject: "Node 22.11.0", status: "failed", detail: "/nonexistent/node-22/bin has no node executable" },
      { subject: "Node 22.11.0 pnpm", status: "skipped", detail: "needs Node 22.11.0's node to run" },
      { subject: "Node 22.11.0 Yarn", status: "skipped", detail: "needs Node 22.11.0's node to run" },
    ]);
    expect(checks.slice(3).every((entry) => entry.status === "ok")).toBe(true);
    expect(summarize(checks)).toBe("1 of 8 checks failed: Node 22.11.0.");
    expect(calls.filter((call) => call.command.startsWith("/nonexistent"))).toEqual([]);
  });

  it("fails a directory whose node reports another version", async () => {
    const bin = install("24.22.0");
    const checks = await check(configWith({ "22.11.0": bin }), runner({ "node --version": { output: "v24.22.0\n" } }));
    expect(checks[0]).toEqual({ subject: "Node 22.11.0", status: "failed", detail: `${bin}/node reports v24.22.0, not v22.11.0` });
    // Its corepack is still checked.
    expect(checks[1]).toMatchObject({ subject: "Node 22.11.0 pnpm", status: "ok" });
  });

  it("fails a node that doesn't run", async () => {
    const bin = install("24.22.0");
    const checks = await check(configWith({ "24.22.0": bin }), runner({ "node --version": { code: 1, output: "dyld: Library not loaded\n" } }));
    expect(checks[0]).toEqual({ subject: "Node 24.22.0", status: "failed", detail: `${bin}/node --version exited with code 1: dyld: Library not loaded` });
    expect(checks[1]).toMatchObject({ status: "skipped" });
  });

  it("names a Node install without corepack", async () => {
    const bin = install("25.2.0", { corepack: false });
    const checks = await check(configWith({ "25.2.0": bin }), runner({ "node --version": { output: "v25.2.0\n" } }));
    expect(checks.slice(1, 3)).toEqual([
      { subject: "Node 25.2.0 pnpm", status: "failed", detail: `${bin} has no corepack, which builds that install with pnpm or Yarn need` },
      { subject: "Node 25.2.0 Yarn", status: "failed", detail: `${bin} has no corepack, which builds that install with pnpm or Yarn need` },
    ]);
  });

  it("reports corepack's own error when it can't run a package manager", async () => {
    const bin = install("24.22.0");
    const checks = await check(
      configWith({ "24.22.0": bin }),
      runner({ "node --version": { output: "v24.22.0\n" }, "corepack pnpm": { code: 1, output: "Internal Error: Error when performing the request to https://registry.npmjs.org/pnpm/latest\n    at fetch\n" }, "corepack yarn": { output: "\n" } }),
    );
    expect(checks[1]).toEqual({ subject: "Node 24.22.0 pnpm", status: "failed", detail: "corepack pnpm --version exited with code 1: Internal Error: Error when performing the request to https://registry.npmjs.org/pnpm/latest / at fetch" });
    expect(checks[2]).toEqual({ subject: "Node 24.22.0 Yarn", status: "failed", detail: "corepack yarn --version printed nothing, not a version" });
  });

  it("says previews can't build anything with no Node versions configured, and still checks git and tar", async () => {
    const checks = await check(configWith({}), runner());
    expect(checks.map((entry) => [entry.subject, entry.status])).toEqual([
      ["previews.nodeVersions", "failed"],
      ["git", "ok"],
      ["tar", "ok"],
    ]);
    expect(checks[0]!.detail).toMatch(/^No Node versions are configured, so previews can't build anything\./);
  });

  it("names git or tar when it's missing or doesn't run", async () => {
    fs.rmSync(path.join(tools, "git"));
    const checks = await check(configWith({}), runner({ tar: new Error(`${tools}/tar could not be started (EACCES)`) }));
    expect(checks.slice(1)).toEqual([
      { subject: "git", status: "failed", detail: "git isn't in the worker's PATH" },
      { subject: "tar", status: "failed", detail: `${tools}/tar --version couldn't start: ${tools}/tar could not be started (EACCES)` },
    ]);
  });

  it("prints one line per check", () => {
    expect(formatCheck({ subject: "Node 22.11.0", status: "failed", detail: "/opt/node-22/bin has no node executable" })).toBe("FAIL Node 22.11.0: /opt/node-22/bin has no node executable");
    expect(formatCheck({ subject: "git", status: "ok", detail: "/usr/bin/git, git version 2.50.1" })).toBe("ok   git: /usr/bin/git, git version 2.50.1");
    expect(formatCheck({ subject: "Node 22.11.0 pnpm", status: "skipped", detail: "needs Node 22.11.0's node to run" })).toBe("skip Node 22.11.0 pnpm: needs Node 22.11.0's node to run");
  });
});
