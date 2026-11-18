import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Typed, immutable safety and analysis configuration.
 *
 * Values come from config/fabricate.json (a `shared` section merged with the
 * section for the current environment) and then FABRICATE_* environment
 * variables. The harness workspace's fleet-kit/ tree is appended to the denied
 * roots unconditionally: no file setting, environment variable, or override
 * can remove it, and an allowed root inside it is a configuration error.
 */

export const PROTECTED_DIRECTORY = "fleet-kit";

export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

const positiveInteger = z.int().positive();
const pathSetting = z.string().trim().min(1, "path settings must not be blank");

const modelsSchema = z.strictObject({ generate: modelSetting(), plan: modelSetting(), review: modelSetting(), learn: modelSetting() });

const prototypesSchema = z.strictObject({
  enabled: z.boolean(),
  database: pathSetting,
  models: modelsSchema,
  dailyVariantLimit: positiveInteger,
  repairAttempts: z.int().min(0).max(5),
  zeroDataRetention: z.boolean(),
  // Steps run in a Vercel Workflow, or in-process after the response when the Workflow setup isn't available.
  runner: z.enum(["workflow", "inline"]),
  // Whether a new workspace starts with the seeded example prototypes; tests turn it off to start empty.
  examples: z.boolean(),
});

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
    maxFiles: positiveInteger,
    maxTotalBytes: positiveInteger,
  }),
  // The template demo: off by default, on in development and test. A hosted
  // demo turns it on with FABRICATE_DEMO=true.
  demo: z.strictObject({
    enabled: z.boolean(),
  }),
  // Where ownership of DE Web applications is read from: an export file, or
  // an HTTPS endpoint read under a read-only service identity whose token
  // comes only from FABRICATE_DE_CONSOLE_TOKEN. Not read when null.
  deConsole: z.strictObject({
    source: z.string().trim().min(1).nullable(),
    refreshMinutes: positiveInteger,
  }),
  // How often the worker checks every repository's reference for new
  // commits, and the detector for a new release, to queue profile versions.
  profiling: z.strictObject({
    checkMinutes: positiveInteger,
  }),
  // Where DE FabLab runs: `full` everywhere it has Git and SQLite, `hosted`
  // on a platform without them, where only Prototypes is shown.
  profile: z.enum(["full", "hosted"]),
  // Prototypes (prototypes/availability spec): off by default, on in
  // development and test. Its data lives in its own Postgres store, a PGlite
  // directory locally or a Postgres URL on Vercel.
  prototypes: prototypesSchema,
});

export type Settings = z.infer<typeof settingsSchema>;

/** An AI Gateway model id such as `anthropic/claude-opus-5.5`, or `mock` for the scripted test model. */
function modelSetting() {
  return z.string().trim().regex(/^(mock|[a-z0-9-]+\/[a-z0-9.\-_]+)$/, "models must be a provider/model id or mock");
}

// An environment section replaces whole settings, except Prototypes, whose
// fields it can set one at a time.
const sectionSchema = settingsSchema.partial().extend({ prototypes: prototypesSchema.partial().extend({ models: modelsSchema.partial().optional() }).optional() });

const fileSchema = z.strictObject({
  shared: settingsSchema,
  development: sectionSchema.optional(),
  test: sectionSchema.optional(),
  production: sectionSchema.optional(),
});

export type Environment = "development" | "test" | "production";

