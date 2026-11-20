import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { z } from "zod";
import { CloneUrl, InvalidCloneUrl } from "@/lib/repositories/clone-url";
import { LEGACY_NAMES } from "@/lib/legacy-names";

/**
 * Typed, immutable safety and analysis configuration.
 *
 * Values come from config/frontend-registry.json (a `shared` section merged
 * with the section for the current environment) and then FRONTEND_REGISTRY_*
 * environment variables. For one release, the file and variables under their
 * names from before the rename (src/lib/legacy-names.ts) are still read, with a
 * deprecation warning, where the new ones are missing. The harness
 * workspace's fleet-kit/ tree is appended to the denied roots
 * unconditionally: no file setting, environment variable, or override can
 * remove it, and an allowed root inside it is a configuration error.
 */

export const PROTECTED_DIRECTORY = "fleet-kit";

export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

const positiveInteger = z.int().positive();
const pathSetting = z.string().trim().min(1, "path settings must not be blank");

const settingsSchema = z.strictObject({
  allowedRoots: z.array(pathSetting),
  deniedRoots: z.array(pathSetting),
  gitTimeoutSeconds: positiveInteger,
  gitLockTimeoutSeconds: positiveInteger,
  workerConcurrency: positiveInteger,
  database: pathSetting,
  repositoryStorage: pathSetting,
  gitCredentialHelper: z.string().trim().min(1).nullable(),
  analysis: z.strictObject({
    maxBlobBytes: positiveInteger,
    // Lockfiles are often larger than any source file, so they have their own per-file limit.
    maxLockfileBytes: positiveInteger,
    maxFiles: positiveInteger,
    maxTotalBytes: positiveInteger,
  }),
  // How often the worker checks every repository's reference for a new
  // commit, and its current survey for an older recipe, to survey it again.
  profiling: z.strictObject({
    checkMinutes: positiveInteger,
  }),
  // The Reference Catalog (docs/reference-catalog.md): the npm registry
  // Catalog builds read published packages from. The things it describes
  // are in config/catalog.yaml, and their rules in config/catalog-rules/.
  catalog: z.strictObject({
    registry: z.url({ protocol: /^https?$/, error: "the catalog registry must be an http or https address" }),
  }),
  // Adoption Analytics: how many days apart adoption snapshots are taken,
  // and which share of used components, by fewest usages, counts as rarely
  // used, as a percentile.
  adoption: z.strictObject({
    snapshotDays: positiveInteger,
    rarelyUsedPercentile: z.int().min(1).max(100),
  }),
  // Repository previews (docs/previews.md): off by default. Only remotes
  // listed in trustedSources, by clone URL, can be previewed; nodeVersions
  // maps each Node version a build may use to its binary directory. Builds,
  // their logs, published output, and package caches live under storage.
  // browser is what captures applications' screenshots: Playwright's
  // Chromium when null, else a Playwright channel or a browser's path.
  // refCacheSeconds is how long preview mode reuses a remote's branches and
  // tags before reading them again; 0 reads them on every view.
  previews: z.strictObject({
    enabled: z.boolean(),
    browser: z
      .string()
      .trim()
      .min(1, "the preview browser must not be blank")
      .refine((value) => path.isAbsolute(value) || /^[a-z][a-z0-9-]*$/.test(value), "the preview browser must be a Playwright channel, such as chrome, or an absolute path")
      .nullable(),
    trustedSources: z.array(z.string().trim().min(1, "trusted sources must not be blank")),
    nodeVersions: z.record(z.string(), pathSetting),
    storage: pathSetting,
    concurrency: positiveInteger,
    timeoutMinutes: positiveInteger,
    maxOutputBytes: positiveInteger,
    maxStorageBytes: positiveInteger,
    refCacheSeconds: z.int().min(0),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

const fileSchema = z.strictObject({
  shared: settingsSchema,
  development: settingsSchema.partial().optional(),
  test: settingsSchema.partial().optional(),
  production: settingsSchema.partial().optional(),
});

export type Environment = "development" | "test" | "production";

/** The configuration file in config/. */
export const CONFIG_FILE = "frontend-registry.json";

const ENV_PREFIX = "FRONTEND_REGISTRY_";

/** Selects the environment's section of the configuration file, before NODE_ENV. */
export const ENVIRONMENT_VARIABLE = `${ENV_PREFIX}ENV`;

export const ENV_KEYS = {
  allowedRoots: "FRONTEND_REGISTRY_ALLOWED_ROOTS",
  deniedRoots: "FRONTEND_REGISTRY_DENIED_ROOTS",
  gitTimeoutSeconds: "FRONTEND_REGISTRY_GIT_TIMEOUT",
  gitLockTimeoutSeconds: "FRONTEND_REGISTRY_GIT_LOCK_TIMEOUT",
  workerConcurrency: "FRONTEND_REGISTRY_WORKER_CONCURRENCY",
  database: "FRONTEND_REGISTRY_DATABASE",
  repositoryStorage: "FRONTEND_REGISTRY_REPOSITORY_STORAGE",
  gitCredentialHelper: "FRONTEND_REGISTRY_GIT_CREDENTIAL_HELPER",
  maxBlobBytes: "FRONTEND_REGISTRY_MAX_BLOB_BYTES",
  maxLockfileBytes: "FRONTEND_REGISTRY_MAX_LOCKFILE_BYTES",
  maxFiles: "FRONTEND_REGISTRY_MAX_FILES",
  maxTotalBytes: "FRONTEND_REGISTRY_MAX_TOTAL_BYTES",
  profilingCheckMinutes: "FRONTEND_REGISTRY_PROFILING_CHECK_MINUTES",
  catalogRegistry: "FRONTEND_REGISTRY_CATALOG_REGISTRY",
  adoptionSnapshotDays: "FRONTEND_REGISTRY_ADOPTION_SNAPSHOT_DAYS",
  adoptionRarelyUsedPercentile: "FRONTEND_REGISTRY_ADOPTION_RARELY_USED_PERCENTILE",
  previewsEnabled: "FRONTEND_REGISTRY_PREVIEWS",
  previewsBrowser: "FRONTEND_REGISTRY_PREVIEWS_BROWSER",
  previewsTrustedSources: "FRONTEND_REGISTRY_PREVIEWS_TRUSTED_SOURCES",
  previewsNodeVersions: "FRONTEND_REGISTRY_PREVIEWS_NODE_VERSIONS",
  previewsStorage: "FRONTEND_REGISTRY_PREVIEWS_STORAGE",
  previewsConcurrency: "FRONTEND_REGISTRY_PREVIEWS_CONCURRENCY",
  previewsTimeoutMinutes: "FRONTEND_REGISTRY_PREVIEWS_TIMEOUT_MINUTES",
  previewsMaxOutputBytes: "FRONTEND_REGISTRY_PREVIEWS_MAX_OUTPUT_BYTES",
  previewsMaxStorageBytes: "FRONTEND_REGISTRY_PREVIEWS_MAX_STORAGE_BYTES",
  previewsRefCacheSeconds: "FRONTEND_REGISTRY_PREVIEWS_REF_CACHE_SECONDS",
} as const;

export interface AnalysisBudgets {
  readonly maxBlobBytes: number;
  readonly maxLockfileBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
}

/** Repository previews (docs/previews.md). */
export interface PreviewSettings {
  readonly enabled: boolean;
  /** What captures screenshots: Playwright's Chromium when null, else a Playwright channel such as chrome, or a browser executable's absolute path. */
  readonly browser: string | null;
  /** Enrolled remotes, as canonical clone URL identities; a Repository is enrolled only when its canonical URL is listed. */
  readonly trustedSources: readonly string[];
  /** Configured Node installs: normalized version → binary directory, resolved from the app root. */
  readonly nodeVersions: Readonly<Record<string, string>>;
  /** Where builds stage, and keep their logs, published output, and package caches; resolved from the app root. */
  readonly storage: string;
  readonly concurrency: number;
  readonly timeoutMinutes: number;
  readonly maxOutputBytes: number;
  readonly maxStorageBytes: number;
  /** How long preview mode reuses a remote's branches and tags, in seconds; 0 reads them on every view. */
  readonly refCacheSeconds: number;
}

export interface FrontendRegistryConfig {
  readonly environment: Environment;
  readonly appRoot: string;
  readonly workspaceRoot: string;
  readonly allowedRoots: readonly string[];
  /** Operator-configured roots followed by the mandatory protected roots. */
  readonly deniedRoots: readonly string[];
  readonly mandatoryDeniedRoots: readonly string[];
  readonly gitTimeoutSeconds: number;
  readonly gitLockTimeoutSeconds: number;
  readonly workerConcurrency: number;
  readonly database: string;
  readonly repositoryStorage: string;
  readonly gitCredentialHelper: string | null;
  readonly analysis: AnalysisBudgets;
  readonly profiling: { readonly checkMinutes: number };
  /** The Reference Catalog: the npm registry Catalog builds read from, ending in a slash. */
  readonly catalog: { readonly registry: string };
  /** Adoption Analytics: days between snapshots, and the percentile of used components, by fewest usages, that counts as rarely used. */
  readonly adoption: { readonly snapshotDays: number; readonly rarelyUsedPercentile: number };
  readonly previews: PreviewSettings;
  /** The settings this configuration was built from, before mandatory additions. */
  readonly settings: Settings;
}

export interface LoadOptions {
  appRoot?: string;
  environment?: Environment;
  env?: Readonly<Record<string, string | undefined>>;
  /** Settings to use instead of reading config/frontend-registry.json. */
  file?: unknown;
  /** Where deprecation warnings go; the console by default. */
  warn?: (message: string) => void;
}

export function currentEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): Environment {
  const value = env[ENVIRONMENT_VARIABLE] ?? env.NODE_ENV ?? "development";
  if (value === "development" || value === "test" || value === "production") return value;
  throw new ConfigurationError(`Unsupported environment ${JSON.stringify(value)}`);
}

export function loadConfig(options: LoadOptions = {}): FrontendRegistryConfig {
  // Not traced: the image copies config/ and drizzle/ itself, and tracing from the
  // working directory would ship the whole project, tests included, in the server output.
  // The ignore leads the call's argument, where Turbopack reads it; inside the expression it has no effect.
  const appRoot = path.resolve(/*turbopackIgnore: true*/ options.appRoot ?? process.cwd());
  const warn = options.warn ?? ((message: string) => console.warn(`[config] ${message}`));
  warnRetired(options.env ?? process.env, warn);
  const env = withLegacyNames(options.env ?? process.env, warn);
  const environment = options.environment ?? currentEnvironment(env);
  const { value, label } = options.file === undefined ? readConfigFile(appRoot, warn) : { value: options.file, label: `config/${CONFIG_FILE}` };
  const file = parse(fileSchema, value, label);
  const settings = applyEnvironment({ ...file.shared, ...file[environment] }, env);
  return buildConfig(settings, { appRoot, environment });
}

/**
 * Returns a new configuration with some settings replaced. Mandatory denied
 * roots are recomputed, so an override can never remove fleet-kit/.
 *
 * @public Tests override settings through this.
 */
export function withOverrides(
  config: FrontendRegistryConfig,
  overrides: Partial<Omit<Settings, "analysis" | "profiling" | "catalog" | "adoption" | "previews">> & {
    analysis?: Partial<Settings["analysis"]>;
    profiling?: Partial<Settings["profiling"]>;
    catalog?: Partial<Settings["catalog"]>;
    adoption?: Partial<Settings["adoption"]>;
    previews?: Partial<Settings["previews"]>;
  },
): FrontendRegistryConfig {
  const settings = {
    ...config.settings,
    ...overrides,
    analysis: { ...config.settings.analysis, ...overrides.analysis },
    profiling: { ...config.settings.profiling, ...overrides.profiling },
    catalog: { ...config.settings.catalog, ...overrides.catalog },
    adoption: { ...config.settings.adoption, ...overrides.adoption },
    previews: { ...config.settings.previews, ...overrides.previews },
  };
  return buildConfig(settings, { appRoot: config.appRoot, environment: config.environment });
}

/** Roots denied regardless of any operator setting. */
export function mandatoryDeniedRoots(workspaceRoot: string): string[] {
  const protectedTree = path.join(/*turbopackIgnore: true*/ workspaceRoot, PROTECTED_DIRECTORY);
  return unique([protectedTree, realpathIfExists(protectedTree)].filter((value): value is string => value !== null));
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** True when any segment of the path is the protected directory name. */
export function namesProtectedDirectory(candidate: string): boolean {
  return candidate.split(/[\\/]+/).includes(PROTECTED_DIRECTORY);
}

function buildConfig(raw: unknown, context: { appRoot: string; environment: Environment }): FrontendRegistryConfig {
  const settings = parse(settingsSchema, raw, "configuration");
  const { appRoot } = context;
  // Settings name paths anywhere on disk; the ignore keeps the build from tracing everything they could reach.
  const resolve = (value: string) => path.resolve(/*turbopackIgnore: true*/ appRoot, value);
  const workspaceRoot = path.dirname(appRoot);
  const mandatory = mandatoryDeniedRoots(workspaceRoot);
  const allowedRoots = unique(settings.allowedRoots.map(resolve));
  const deniedRoots = unique([...settings.deniedRoots.map(resolve), ...mandatory]);

  for (const allowed of allowedRoots) {
    const candidates = [allowed, realpathIfExists(allowed)].filter((value): value is string => value !== null);
    if (candidates.some((candidate) => namesProtectedDirectory(candidate) || mandatory.some((denied) => isInside(denied, candidate)))) {
      throw new ConfigurationError(`Allowed root ${allowed} is inside the protected ${PROTECTED_DIRECTORY}/ tree`);
    }
  }

  return deepFreeze({
    environment: context.environment,
    appRoot,
    workspaceRoot,
    allowedRoots,
    deniedRoots,
    mandatoryDeniedRoots: mandatory,
    gitTimeoutSeconds: settings.gitTimeoutSeconds,
    gitLockTimeoutSeconds: settings.gitLockTimeoutSeconds,
    workerConcurrency: settings.workerConcurrency,
    database: resolve(settings.database),
    repositoryStorage: resolve(settings.repositoryStorage),
    gitCredentialHelper: settings.gitCredentialHelper,
    analysis: { ...settings.analysis },
    profiling: { checkMinutes: settings.profiling.checkMinutes },
    catalog: { registry: settings.catalog.registry.endsWith("/") ? settings.catalog.registry : `${settings.catalog.registry}/` },
    adoption: { ...settings.adoption },
    previews: {
      enabled: settings.previews.enabled,
      browser: settings.previews.browser,
      trustedSources: unique(settings.previews.trustedSources.map(trustedSource)),
      nodeVersions: nodeVersions(settings.previews.nodeVersions, resolve),
      storage: resolve(settings.previews.storage),
      concurrency: settings.previews.concurrency,
      timeoutMinutes: settings.previews.timeoutMinutes,
      maxOutputBytes: settings.previews.maxOutputBytes,
      maxStorageBytes: settings.previews.maxStorageBytes,
      refCacheSeconds: settings.previews.refCacheSeconds,
    },
    settings,
  });
}

/** A trusted source's canonical remote identity, as registration computes it for duplicate detection. */
function trustedSource(value: string): string {
  try {
    return CloneUrl.parse(value).canonical;
  } catch (error) {
    if (error instanceof InvalidCloneUrl) throw new ConfigurationError(`The trusted preview source ${JSON.stringify(CloneUrl.redact(value))} is not a valid clone URL: ${error.message}`);
    throw error;
  }
}

/** Node versions keyed by their normalized semantic version, each with its resolved binary directory. */
function nodeVersions(entries: Readonly<Record<string, string>>, resolve: (value: string) => string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [version, directory] of Object.entries(entries)) {
    const normalized = semver.valid(version.trim());
    if (!normalized) throw new ConfigurationError(`The preview Node version ${JSON.stringify(version)} must be a full version such as 22.11.0`);
    if (normalized in result) throw new ConfigurationError(`The preview Node version ${normalized} is configured twice`);
    result[normalized] = resolve(directory);
  }
  return result;
}


function applyEnvironment(settings: Record<string, unknown>, env: Readonly<Record<string, string | undefined>>): unknown {
  const result: Record<string, unknown> = { ...settings };
  const analysis: Record<string, unknown> = { ...(settings.analysis as Record<string, unknown>) };
  const text = (key: string) => {
    const value = env[key];
    return value === undefined || value.trim() === "" ? undefined : value.trim();
  };
  const integer = (key: string) => {
    const value = text(key);
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) throw new ConfigurationError(`${key} must be a positive integer (got ${JSON.stringify(value)})`);
    return Number(value);
  };
  const list = (key: string) => text(key)?.split(path.delimiter).filter((entry) => entry.trim() !== "");
  const boolean = (key: string) => {
    const value = text(key)?.toLowerCase();
    if (value === undefined) return undefined;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    throw new ConfigurationError(`${key} must be true, false, 1, or 0 (got ${JSON.stringify(env[key])})`);
  };
  const profiling: Record<string, unknown> = { ...(settings.profiling as Record<string, unknown>) };
  const catalog: Record<string, unknown> = { ...(settings.catalog as Record<string, unknown>) };
  const adoption: Record<string, unknown> = { ...(settings.adoption as Record<string, unknown>) };
  const previews: Record<string, unknown> = { ...(settings.previews as Record<string, unknown>) };
  // Clone URLs can't contain whitespace, so whitespace separates them; ":" would split a URL.
  const urls = (key: string) => text(key)?.split(/\s+/);
  // version=directory pairs, separated like other path lists.
  const versions = (key: string) => {
    const entries = list(key);
    if (entries === undefined) return undefined;
    return Object.fromEntries(
      entries.map((entry) => {
        const separator = entry.indexOf("=");
        if (separator <= 0 || separator === entry.length - 1) throw new ConfigurationError(`${key} entries must be version=directory (got ${JSON.stringify(entry)})`);
        return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
      }),
    );
  };

  const assignments: [Record<string, unknown>, string, unknown][] = [
    [result, "allowedRoots", list(ENV_KEYS.allowedRoots)],
    [result, "deniedRoots", list(ENV_KEYS.deniedRoots)],
    [result, "gitTimeoutSeconds", integer(ENV_KEYS.gitTimeoutSeconds)],
    [result, "gitLockTimeoutSeconds", integer(ENV_KEYS.gitLockTimeoutSeconds)],
    [result, "workerConcurrency", integer(ENV_KEYS.workerConcurrency)],
    [result, "database", text(ENV_KEYS.database)],
    [result, "repositoryStorage", text(ENV_KEYS.repositoryStorage)],
    [result, "gitCredentialHelper", text(ENV_KEYS.gitCredentialHelper)],
    [analysis, "maxBlobBytes", integer(ENV_KEYS.maxBlobBytes)],
    [analysis, "maxLockfileBytes", integer(ENV_KEYS.maxLockfileBytes)],
    [analysis, "maxFiles", integer(ENV_KEYS.maxFiles)],
    [analysis, "maxTotalBytes", integer(ENV_KEYS.maxTotalBytes)],
    [profiling, "checkMinutes", integer(ENV_KEYS.profilingCheckMinutes)],
    [catalog, "registry", text(ENV_KEYS.catalogRegistry)],
    [adoption, "snapshotDays", integer(ENV_KEYS.adoptionSnapshotDays)],
    [adoption, "rarelyUsedPercentile", integer(ENV_KEYS.adoptionRarelyUsedPercentile)],
    [previews, "enabled", boolean(ENV_KEYS.previewsEnabled)],
    [previews, "browser", text(ENV_KEYS.previewsBrowser)],
    [previews, "trustedSources", urls(ENV_KEYS.previewsTrustedSources)],
    [previews, "nodeVersions", versions(ENV_KEYS.previewsNodeVersions)],
    [previews, "storage", text(ENV_KEYS.previewsStorage)],
    [previews, "concurrency", integer(ENV_KEYS.previewsConcurrency)],
    [previews, "timeoutMinutes", integer(ENV_KEYS.previewsTimeoutMinutes)],
    [previews, "maxOutputBytes", integer(ENV_KEYS.previewsMaxOutputBytes)],
    [previews, "maxStorageBytes", integer(ENV_KEYS.previewsMaxStorageBytes)],
    [previews, "refCacheSeconds", integer(ENV_KEYS.previewsRefCacheSeconds)],
  ];
  for (const [target, key, value] of assignments) if (value !== undefined) target[key] = value;
  result.analysis = analysis;
  if (Object.keys(profiling).length > 0) result.profiling = profiling;
  if (Object.keys(catalog).length > 0) result.catalog = catalog;
  if (Object.keys(adoption).length > 0) result.adoption = adoption;
  if (Object.keys(previews).length > 0) result.previews = previews;
  return result;
}

/** Variables added after the rename, which never had an old name to fall back to. */
const NEW_SINCE_RENAME: ReadonlySet<string> = new Set([ENV_KEYS.catalogRegistry, ENV_KEYS.adoptionSnapshotDays, ENV_KEYS.adoptionRarelyUsedPercentile, ENV_KEYS.previewsBrowser, ENV_KEYS.previewsRefCacheSeconds]);

/**
 * The environment with each variable's name from before the rename read where its
 * FRONTEND_REGISTRY_* name is unset, for one release, with a deprecation
 * warning for every old name that's set.
 */
function withLegacyNames(env: Readonly<Record<string, string | undefined>>, warn: (message: string) => void): Readonly<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = { ...env };
  for (const name of [ENVIRONMENT_VARIABLE, ...Object.values(ENV_KEYS)].filter((key) => !NEW_SINCE_RENAME.has(key))) {
    const legacy = `${LEGACY_NAMES.envPrefix}${name.slice(ENV_PREFIX.length)}`;
    if (env[legacy] === undefined) continue;
    if (env[name] === undefined) {
      result[name] = env[legacy];
      warn(`${legacy} is deprecated and stops working in the next release. Set ${name} instead.`);
    } else {
      warn(`${legacy} is ignored because ${name} is set. Remove ${legacy}.`);
    }
  }
  return result;
}

/** Settings that were removed, by their old suffix, with what to do instead. */
const RETIRED_SETTINGS: Readonly<Record<string, string>> = {
  DEMO: `the template demo was removed, and applications are available while ${ENV_PREFIX}PREVIEWS is on`,
};

/** Warns about each retired variable that's set, under its current or its old name, since nothing reads it now. */
function warnRetired(env: Readonly<Record<string, string | undefined>>, warn: (message: string) => void): void {
  for (const [suffix, reason] of Object.entries(RETIRED_SETTINGS)) {
    for (const name of [`${ENV_PREFIX}${suffix}`, `${LEGACY_NAMES.envPrefix}${suffix}`]) {
      if (env[name] !== undefined) warn(`${name} is no longer read: ${reason}. Remove ${name}.`);
    }
  }
}

/** config/frontend-registry.json, or for one release the file under its old name when it's the only one. */
function readConfigFile(appRoot: string, warn: (message: string) => void): { value: unknown; label: string } {
  const directory = path.join(/*turbopackIgnore: true*/ appRoot, "config");
  const current = path.join(/*turbopackIgnore: true*/ directory, CONFIG_FILE);
  const legacy = path.join(/*turbopackIgnore: true*/ directory, LEGACY_NAMES.configFile);
  const useLegacy = !fs.existsSync(/*turbopackIgnore: true*/ current) && fs.existsSync(/*turbopackIgnore: true*/ legacy);
  const file = useLegacy ? legacy : current;
  if (useLegacy) warn(`config/${LEGACY_NAMES.configFile} is deprecated and stops being read in the next release. Rename it to config/${CONFIG_FILE}.`);
  try {
    return { value: JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")), label: `config/${path.basename(file)}` };
  } catch (error) {
    throw new ConfigurationError(`Could not read ${file}: ${(error as Error).message}`);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConfigurationError(`Invalid ${label}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

function realpathIfExists(target: string): string | null {
  try {
    return fs.realpathSync(/*turbopackIgnore: true*/ target);
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
