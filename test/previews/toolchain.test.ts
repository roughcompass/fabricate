import { describe, expect, it } from "vitest";
import type { BuildPlan } from "@/lib/previews/eligibility";
import { baseAdapter, buildArguments, buildEnvironment, inheritedConfigFiles, installArguments, managerCommand, previewBasePath, shimCommand, usesCorepack } from "@/lib/previews/toolchain";

/*
 * How a preview build calls the repository's toolchain (design decisions 4
 * and 5): the declared package manager version through corepack, a frozen
 * lockfile, the base path in the form each build tool expects, and an
 * environment built only from an allowlist.
 */

type Manager = BuildPlan["packageManager"];
const npm: Manager = { name: "npm", version: null, lockfile: "package-lock.json" };
const npmPinned: Manager = { name: "npm", version: "10.9.0", lockfile: "package-lock.json" };
const pnpm: Manager = { name: "pnpm", version: "9.1.0", lockfile: "pnpm-lock.yaml" };
const yarnClassic: Manager = { name: "yarn", version: null, lockfile: "yarn.lock" };
const yarnBerry: Manager = { name: "yarn", version: "4.5.1", lockfile: "yarn.lock" };
const BIN = "/opt/node-22/bin";
const BASE = previewBasePath("pvw_abcdefghijklmnop");