export const ENV_KEYS = {
  allowedRoots: "FABRICATE_ALLOWED_ROOTS",
  deniedRoots: "FABRICATE_DENIED_ROOTS",
  gitTimeoutSeconds: "FABRICATE_GIT_TIMEOUT",
  gitLockTimeoutSeconds: "FABRICATE_GIT_LOCK_TIMEOUT",
  workerConcurrency: "FABRICATE_WORKER_CONCURRENCY",
  database: "FABRICATE_DATABASE",
  repositoryStorage: "FABRICATE_REPOSITORY_STORAGE",
  gitCredentialHelper: "FABRICATE_GIT_CREDENTIAL_HELPER",
  maxBlobBytes: "FABRICATE_MAX_BLOB_BYTES",
  maxFiles: "FABRICATE_MAX_FILES",
  maxTotalBytes: "FABRICATE_MAX_TOTAL_BYTES",
  demoEnabled: "FABRICATE_DEMO",
  deConsoleSource: "FABRICATE_DE_CONSOLE_SOURCE",
  deConsoleRefreshMinutes: "FABRICATE_DE_CONSOLE_REFRESH_MINUTES",
  profilingCheckMinutes: "FABRICATE_PROFILING_CHECK_MINUTES",
  profile: "FABRICATE_PROFILE",
  prototypesEnabled: "FABRICATE_PROTOTYPES",
  prototypesDatabase: "FABRICATE_PROTOTYPES_DATABASE",
  prototypesModelGenerate: "FABRICATE_PROTOTYPES_MODEL_GENERATE",
  prototypesModelPlan: "FABRICATE_PROTOTYPES_MODEL_PLAN",
  prototypesModelReview: "FABRICATE_PROTOTYPES_MODEL_REVIEW",
  prototypesModelLearn: "FABRICATE_PROTOTYPES_MODEL_LEARN",
  prototypesDailyLimit: "FABRICATE_PROTOTYPES_DAILY_LIMIT",
  prototypesZeroDataRetention: "FABRICATE_PROTOTYPES_ZDR",
  prototypesRunner: "FABRICATE_PROTOTYPES_RUNNER",
  prototypesExamples: "FABRICATE_PROTOTYPES_EXAMPLES",
} as const;

/** The Postgres URL Prototypes falls back to when FABRICATE_PROTOTYPES_DATABASE isn't set, as the Neon integration names it. */
export const DATABASE_URL = "DATABASE_URL";

/**
 * The AI Gateway credentials (prototypes/availability spec, "Generation needs
 * a configured model credential"): an API key, or the OIDC token Vercel gives
 * a deployment and `vercel env pull` writes locally. Read from the
 * environment when a model is called, never stored in the configuration.
 */
export const GATEWAY_CREDENTIALS = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"] as const;

/** The DE Console service identity's token. Read from the environment when a request is made, and never stored in the configuration. */
export const DE_CONSOLE_TOKEN = "FABRICATE_DE_CONSOLE_TOKEN";

export type DeConsoleSource = { readonly kind: "file"; readonly path: string } | { readonly kind: "url"; readonly url: string };

export interface DeConsoleSettings {
  /** Null when no DE Console source is configured. */
  readonly source: DeConsoleSource | null;
  readonly refreshMinutes: number;
}

/** Where Prototypes keeps its data: an in-process PGlite directory, or a Postgres server. */
export type PrototypesDatabase = { readonly kind: "pglite"; readonly dataDir: string } | { readonly kind: "postgres"; readonly url: string };

export type Profile = "full" | "hosted";

export interface PrototypesSettings {
  /** Whether Prototypes' pages, render frames, share links, and endpoints exist. */
  readonly enabled: boolean;
  readonly database: PrototypesDatabase;
  /** AI Gateway model ids per step, or `mock`. */
  readonly models: { readonly generate: string; readonly plan: string; readonly review: string; readonly learn: string };
  readonly dailyVariantLimit: number;
  readonly repairAttempts: number;
  readonly zeroDataRetention: boolean;
  readonly runner: "workflow" | "inline";
  /** Whether a new workspace starts with the seeded example prototypes, lessons, and progress. */
  readonly examples: boolean;
}

export interface AnalysisBudgets {
  readonly maxBlobBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
}

export interface FabricateConfig {
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
  /** Whether the template demo's pages, running applications, and endpoints exist. */
  readonly demoEnabled: boolean;
  readonly deConsole: DeConsoleSettings;
  readonly profiling: { readonly checkMinutes: number };
  /** `hosted` shows only Prototypes and skips the Git and SQLite startup checks. */
  readonly profile: Profile;
  readonly prototypes: PrototypesSettings;
  /** The settings this configuration was built from, before mandatory additions. */
  readonly settings: Settings;
}

export interface LoadOptions {
  appRoot?: string;
  environment?: Environment;
  env?: Readonly<Record<string, string | undefined>>;
  /** Settings to use instead of reading config/fabricate.json. */
  file?: unknown;
}

