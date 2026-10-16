import fs from "node:fs";
import path from "node:path";
import * as salt from "@salt-ds/mcp";
import type { SaltLookup } from "../types";

/**
 * The one place DE FabLab touches `@salt-ds/mcp` (design.md, decision 6). The
 * package is a pinned snapshot, so every call goes through these wrappers and
 * a contract test pins their behavior. The registry is the one committed in
 * registry/, built from the Salt release DE FabLab renders with; the
 * registry bundled in the package describes an older release and is never
 * loaded.
 */

export const REGISTRY_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "lib", "prototypes", "salt", "registry");

export type SaltRegistry = salt.SaltRegistry;

const holder = globalThis as typeof globalThis & { __fabricateSaltRegistry?: Promise<SaltRegistry> };

/** The committed registry, loaded once per instance. */
export function saltRegistry(): Promise<SaltRegistry> {
  holder.__fabricateSaltRegistry ??= salt.loadRegistry({ registryDir: REGISTRY_DIR }).catch((error: unknown) => {
    holder.__fabricateSaltRegistry = undefined;
    throw error;
  });
  return holder.__fabricateSaltRegistry;
}

/** The Salt release the committed registry describes, and the package versions it lists. */
export function registryRelease(): { release: string; packages: Record<string, string> } {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, file), "utf8"));
  const packages: { name: string; version: string }[] = read("packages.json").packages;
  return { release: read("metadata.json").version, packages: Object.fromEntries(packages.map((entry) => [entry.name, entry.version])) };
}

/**
 * The generator's Salt tools (design.md, decision 6), each a lookup into the
 * committed registry. Every answer also reports the components, patterns,
 * and tokens it named, which become the version's "Salt guidance consulted".
 */
export const SALT_TOOLS = {
  discover_salt: {
    description: "Start here: find the Salt components, patterns, and guides for a UI need, such as 'filterable list of payments with status'.",
    run: (registry: SaltRegistry, input: { query: string }) => salt.discoverSalt(registry, { query: input.query, view: "compact", top_k: 5, prefer_stable: true }),
  },
  recommend_component: {
    description: "Recommend the Salt component for one task, such as 'show a payment's status'.",
    run: (registry: SaltRegistry, input: { task: string }) => salt.recommendComponent(registry, { task: input.task, view: "compact", top_k: 3, prefer_stable: true }),
  },
  get_composition_recipe: {
    description: "Get a Salt pattern or composition recipe for a larger piece of UI, such as 'app header with navigation' or 'form with validation'.",
    run: (registry: SaltRegistry, input: { query: string }) => salt.getCompositionRecipe(registry, { query: input.query, view: "compact", top_k: 3, prefer_stable: true }),
  },
  get_component: {
    description: "Get one Salt component's guidance: when to use it, alternatives, accessibility, and deprecations. Props are not listed; the typecheck is the authority on props.",
    run: (registry: SaltRegistry, input: { name: string }) => salt.getComponent(registry, { name: input.name, view: "compact", include: ["accessibility", "deprecations"] }),
  },
  get_pattern: {
    description: "Get one Salt pattern, such as 'App header', 'Vertical navigation', 'Forms', or 'Metric', with the components it is composed of.",
    run: (registry: SaltRegistry, input: { name: string }) => salt.getPattern(registry, { name: input.name, view: "compact", include: ["accessibility"] }),
  },
  get_examples: {
    description: "Get Salt's own code examples for a component or pattern.",
    run: (registry: SaltRegistry, input: { target_name: string; intent?: string }) =>
      salt.getExamples(registry, { target_name: input.target_name, ...(input.intent && { intent: input.intent }), max_results: 3, include_code: true, view: "compact" }),
  },
  recommend_tokens: {
    description: "Recommend Salt design tokens for a styling need, such as 'separator color' or 'container padding'. Only Salt tokens may style a prototype.",
    run: (registry: SaltRegistry, input: { query: string }) => salt.recommendTokens(registry, { query: input.query, view: "compact", top_k: 5 }),
  },
  search_api_surface: {
    description: "Search Salt's exported API surface by name, such as a component, hook, or type.",
    run: (registry: SaltRegistry, input: { query: string }) => salt.searchApiSurface(registry, { query: input.query, top_k: 8 }),
  },
} as const;

export type SaltToolName = keyof typeof SALT_TOOLS;

/** Runs one tool and records the lookup. A tool that throws answers with its error, so the agent can try another. */
export function runSaltTool(registry: SaltRegistry, name: SaltToolName, input: Record<string, string>): { result: unknown; lookup: SaltLookup } {
  const query = Object.values(input).join(" · ");
  try {
    const run = SALT_TOOLS[name].run as (registry: SaltRegistry, input: Record<string, string>) => unknown;
    const result = run(registry, input);
    return { result, lookup: { tool: name, query, entries: namesIn(result) } };
  } catch (error) {
    return { result: { error: `The ${name} lookup failed: ${(error as Error).message}` }, lookup: { tool: name, query, entries: [] } };
  }
}

/** The component, pattern, and token names an answer mentions, in order and without repeats. */
export function namesIn(result: unknown): string[] {
  const names = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 12)) visit(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string" && record.name.length <= 60 && (typeof record.summary === "string" || typeof record.package === "string" || typeof record.type === "string" || typeof record.status === "string")) names.add(record.name);
    if (typeof record.component === "string" && record.component.length <= 60) names.add(record.component);
    for (const [key, child] of Object.entries(record)) if (key !== "docs" && key !== "examples" && key !== "related_docs") visit(child, depth + 1);
  };
  visit(result, 0);
  return [...names].slice(0, 24);
}

/** Salt's usage validator, against the committed registry and the installed release. */
export function validateSaltUsage(registry: SaltRegistry, code: string, release: string): salt.ValidateSaltUsageResult {
  return salt.validateSaltUsage(registry, { code, framework: "react", package_version: release, max_issues: 40 });
}

/** Salt's fix recipes for code that failed a gate, given to the agent with the failures. */
export function recommendFixRecipes(registry: SaltRegistry, code: string, release: string): salt.RecommendFixRecipesResult {
  return salt.recommendFixRecipes(registry, { code, framework: "react", package_version: release, max_recipes: 6, view: "compact" });
}

/** The stable component a lab component's name matches, when the registry lists one (quality-checks spec, "Pre-release Salt components are flagged"). */
export function stableEquivalent(registry: SaltRegistry, exportName: string): { name: string; package: string } | null {
  const key = normalize(exportName);
  for (const component of registry.components) {
    if (component.status === "lab" || component.package.name === "@salt-ds/lab") continue;
    if (normalize(component.name) === key || component.aliases.some((alias) => normalize(alias) === key)) return { name: component.name, package: component.package.name };
  }
  return null;
}

/** The registry's display name for a lab export, such as "Tokenized input" for TokenizedInput. */
export function labComponentName(registry: SaltRegistry, exportName: string): string {
  const key = normalize(exportName);
  return registry.components.find((component) => component.package.name === "@salt-ds/lab" && normalize(component.name) === key)?.name ?? exportName;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
