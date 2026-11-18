import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { factText, formatValue } from "@/components/results/value";
import { countLabel } from "@/components/ui/count";
import { kindLabel } from "@/components/ui/status";
import { isJsonObject } from "@/lib/json";
import type { Cell, CellItem, Layout } from "./layouts";
import type { OverviewValue } from "./overview";
import type { Fact } from "./states";

/**
 * Composition facts in people's words: what each unit is, what it exposes to
 * other applications, what it loads from them, and what it shares with them
 * at run time. A Module Federation container fills all of these; an import
 * map entry, an embedded frame, and a single-spa role or registration fill
 * the ones that apply to them, and leave the rest empty.
 */

/** An entry of a list: a name, or a note that the detectors couldn't resolve every entry. */
type Entry = CellItem & { note?: boolean };

interface Parts {
  /** What the unit is: its name, or its role when it has none, with its mechanism below. */
  unit: Cell;
  /** Each list is null where it doesn't apply to the mechanism, and empty where the unit declares none. */
  exposes: Entry[] | null;
  loads: Entry[] | null;
  shares: Entry[] | null;
}

/** A federated build's generation, such as Module Federation 1 or 2, and the bundler or framework its plugin is for. */
interface Federation {
  /** "1", "1.5", or "2" for Module Federation; null when the plugin doesn't say, such as the Next.js plugin, whose generation depends on its version. */
  generation: string | null;
  tool: string | null;
}

// The package a plugin or API came from (repo-facts 0.5.0 and later), and the class it constructs where a package has two generations.
const FEDERATION_PACKAGES: Record<string, Federation | ((api: string | null) => Federation)> = {
  webpack: { generation: "1", tool: "webpack" },
  "@rspack/core": (api) => (api === "ModuleFederationPluginV1" ? { generation: "1", tool: "Rspack" } : { generation: "1.5", tool: "Rspack" }),
  "@module-federation/enhanced": { generation: "2", tool: null },
  "@module-federation/enhanced/webpack": { generation: "2", tool: "webpack" },
  "@module-federation/enhanced/rspack": { generation: "2", tool: "Rspack" },
  "@module-federation/rspack": { generation: "2", tool: "Rspack" },
  "@module-federation/vite": { generation: "2", tool: "Vite" },
  "@originjs/vite-plugin-federation": { generation: "1", tool: "Vite" },
  "@module-federation/nextjs-mf": { generation: null, tool: "Next.js" },
  "@module-federation/rsbuild-plugin": { generation: "2", tool: "Rsbuild" },
  "@module-federation/modern-js": { generation: "2", tool: "Modern.js" },
  "@module-federation/runtime": { generation: "2", tool: "runtime API" },
  "@module-federation/enhanced/runtime": { generation: "2", tool: "runtime API" },
};
// Before repo-facts 0.5.0 a fact named only its rule, and two rules each matched plugins of two generations.
const FEDERATION_RULES: Record<string, Federation> = {
  "architecture.module-federation.webpack": { generation: "1", tool: "webpack" },
  "architecture.module-federation.rspack": { generation: null, tool: "Rspack" },
  "architecture.module-federation.enhanced": { generation: "2", tool: null },
  "architecture.module-federation.vite": { generation: null, tool: "Vite" },
  "architecture.module-federation.vite-named": { generation: "2", tool: "Vite" },
};

function federationOf(value: JsonObject, rule: string): Federation {
  const known = typeof value.package === "string" ? FEDERATION_PACKAGES[value.package] : undefined;
  if (typeof known === "function") return known(typeof value.api === "string" ? value.api : null);
  return known ?? FEDERATION_RULES[rule] ?? FEDERATION_RULES[String(value.plugin)] ?? { generation: null, tool: null };
}

/** A federated build's mechanism in words: "Module Federation 2 · Vite", "Native Federation". */
function federationLabel(value: JsonObject, rule: string): string {
  if (value.mechanism === "native-federation") return "Native Federation · ES modules";
  const { generation, tool } = federationOf(value, rule);
  return [generation ? `Module Federation ${generation}` : "Module Federation", tool].filter(Boolean).join(" · ");
}