export function currentEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): Environment {
  const value = env.FABRICATE_ENV ?? env.NODE_ENV ?? "development";
  if (value === "development" || value === "test" || value === "production") return value;
  throw new ConfigurationError(`Unsupported environment ${JSON.stringify(value)}`);
}

export function loadConfig(options: LoadOptions = {}): FabricateConfig {
  // Not traced: the image copies config/ and drizzle/ itself, and tracing from the
  // working directory would ship the whole project, tests included, in the server output.
  const appRoot = path.resolve(options.appRoot ?? /*turbopackIgnore: true*/ process.cwd());
  const env = options.env ?? process.env;
  const environment = options.environment ?? currentEnvironment(env);
  const file = parse(fileSchema, options.file ?? readConfigFile(appRoot), "config/fabricate.json");
  const section = file[environment];
  const prototypes = { ...file.shared.prototypes, ...section?.prototypes, models: { ...file.shared.prototypes.models, ...section?.prototypes?.models } };
  const settings = applyEnvironment({ ...file.shared, ...section, prototypes }, env);
  return buildConfig(settings, { appRoot, environment });
}

/**
 * Returns a new configuration with some settings replaced. Mandatory denied
 * roots are recomputed, so an override can never remove fleet-kit/.
 */
export function withOverrides(
  config: FabricateConfig,
  overrides: Partial<Omit<Settings, "analysis" | "deConsole" | "profiling" | "prototypes">> & {
    analysis?: Partial<Settings["analysis"]>;
    deConsole?: Partial<Settings["deConsole"]>;
    profiling?: Partial<Settings["profiling"]>;
    prototypes?: Partial<Omit<Settings["prototypes"], "models">> & { models?: Partial<Settings["prototypes"]["models"]> };
  },
): FabricateConfig {
  const settings = {
    ...config.settings,
    ...overrides,
    analysis: { ...config.settings.analysis, ...overrides.analysis },
    demo: { ...config.settings.demo, ...overrides.demo },
    deConsole: { ...config.settings.deConsole, ...overrides.deConsole },
    profiling: { ...config.settings.profiling, ...overrides.profiling },
    prototypes: { ...config.settings.prototypes, ...overrides.prototypes, models: { ...config.settings.prototypes.models, ...overrides.prototypes?.models } },
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

function buildConfig(raw: unknown, context: { appRoot: string; environment: Environment }): FabricateConfig {
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
    demoEnabled: settings.demo.enabled,
    deConsole: { source: deConsoleSource(settings.deConsole.source, resolve, mandatory), refreshMinutes: settings.deConsole.refreshMinutes },
    profiling: { checkMinutes: settings.profiling.checkMinutes },
    profile: settings.profile,
    prototypes: {
      enabled: settings.prototypes.enabled,
      database: prototypesDatabase(settings.prototypes.database, resolve),
      models: { ...settings.prototypes.models },
      dailyVariantLimit: settings.prototypes.dailyVariantLimit,
      repairAttempts: settings.prototypes.repairAttempts,
      zeroDataRetention: settings.prototypes.zeroDataRetention,
      runner: settings.prototypes.runner,
      examples: settings.prototypes.examples,
    },
    settings,
  });
}

