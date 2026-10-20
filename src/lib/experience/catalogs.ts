import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { compareVersions, isVersion } from "./semver";

/*
 * The experience editor's catalogs (add-portal-experience-editor, design
 * decision 7): design theme packs, capability toolkits, and the runtime
 * module registry, as committed YAML in config/. Like the starters, one
 * invalid entry is left out and logged without hiding the rest, an
 * unreadable file is a problem the editor reports, and each file is read
 * once per process in production.
 */

export const THEMES_FILE = path.join("config", "design-themes.yaml");
export const TOOLKITS_FILE = path.join("config", "capability-toolkits.yaml");
export const MODULES_FILE = path.join("config", "runtime-modules.yaml");

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, "must be lowercase letters, digits, and hyphens, starting with a letter");
const version = z.string().refine(isVersion, "must be a version such as 1.2.3");
export const MODULE_NAME = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*$/;

const themeSchema = z.strictObject({
  id,
  name: text(40),
  owner: text(80),
  shell: z.enum(["access", "markets"]),
  notes: text(200),
  versions: z.array(version).min(1),
  default: z.boolean().optional(),
});

/** Where a toolkit appears: a frame slot as zone.slot, or an overlay. */
export const TOOLKIT_SERVES = ["header.global-search", "header.notifications", "banner.message", "sidebar.main", "overlay.session"] as const;
export const PREREQUISITE_CHECKS = ["searchable-sources", "menu-items"] as const;

const toolkitSchema = z.strictObject({
  id,
  name: text(40),
  description: text(160),
  adds: text(400),
  module: z.string().regex(MODULE_NAME, "must be a module name such as @organization/name"),
  serves: z.enum(TOOLKIT_SERVES),
  installed: z.boolean(),
  prerequisites: z.array(z.strictObject({ text: text(200), check: z.enum(PREREQUISITE_CHECKS).optional(), required: z.boolean() })),
});

const moduleSchema = z.strictObject({
  name: z.string().regex(MODULE_NAME, "must be a module name such as @organization/name"),
  description: text(160),
  versions: z.array(version).min(1),
});

export type DesignTheme = z.infer<typeof themeSchema>;
export type Toolkit = z.infer<typeof toolkitSchema>;
export type RuntimeModule = z.infer<typeof moduleSchema>;
export type CatalogResult<T> = { ok: true; entries: T[]; skipped: string[] } | { ok: false; problem: string };

/** Reads the list under +key+ in +file+, leaving out each entry +schema+ refuses or whose +identify+ repeats. */
export function readCatalog<T>(file: string, key: string, schema: z.ZodType<T>, identify: (entry: T) => string): CatalogResult<T> {
  const location = path.resolve(/*turbopackIgnore: true*/ process.cwd(), file);
  let value: unknown;
  try {
    value = parse(fs.readFileSync(/*turbopackIgnore: true*/ location, "utf8"));
  } catch (error) {
    return { ok: false, problem: `${file} can't be read: ${(error as Error).message}` };
  }
  const list = z.strictObject({ [key]: z.array(z.unknown()) }).safeParse(value);
  if (!list.success) return { ok: false, problem: `${file} needs a top-level ${key} list` };
  const entries: T[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  (list.data[key] as unknown[]).forEach((entry, index) => {
    const parsed = schema.safeParse(entry);
    const label = `${file} ${key}.${index}`;
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      skipped.push(`${label} at ${issue.path.length ? issue.path.join(".") : "the top level"}: ${issue.message}`);
    } else if (seen.has(identify(parsed.data))) {
      skipped.push(`${label}: ${identify(parsed.data)} is listed twice`);
    } else {
      seen.add(identify(parsed.data));
      entries.push(parsed.data);
    }
  });
  return { ok: true, entries, skipped };
}

const cache = new Map<string, CatalogResult<unknown>>();
const logged = new Set<string>();

/** A catalog's entries, read once per process in production and on every call in development; [] when the file can't be used. */
function load<T>(name: string, file: string, envFile: string | undefined, key: string, schema: z.ZodType<T>, identify: (entry: T) => string): T[] {
  const development = process.env.NODE_ENV !== "production";
  const result = ((!development && cache.get(name)) || readCatalog(envFile || file, key, schema, identify)) as CatalogResult<T>;
  cache.set(name, result);
  const problems = result.ok ? result.skipped.map((problem) => `A ${name} entry is left out: ${problem}`) : [`The ${name} catalog is unavailable: ${result.problem}`];
  for (const problem of problems) {
    if (!logged.has(problem)) console.error(problem);
    logged.add(problem);
  }
  return result.ok ? result.entries : [];
}

export function designThemes(): DesignTheme[] {
  return load("design theme", THEMES_FILE, process.env.FABRICATE_DESIGN_THEMES_FILE, "themes", themeSchema, (theme) => theme.id);
}

export function capabilityToolkits(): Toolkit[] {
  return load("toolkit", TOOLKITS_FILE, process.env.FABRICATE_TOOLKITS_FILE, "toolkits", toolkitSchema, (toolkit) => toolkit.id);
}

export function runtimeModules(): RuntimeModule[] {
  return load("runtime module", MODULES_FILE, process.env.FABRICATE_RUNTIME_MODULES_FILE, "modules", moduleSchema, (module) => module.name).map((module) => ({ ...module, versions: [...module.versions].sort((a, b) => compareVersions(b, a)) }));
}

/** Everything the editor and the document's validation read from the catalogs. */
export interface Catalogs {
  themes: DesignTheme[];
  toolkits: Toolkit[];
  modules: RuntimeModule[];
}

export function catalogs(): Catalogs {
  return { themes: designThemes(), toolkits: capabilityToolkits(), modules: runtimeModules() };
}