const SINGLE_SPA_ROLES: Record<string, string> = { "root-config": "Root config", application: "Application", registration: "Registration" };

/** A captured value as text: a literal as written, an unresolved one by why, and nothing for an absent one. */
function captured(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (isJsonObject(value) && value.kind === "literal") return value.value === null ? null : String(value.value);
  if (isJsonObject(value) && value.kind === "absent") return null;
  if (isJsonObject(value) && value.kind === "unresolved") return typeof value.detail === "string" ? value.detail : "Not resolved statically";
  return formatValue(value);
}

const unresolved = (value: JsonValue): value is JsonObject => isJsonObject(value) && value.kind === "unresolved";
const asList = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

/** A list entry: a name as written, or why an entry couldn't be resolved. */
function entry(value: JsonValue): Entry {
  if (typeof value === "string") return { text: value, mono: true };
  if (unresolved(value)) return { text: captured(value)!, note: true };
  return { text: formatValue(value), mono: true };
}

/** A remote by the alias the host imports it as, with the container it names and where its entry loads from. */
function remote(value: JsonValue): Entry {
  if (!isJsonObject(value) || typeof value.kind === "string") return entry(value);
  const alias = typeof value.alias === "string" ? value.alias : null;
  const name = typeof value.federation_name === "string" ? value.federation_name : null;
  const secondary = [name && alias && name !== alias ? `Container ${name}` : null, captured(value.entry)].filter(Boolean).join(" · ");
  return { text: alias ?? name ?? "Unnamed remote", mono: Boolean(alias ?? name), secondary: secondary || undefined };
}

/** A shared module's settings that change how it loads: "Singleton · Eager · Requires ^18.3.1". */
function sharedSettings(settings: JsonValue): string | undefined {
  // An object maps a module to a version range, or to its settings.
  if (isJsonObject(settings) && settings.kind === "literal" && typeof settings.value === "string") return `Requires ${settings.value}`;
  if (!isJsonObject(settings) || settings.kind !== "object" || !isJsonObject(settings.properties)) return undefined;
  const option = (name: string) => {
    const value = (settings.properties as JsonObject)[name];
    return isJsonObject(value) && value.kind === "literal" ? value.value : undefined;
  };
  const required = option("requiredVersion");
  const parts = [option("singleton") === true ? "Singleton" : null, option("eager") === true ? "Eager" : null, option("strictVersion") === true ? "Strict version" : null, typeof required === "string" ? `Requires ${required}` : null].filter(Boolean).join(" · ");
  return parts || undefined;
}

/** Shared modules, which a configuration names in a list, in an object of names to settings, or in a list of such objects. */
function shared(value: JsonValue): Entry[] {
  if (isJsonObject(value) && value.kind === "object" && isJsonObject(value.properties)) {
    const modules = Object.entries(value.properties).map(([name, settings]): Entry => ({ text: name, mono: true, secondary: sharedSettings(settings) }));
    return value.complete === false ? [...modules, { text: "More not resolved statically", note: true }] : modules;
  }
  return [entry(value)];
}

function federation(value: JsonObject, rule: string): Parts {
  const name = captured(value.name);
  return {
    unit: { text: name ?? (typeof value.manifest === "string" ? "Host" : "Unnamed container"), mono: name !== null, secondary: federationLabel(value, rule) },
    exposes: asList(value.exposes).map(entry),
    // A Native Federation host may load its remotes from a manifest instead of naming them.
    loads: typeof value.manifest === "string" ? [{ text: value.manifest, mono: true, secondary: "Remotes from this manifest" }] : asList(value.remotes).map(remote),
    shares: asList(value.shared).flatMap(shared),
  };
}

