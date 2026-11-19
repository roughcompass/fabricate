import path from "node:path";
import semver from "semver";
import type { BuildPlan, BuildTool } from "./eligibility";

/**
 * How a preview build invokes the repository's own toolchain (design
 * decisions 4 and 5), as pure functions of its build plan: the package
 * manager at the version the install root declares, through corepack, in
 * frozen-lockfile mode; the package's `build` script with the preview's base
 * path set the way its build tool expects; and an environment built from an
 * allowlist, never inherited, so no Frontend Registry credential, token, or setting
 * reaches the build.
 */

type PackageManagerPlan = BuildPlan["packageManager"];

/** System tools a build may call, after the chosen Node and its corepack shims. */
const SYSTEM_PATH = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/** An executable and the arguments it starts with. */
export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
}

/** The URL path a preview is served under, which its build is told to use (design decision 1). */
export function previewBasePath(publicId: string): string {
  return `/previews/${publicId}/`;
}

/**
 * Whether the package manager runs through corepack: pnpm and Yarn always,
 * and npm only when the install root declares a version, since Node's own
 * npm is the manager's version otherwise.
 */
export function usesCorepack(manager: PackageManagerPlan): boolean {
  return manager.name !== "npm" || manager.version !== null;
}

/** The package manager as a command: Node's own npm, or corepack with the declared version. */
export function managerCommand(manager: PackageManagerPlan, nodeBin: string): Invocation {
  if (!usesCorepack(manager)) return { command: path.join(nodeBin, "npm"), args: [] };
  return { command: path.join(nodeBin, "corepack"), args: [manager.version ? `${manager.name}@${manager.version}` : manager.name] };
}

/** Installs corepack's shims for the manager into +directory+, so scripts that call it by name get the same version. */
export function shimCommand(manager: PackageManagerPlan, nodeBin: string, directory: string): Invocation {
  return { command: path.join(nodeBin, "corepack"), args: ["enable", "--install-directory", directory, manager.name] };
}

/** Frozen-lockfile install arguments: the install fails rather than change the lockfile. */
export function installArguments(manager: PackageManagerPlan): string[] {
  switch (manager.name) {
    case "npm":
      return ["ci"];
    case "pnpm":
      return ["install", "--frozen-lockfile"];
    case "yarn":
      return isYarnClassic(manager) ? ["install", "--frozen-lockfile"] : ["install", "--immutable"];
  }
}

/**
 * The manager's own command that empties its package cache (design decision
 * 8): `npm cache clean --force`, `pnpm store prune`, which removes every
 * package no install still links to (none, once the build's working tree is
 * gone), and `yarn cache clean`, with `--mirror` for Yarn's global cache
 * after version 1.
 */
export function cacheCleanArguments(manager: PackageManagerPlan): string[] {
  switch (manager.name) {
    case "npm":
      return ["cache", "clean", "--force"];
    case "pnpm":
      return ["store", "prune"];
    case "yarn":
      return isYarnClassic(manager) ? ["cache", "clean"] : ["cache", "clean", "--mirror"];
  }
}

/**
 * The configuration files the manager reads from every directory above the
 * one it installs in, up to the filesystem root, not only from the install
 * root and HOME: Yarn 1's `.npmrc` and `.yarnrc`, and later Yarn's
 * `.yarnrc.yml`. npm and pnpm read only the install root's and HOME's, and a
 * build's HOME is its own.
 */
export function inheritedConfigFiles(manager: PackageManagerPlan): string[] {
  if (manager.name !== "yarn") return [];
  return isYarnClassic(manager) ? [".npmrc", ".yarnrc"] : [".yarnrc.yml"];
}

/** Runs the package's `build` script with +extra+ appended, which every manager passes to the script's last command. */
export function buildArguments(manager: PackageManagerPlan, extra: readonly string[]): string[] {
  if (extra.length === 0) return ["run", "build"];
  // npm passes only the arguments after `--`; pnpm and Yarn pass everything after the script's name.
  return manager.name === "npm" ? ["run", "build", "--", ...extra] : ["run", "build", ...extra];
}

/** How the base path reaches each build tool (design decision 5). */
export function baseAdapter(tool: BuildTool, base: string): { args: string[]; env: Record<string, string> } {
  switch (tool) {
    case "vite":
      return { args: [`--base=${base}`], env: {} };
    case "webpack":
    case "rspack":
    case "rsbuild":
      // Only configurations that read them use these; a Module Federation remote's `publicPath: "auto"` needs neither.
      return { args: [], env: { ASSET_PATH: base, PUBLIC_PATH: base } };
  }
}

export interface EnvironmentOptions {
  readonly manager: PackageManagerPlan;
  readonly nodeBin: string;
  /** Corepack's shims for the manager, when it runs through corepack. */
  readonly shims: string | null;
  /** The build's own HOME and TMPDIR. */
  readonly home: string;
  readonly tmp: string;
  /** Package caches shared across builds: storage/previews/.cache. */
  readonly cache: string;
  readonly step: "install" | "build";
  /** Base-path variables, for the build step. */
  readonly base?: Readonly<Record<string, string>>;
}

/**
 * The complete environment of an install or build. Only what's listed here
 * is passed: PATH, a per-build HOME and TMPDIR, CI=1, corepack's and the
 * package manager's cache locations, and, for the build step only, the
 * base-path variables and NODE_ENV=production. Nothing comes from the
 * worker's environment, so FRONTEND_REGISTRY_*, GIT_*, VERCEL_*, AI_*, npm_config_*,
 * and every other variable stay behind.
 */
export function buildEnvironment(options: EnvironmentOptions): Record<string, string> {
  const { manager, cache } = options;
  const env: Record<string, string> = {
    PATH: [...(options.shims ? [options.shims] : []), options.nodeBin, ...SYSTEM_PATH].join(":"),
    HOME: options.home,
    TMPDIR: options.tmp,
    CI: "1",
    COREPACK_HOME: path.join(cache, "corepack"),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    // Corepack would otherwise add a packageManager field to a manifest without one.
    COREPACK_ENABLE_AUTO_PIN: "0",
    ...managerCache(manager, cache),
  };
  if (options.step === "build") Object.assign(env, options.base ?? {}, { NODE_ENV: "production" });
  return env;
}

/** Where the manager keeps its package cache, shared across builds under .cache/<manager>. */
function managerCache(manager: PackageManagerPlan, cache: string): Record<string, string> {
  const root = path.join(cache, manager.name);
  switch (manager.name) {
    case "npm":
      return { npm_config_cache: root, npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
    case "pnpm":
      // pnpm reads its settings from either prefix, depending on its version.
      return {
        npm_config_store_dir: path.join(root, "store"),
        pnpm_config_store_dir: path.join(root, "store"),
        npm_config_cache_dir: path.join(root, "cache"),
        pnpm_config_cache_dir: path.join(root, "cache"),
        npm_config_update_notifier: "false",
      };
    case "yarn":
      // Yarn classic caches in YARN_CACHE_FOLDER; later versions keep their global cache in YARN_GLOBAL_FOLDER, and a project's own cache folder is left alone.
      return isYarnClassic(manager) ? { YARN_CACHE_FOLDER: path.join(root, "classic") } : { YARN_GLOBAL_FOLDER: path.join(root, "berry"), YARN_ENABLE_TELEMETRY: "0" };
  }
}

/** Yarn 1.x, which is also corepack's default Yarn when the install root declares none. */
function isYarnClassic(manager: PackageManagerPlan): boolean {
  return manager.version === null || semver.major(manager.version) < 2;
}