describe("preview toolchain", () => {
  it("serves each preview under its own path", () => {
    expect(BASE).toBe("/previews/pvw_abcdefghijklmnop/");
  });

  it("runs Node's own npm, or corepack with the version the install root declares", () => {
    expect(managerCommand(npm, BIN)).toEqual({ command: "/opt/node-22/bin/npm", args: [] });
    expect(managerCommand(npmPinned, BIN)).toEqual({ command: "/opt/node-22/bin/corepack", args: ["npm@10.9.0"] });
    expect(managerCommand(pnpm, BIN)).toEqual({ command: "/opt/node-22/bin/corepack", args: ["pnpm@9.1.0"] });
    expect(managerCommand(yarnClassic, BIN)).toEqual({ command: "/opt/node-22/bin/corepack", args: ["yarn"] });
    expect([npm, npmPinned, pnpm, yarnClassic].map(usesCorepack)).toEqual([false, true, true, true]);
    expect(shimCommand(pnpm, BIN, "/scratch/shims")).toEqual({ command: "/opt/node-22/bin/corepack", args: ["enable", "--install-directory", "/scratch/shims", "pnpm"] });
  });

  it("installs in frozen-lockfile mode for every manager", () => {
    expect(installArguments(npm)).toEqual(["ci"]);
    expect(installArguments(pnpm)).toEqual(["install", "--frozen-lockfile"]);
    expect(installArguments(yarnClassic)).toEqual(["install", "--frozen-lockfile"]);
    expect(installArguments({ ...yarnClassic, version: "1.22.22" })).toEqual(["install", "--frozen-lockfile"]);
    expect(installArguments(yarnBerry)).toEqual(["install", "--immutable"]);
  });

  it("names the configuration files Yarn reads from every directory above the install, which npm and pnpm don't", () => {
    expect(inheritedConfigFiles(yarnClassic)).toEqual([".npmrc", ".yarnrc"]);
    expect(inheritedConfigFiles({ ...yarnClassic, version: "1.22.22" })).toEqual([".npmrc", ".yarnrc"]);
    expect(inheritedConfigFiles(yarnBerry)).toEqual([".yarnrc.yml"]);
    expect([npm, npmPinned, pnpm].map(inheritedConfigFiles)).toEqual([[], [], []]);
  });

  it("passes Vite the base path as an argument to the build script's last command", () => {
    const vite = baseAdapter("vite", BASE);
    expect(vite).toEqual({ args: ["--base=/previews/pvw_abcdefghijklmnop/"], env: {} });
    expect(buildArguments(npm, vite.args)).toEqual(["run", "build", "--", "--base=/previews/pvw_abcdefghijklmnop/"]);
    expect(buildArguments(pnpm, vite.args)).toEqual(["run", "build", "--base=/previews/pvw_abcdefghijklmnop/"]);
    expect(buildArguments(yarnBerry, vite.args)).toEqual(["run", "build", "--base=/previews/pvw_abcdefghijklmnop/"]);
  });

  it("gives webpack, Rspack, and Rsbuild the base path in the variables their configurations may read", () => {
    for (const tool of ["webpack", "rspack", "rsbuild"] as const) {
      expect(baseAdapter(tool, BASE)).toEqual({ args: [], env: { ASSET_PATH: BASE, PUBLIC_PATH: BASE } });
    }
    expect(buildArguments(npm, [])).toEqual(["run", "build"]);
  });

  describe("environment", () => {
    const options = { nodeBin: BIN, home: "/scratch/home", tmp: "/scratch/tmp", cache: "/previews/.cache" };

    it("is built from the allowlist alone, with the base path and NODE_ENV only for the build", () => {
      const install = buildEnvironment({ ...options, manager: npm, shims: null, step: "install", base: { PUBLIC_PATH: BASE } });
      expect(install).toEqual({
        PATH: "/opt/node-22/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        HOME: "/scratch/home",
        TMPDIR: "/scratch/tmp",
        CI: "1",
        COREPACK_HOME: "/previews/.cache/corepack",
        COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
        COREPACK_ENABLE_AUTO_PIN: "0",
        npm_config_cache: "/previews/.cache/npm",
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_update_notifier: "false",
      });
      const build = buildEnvironment({ ...options, manager: npm, shims: null, step: "build", base: { PUBLIC_PATH: BASE } });
      expect(build).toEqual({ ...install, PUBLIC_PATH: BASE, NODE_ENV: "production" });
    });

    it("never takes anything from the worker's environment", () => {
      process.env.FRONTEND_REGISTRY_SECRET_TOKEN = "frontend-registry-secret";
      process.env.GIT_ASKPASS = "/usr/local/bin/askpass";
      process.env.VERCEL_TOKEN = "vercel-secret";
      process.env.npm_config__authToken = "registry-secret";
      try {
        const env = buildEnvironment({ ...options, manager: pnpm, shims: "/scratch/shims", step: "build" });
        expect(Object.keys(env).filter((key) => /^(FRONTEND_REGISTRY|GIT|VERCEL|AI)_/.test(key))).toEqual([]);
        expect(JSON.stringify(env)).not.toMatch(/secret|askpass/);
      } finally {
        for (const key of ["FRONTEND_REGISTRY_SECRET_TOKEN", "GIT_ASKPASS", "VERCEL_TOKEN", "npm_config__authToken"]) delete process.env[key];
      }
    });

    it("puts corepack's shims first and shares each manager's cache under .cache/<manager>", () => {
      const pnpmEnv = buildEnvironment({ ...options, manager: pnpm, shims: "/scratch/shims", step: "install" });
      expect(pnpmEnv.PATH!.split(":").slice(0, 2)).toEqual(["/scratch/shims", BIN]);
      expect(pnpmEnv).toMatchObject({ npm_config_store_dir: "/previews/.cache/pnpm/store", pnpm_config_store_dir: "/previews/.cache/pnpm/store" });
      expect(buildEnvironment({ ...options, manager: yarnClassic, shims: "/scratch/shims", step: "install" })).toMatchObject({ YARN_CACHE_FOLDER: "/previews/.cache/yarn/classic" });
      const berry = buildEnvironment({ ...options, manager: yarnBerry, shims: "/scratch/shims", step: "install" });
      expect(berry).toMatchObject({ YARN_GLOBAL_FOLDER: "/previews/.cache/yarn/berry" });
      expect(berry).not.toHaveProperty("YARN_CACHE_FOLDER");
    });
  });
});