function singleSpa(value: JsonObject): Parts {
  const role = typeof value.role === "string" ? value.role : "";
  const application = captured(value.application);
  const active = captured(value.activeWhen);
  return {
    unit: { text: SINGLE_SPA_ROLES[role] ?? kindLabel(role), secondary: kindLabel("single-spa") },
    exposes: null,
    // A registration loads the application it names, when its activity function says.
    loads: role === "registration" && application ? [{ text: application, mono: true, secondary: active ? `Active when: ${active}` : undefined }] : null,
    shares: null,
  };
}

/** A composition fact's parts, or null for a value no composition rule writes. */
function partsOf(value: JsonValue, rule: string): Parts | null {
  if (!isJsonObject(value) || typeof value.mechanism !== "string") return null;
  switch (value.mechanism) {
    case "module-federation":
    case "native-federation":
      return federation(value, rule);
    case "single-spa":
      return singleSpa(value);
    case "import-map":
      // A host's import map loads each specifier from an address; the file that maps it is the fact's evidence.
      return { unit: { text: String(value.specifier), mono: true, secondary: kindLabel("import-map") }, exposes: null, loads: typeof value.url === "string" ? [{ text: value.url, mono: true }] : null, shares: null };
    case "iframe": {
      const source = captured(value.src);
      return { unit: { text: "Embedded frame", secondary: kindLabel("iframe") }, exposes: null, loads: source ? [{ text: source, mono: !unresolved(value.src as JsonValue) }] : null, shares: null };
    }
  }
  return { unit: { text: kindLabel(value.mechanism) }, exposes: null, loads: null, shares: null };
}

/**
 * A list as one cell: its entries one per line, under their count when there
 * are several, or "None". A count is "at least" when the detectors couldn't
 * resolve every entry.
 */
function listCell(entries: Entry[] | null, noun: string): Cell | null {
  if (entries === null) return null;
  if (!entries.length) return { text: "None" };
  const names = entries.filter((candidate) => !candidate.note);
  const items = [...names, ...entries.filter((candidate) => candidate.note)].map(({ text, mono, secondary }): CellItem => ({ text, ...(mono ? { mono } : {}), ...(secondary ? { secondary } : {}) }));
  if (entries.length === 1 || !names.length) return { text: "", items };
  const count = countLabel(names.length, noun);
  return { text: names.length < entries.length ? `At least ${count}` : count, items };
}

const factParts = (fact: Fact) => partsOf(fact.value, fact.rule);

/** The Composition category's columns. Exposes, Loads, and Shares appear only when some row fills them. */
export const COMPOSITION: Layout = {
  generic: false,
  columns: [
    { label: "Composition", cell: (fact) => factParts(fact)?.unit ?? null },
    { label: "Exposes", optional: true, sparse: true, cell: (fact) => listCell(factParts(fact)?.exposes ?? null, "module") },
    { label: "Loads", optional: true, sparse: true, cell: (fact) => listCell(factParts(fact)?.loads ?? null, "remote") },
    { label: "Shares", optional: true, sparse: true, cell: (fact) => listCell(factParts(fact)?.shares ?? null, "package") },
  ],
};

/** A fact's values: its own, or each of its candidates' when it conflicts. */
const valuesOf = (fact: Fact): { value: JsonValue; rule: string }[] => (fact.state === "conflicting" ? (fact.candidates ?? []).map((candidate) => ({ value: candidate.value, rule: candidate.rule })) : [{ value: fact.value, rule: fact.rule }]);

const mechanismOf = (fact: Fact): string | null => {
  const [first] = valuesOf(fact);
  return first && isJsonObject(first.value) && typeof first.value.mechanism === "string" ? first.value.mechanism : null;
};

/** A summary's state: Conflicting when any fact conflicts, the facts' state when they agree, and Mixed otherwise. */
function summaryState(facts: Fact[]): string {
  if (facts.some((fact) => fact.state === "conflicting")) return "conflicting";
  const states = new Set(facts.map((fact) => fact.state));
  return states.size === 1 ? facts[0]!.state : "mixed";
}