/** A `postgres://` or `postgresql://` URL names a server; anything else is a PGlite directory, resolved from the app root. */
function prototypesDatabase(value: string, resolve: (value: string) => string): PrototypesDatabase {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return { kind: "pglite", dataDir: resolve(value) };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError("The Prototypes database is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new ConfigurationError("The Prototypes database must be a PGlite directory or a postgres:// URL");
  return { kind: "postgres", url: value };
}

/** A Postgres URL with its password replaced, for printing. */
export function describePrototypesDatabase(database: PrototypesDatabase): string {
  if (database.kind === "pglite") return `PGlite at ${database.dataDir}`;
  const url = new URL(database.url);
  if (url.password) url.password = "****";
  return `Postgres at ${url.toString()}`;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * An HTTPS endpoint, or plain HTTP to this machine for a local stub, without
 * credentials in the URL; or an export file outside the protected tree.
 */
function deConsoleSource(value: string | null, resolve: (value: string) => string, mandatory: readonly string[]): DeConsoleSource | null {
  if (value === null) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ConfigurationError(`The DE Console source ${JSON.stringify(value)} is not a valid URL`);
    }
    if (url.username || url.password) throw new ConfigurationError(`The DE Console source can't contain credentials; set ${DE_CONSOLE_TOKEN} instead`);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
      throw new ConfigurationError("The DE Console source must be an https:// URL, or http:// to this machine");
    }
    return { kind: "url", url: url.toString() };
  }
  const file = resolve(value);
  // The file may not exist yet, so its directory's real location is checked too.
  const directory = realpathIfExists(path.dirname(/*turbopackIgnore: true*/ file));
  const candidates = [file, realpathIfExists(file), directory && path.join(directory, path.basename(file))].filter((candidate): candidate is string => candidate !== null);
  if (candidates.some((candidate) => namesProtectedDirectory(candidate) || mandatory.some((denied) => isInside(denied, candidate)))) {
    throw new ConfigurationError(`The DE Console export ${file} is inside the protected ${PROTECTED_DIRECTORY}/ tree`);
  }
  return { kind: "file", path: file };
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
  const demo: Record<string, unknown> = { ...(settings.demo as Record<string, unknown>) };
  const deConsole: Record<string, unknown> = { ...(settings.deConsole as Record<string, unknown>) };
  const profiling: Record<string, unknown> = { ...(settings.profiling as Record<string, unknown>) };
  const prototypes: Record<string, unknown> = { ...(settings.prototypes as Record<string, unknown>) };
  const models: Record<string, unknown> = { ...(prototypes.models as Record<string, unknown>) };
  const oneOf = (key: string, values: readonly string[]) => {
    const value = text(key);
    if (value === undefined || values.includes(value)) return value;
    throw new ConfigurationError(`${key} must be ${values.join(" or ")} (got ${JSON.stringify(value)})`);
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
    [analysis, "maxFiles", integer(ENV_KEYS.maxFiles)],
    [analysis, "maxTotalBytes", integer(ENV_KEYS.maxTotalBytes)],
    [demo, "enabled", boolean(ENV_KEYS.demoEnabled)],
    [deConsole, "source", text(ENV_KEYS.deConsoleSource)],
    [deConsole, "refreshMinutes", integer(ENV_KEYS.deConsoleRefreshMinutes)],
    [profiling, "checkMinutes", integer(ENV_KEYS.profilingCheckMinutes)],
    [result, "profile", oneOf(ENV_KEYS.profile, ["full", "hosted"])],
    [prototypes, "enabled", boolean(ENV_KEYS.prototypesEnabled)],
    [prototypes, "database", text(ENV_KEYS.prototypesDatabase) ?? text(DATABASE_URL)],
    [models, "generate", text(ENV_KEYS.prototypesModelGenerate)],
    [models, "plan", text(ENV_KEYS.prototypesModelPlan)],
    [models, "review", text(ENV_KEYS.prototypesModelReview)],
    [models, "learn", text(ENV_KEYS.prototypesModelLearn)],
    [prototypes, "dailyVariantLimit", integer(ENV_KEYS.prototypesDailyLimit)],
    [prototypes, "zeroDataRetention", boolean(ENV_KEYS.prototypesZeroDataRetention)],
    [prototypes, "runner", oneOf(ENV_KEYS.prototypesRunner, ["workflow", "inline"])],
    [prototypes, "examples", boolean(ENV_KEYS.prototypesExamples)],
  ];
  for (const [target, key, value] of assignments) if (value !== undefined) target[key] = value;
  result.analysis = analysis;
  if (Object.keys(demo).length > 0) result.demo = demo;
  if (Object.keys(deConsole).length > 0) result.deConsole = deConsole;
  if (Object.keys(profiling).length > 0) result.profiling = profiling;
  if (Object.keys(prototypes).length > 0) result.prototypes = Object.keys(models).length > 0 ? { ...prototypes, models } : prototypes;
  return result;
}

function readConfigFile(appRoot: string): unknown {
  const file = path.join(/*turbopackIgnore: true*/ appRoot, "config", "fabricate.json");
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
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
