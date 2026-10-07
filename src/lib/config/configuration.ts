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
  // Web onboarding's read-only view of Studio and CDaaS. Each is read only
  // when its base URL is set, under a token that comes only from
  // FABRICATE_STUDIO_TOKEN or FABRICATE_CDAAS_TOKEN.
  onboarding: z.strictObject({
    studioUrl: z.string().trim().min(1).nullable(),
    cdaasUrl: z.string().trim().min(1).nullable(),
    refreshMinutes: positiveInteger,
    staleAfterMinutes: positiveInteger,
    timeoutSeconds: positiveInteger,
    maxResponseBytes: positiveInteger,
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
  studioUrl: "FABRICATE_STUDIO_URL",
  cdaasUrl: "FABRICATE_CDAAS_URL",
  onboardingRefreshMinutes: "FABRICATE_ONBOARDING_REFRESH_MINUTES",
  onboardingStaleAfterMinutes: "FABRICATE_ONBOARDING_STALE_AFTER_MINUTES",
} as const;

/** The DE Console service identity's token. Read from the environment when a request is made, and never stored in the configuration. */
export const DE_CONSOLE_TOKEN = "FABRICATE_DE_CONSOLE_TOKEN";

/** The bearer tokens onboarding reads Studio and CDaaS with. Read from the environment when a request is made, never stored. */
export const ONBOARDING_TOKENS = { studio: "FABRICATE_STUDIO_TOKEN", cdaas: "FABRICATE_CDAAS_TOKEN" } as const;

export type DeConsoleSource = { readonly kind: "file"; readonly path: string } | { readonly kind: "url"; readonly url: string };

export interface OnboardingSettings {
  /** Studio's base URL, or null when Studio isn't read. */
  readonly studio: { readonly baseUrl: string } | null;
  /** CDaaS Admin's base URL, or null when CDaaS isn't read. */
  readonly cdaas: { readonly baseUrl: string } | null;
  readonly refreshMinutes: number;
  /** How long an observation counts as current. */
  readonly staleAfterMinutes: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export interface DeConsoleSettings {
  /** Null when no DE Console source is configured. */
  readonly source: DeConsoleSource | null;
  readonly refreshMinutes: number;
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
  readonly onboarding: OnboardingSettings;
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
  const appRoot = path.resolve(/*turbopackIgnore: true*/ options.appRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const environment = options.environment ?? currentEnvironment(env);
  const file = parse(fileSchema, options.file ?? readConfigFile(appRoot), "config/fabricate.json");
  const settings = applyEnvironment({ ...file.shared, ...file[environment] }, env);
  return buildConfig(settings, { appRoot, environment });
}

/**
 * Returns a new configuration with some settings replaced. Mandatory denied
 * roots are recomputed, so an override can never remove fleet-kit/.
 */
export function withOverrides(
  config: FabricateConfig,
  overrides: Partial<Omit<Settings, "analysis" | "deConsole" | "onboarding">> & { analysis?: Partial<Settings["analysis"]>; deConsole?: Partial<Settings["deConsole"]>; onboarding?: Partial<Settings["onboarding"]> },
): FabricateConfig {
  const settings = {
    ...config.settings,
    ...overrides,
    analysis: { ...config.settings.analysis, ...overrides.analysis },
    demo: { ...config.settings.demo, ...overrides.demo },
    deConsole: { ...config.settings.deConsole, ...overrides.deConsole },
    onboarding: { ...config.settings.onboarding, ...overrides.onboarding },
  };
  return buildConfig(settings, { appRoot: config.appRoot, environment: config.environment });
}

/** Roots denied regardless of any operator setting. */
export function mandatoryDeniedRoots(workspaceRoot: string): string[] {
  const protectedTree = path.join(workspaceRoot, PROTECTED_DIRECTORY);
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
  const resolve = (value: string) => path.resolve(appRoot, value);
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
    onboarding: {
      studio: readEndpoint("Studio", settings.onboarding.studioUrl, ONBOARDING_TOKENS.studio),
      cdaas: readEndpoint("CDaaS", settings.onboarding.cdaasUrl, ONBOARDING_TOKENS.cdaas),
      refreshMinutes: settings.onboarding.refreshMinutes,
      staleAfterMinutes: settings.onboarding.staleAfterMinutes,
      timeoutMs: settings.onboarding.timeoutSeconds * 1000,
      maxResponseBytes: settings.onboarding.maxResponseBytes,
    },
    settings,
  });
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
  const directory = realpathIfExists(path.dirname(file));
  const candidates = [file, realpathIfExists(file), directory && path.join(directory, path.basename(file))].filter((candidate): candidate is string => candidate !== null);
  if (candidates.some((candidate) => namesProtectedDirectory(candidate) || mandatory.some((denied) => isInside(denied, candidate)))) {
    throw new ConfigurationError(`The DE Console export ${file} is inside the protected ${PROTECTED_DIRECTORY}/ tree`);
  }
  return { kind: "file", path: file };
}

/**
 * A base URL onboarding reads from: https, or plain http to this machine for
 * a local stub, with no credentials, query string, or fragment.
 */
function readEndpoint(system: string, value: string | null, tokenKey: string): { baseUrl: string } | null {
  if (value === null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`The ${system} URL ${JSON.stringify(value)} is not a valid URL`);
  }
  if (url.username || url.password) throw new ConfigurationError(`The ${system} URL can't contain credentials; set ${tokenKey} instead`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) throw new ConfigurationError(`The ${system} URL must be an https:// URL, or http:// to this machine`);
  if (url.search || url.hash || value.includes("#") || value.includes("?")) throw new ConfigurationError(`The ${system} URL can't contain a query string or fragment`);
  return { baseUrl: url.toString().replace(/\/+$/, "") };
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
  const onboarding: Record<string, unknown> = { ...(settings.onboarding as Record<string, unknown>) };

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
    [onboarding, "studioUrl", text(ENV_KEYS.studioUrl)],
    [onboarding, "cdaasUrl", text(ENV_KEYS.cdaasUrl)],
    [onboarding, "refreshMinutes", integer(ENV_KEYS.onboardingRefreshMinutes)],
    [onboarding, "staleAfterMinutes", integer(ENV_KEYS.onboardingStaleAfterMinutes)],
  ];
  for (const [target, key, value] of assignments) if (value !== undefined) target[key] = value;
  result.analysis = analysis;
  if (Object.keys(demo).length > 0) result.demo = demo;
  if (Object.keys(deConsole).length > 0) result.deConsole = deConsole;
  if (Object.keys(onboarding).length > 0) result.onboarding = onboarding;
  return result;
}

function readConfigFile(appRoot: string): unknown {
  const file = path.join(appRoot, "config", "fabricate.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
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
    return fs.realpathSync(target);
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