/** Each of a fact's values as its parts, a conflict's candidates included. */
const allParts = (fact: Fact): Parts[] => valuesOf(fact).flatMap(({ value, rule }) => partsOf(value, rule) ?? []);

/** How many distinct names a list holds across a fact's values, so a conflict counts each name once. */
function distinctNames(fact: Fact, list: (parts: Parts) => Entry[] | null): number {
  return new Set(allParts(fact).flatMap((parts) => (list(parts) ?? []).filter((candidate) => !candidate.note).map((candidate) => candidate.text))).size;
}

/** What a mechanism's facts amount to, in a phrase: "chrome · exposes 12 modules". */
function summaryText(mechanism: string, facts: Fact[]): string {
  if (mechanism === "module-federation" || mechanism === "native-federation") {
    // A container's candidates share its name, which its fact's key is made from.
    const names = [...new Set(facts.flatMap((fact) => allParts(fact).slice(0, 1)).filter((parts) => parts.unit.mono).map((parts) => parts.unit.text))];
    const exposes = facts.reduce((sum, fact) => sum + distinctNames(fact, (parts) => parts.exposes), 0);
    const remotes = facts.reduce((sum, fact) => sum + distinctNames(fact, (parts) => parts.loads), 0);
    return [
      names.length === facts.length && names.length <= 3 ? names.join(", ") : countLabel(facts.length, "container"),
      exposes ? `exposes ${countLabel(exposes, "module")}` : null,
      remotes ? `loads ${countLabel(remotes, "remote")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (mechanism === "single-spa") {
    const roles = new Set(facts.flatMap((fact) => valuesOf(fact).map(({ value }) => (isJsonObject(value) ? value.role : null))));
    const registrations = facts.filter((fact) => valuesOf(fact).some(({ value }) => isJsonObject(value) && value.role === "registration")).length;
    return [roles.has("root-config") ? "root config" : null, roles.has("application") ? "application" : null, registrations ? `registers ${countLabel(registrations, "application")}` : null].filter(Boolean).join(" · ");
  }
  if (mechanism === "import-map") return countLabel(facts.length, "specifier");
  if (mechanism === "iframe") return countLabel(facts.length, "embedded frame");
  return countLabel(facts.length, "fact");
}

/**
 * The overview's Composition values: one per mechanism, in the order the
 * facts name them, each with what its facts expose, load, and register. A
 * conflict's candidates all count, so the summary never picks one of them.
 */
export function compositionSummary(facts: Fact[]): OverviewValue[] {
  const groups = new Map<string, Fact[]>();
  // A fact that names no mechanism, such as an unknown one, is its own value, as in any other row.
  const others: OverviewValue[] = [];
  for (const fact of facts) {
    const mechanism = mechanismOf(fact);
    if (mechanism) groups.set(mechanism, [...(groups.get(mechanism) ?? []), fact]);
    else others.push({ state: fact.state, text: factText(fact.state, fact.value) });
  }
  return [...[...groups].map(([mechanism, group]) => ({ state: summaryState(group), text: mechanismText(mechanism, group), secondary: summaryText(mechanism, group) || undefined })), ...others];
}

/** A mechanism by name, with the Module Federation generations its builds use: "Module Federation 1", "Module Federation 1 and 2". */
function mechanismText(mechanism: string, facts: Fact[]): string {
  if (mechanism !== "module-federation") return kindLabel(mechanism);
  const generations = [...new Set(facts.flatMap((fact) => valuesOf(fact)).flatMap(({ value, rule }) => (isJsonObject(value) ? [federationOf(value, rule).generation] : [])))];
  const known = generations.filter((generation): generation is string => generation !== null).sort();
  // A build whose generation isn't known leaves the mechanism unqualified, so the summary never claims more than its facts.
  return known.length && known.length === generations.length ? `Module Federation ${known.join(" and ")}` : kindLabel(mechanism);
}
