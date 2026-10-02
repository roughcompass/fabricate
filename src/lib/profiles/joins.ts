import type { CategoryDefinition, JsonObject, JsonValue } from "@repo-facts/contract";
import { type Fact, type FactDocument, type NoValue, categoryOf, noValue } from "./states";

/**
 * The tables that several categories share, because they describe the same
 * subjects: Dependencies, Resolved versions, and Packages consumed describe
 * the same packages; Package scripts and Verification commands the same
 * scripts. Each row keeps every fact it joins, so no fact is lost.
 */

export interface DependencyRow {
  /** Unique within the table: the manifest, the field that declares the package, and its name. */
  id: string;
  name: string;
  manifest: string | null;
  declared: Fact | null;
  resolved: Fact | null;
  consumed: Fact | null;
}

/** A manifest's dependencies, or, with no manifest, packages consumed that no manifest declares. */
export interface DependencyGroup {
  manifest: string | null;
  rows: DependencyRow[];
}

export interface ScriptRow {
  id: string;
  name: string;
  manifest: string | null;
  script: Fact | null;
  /** The verification command that runs this script, with what it checks. */
  verification: Fact | null;
}

/** A manifest's scripts, or, with no manifest, declared verification commands that are neither scripts nor CI steps. */
export interface ScriptGroup {
  manifest: string | null;
  rows: ScriptRow[];
}

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const stringField = (fact: Fact, name: string): string | null => (isObject(fact.value) && typeof fact.value[name] === "string" ? (fact.value[name] as string) : null);
const facts = (document: FactDocument, id: string): Fact[] => categoryOf(document, id)?.facts ?? [];

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** The repository's root manifest first, then the others by path. */
const byManifest = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a === "package.json" ? -1 : b === "package.json" ? 1 : compare(a, b));

function grouped<Row extends { id: string; manifest: string | null; name: string }>(rows: Row[]): { manifest: string | null; rows: Row[] }[] {
  const groups = new Map<string | null, Row[]>();
  for (const row of rows) groups.set(row.manifest, [...(groups.get(row.manifest) ?? []), row]);
  return [...groups.entries()].sort(([a], [b]) => byManifest(a, b)).map(([manifest, members]) => ({ manifest, rows: members.sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id)) }));
}

/**
 * Declared dependencies with their resolved versions and consumed packages,
 * one row per manifest and package, grouped by manifest. A package one
 * manifest declares in two fields, such as a dependency that is also a peer,
 * is a row per field, and those rows share its resolved version.
 */
export function dependencyGroups(document: FactDocument): DependencyGroup[] {
  const rows = new Map<string, DependencyRow>();
  const add = (id: string, manifest: string | null, name: string) => {
    if (!rows.has(id)) rows.set(id, { id, name, manifest, declared: null, resolved: null, consumed: null });
    return rows.get(id)!;
  };
  const where = (manifest: string | null, name: string) => [...rows.values()].filter((entry) => entry.manifest === manifest && entry.name === name);
  // A value without a manifest or name still gets a row of its own, keyed by its fact.
  for (const fact of facts(document, "dependencies")) {
    const manifest = stringField(fact, "manifest");
    const name = stringField(fact, "name") ?? fact.key;
    add(`${manifest ?? ""}#${stringField(fact, "field") ?? ""}#${name}`, manifest, name).declared = fact;
  }
  for (const fact of facts(document, "resolved_dependencies")) {
    const manifest = stringField(fact, "manifest");
    const name = stringField(fact, "name") ?? fact.key;
    const declared = where(manifest, name);
    for (const entry of declared.length ? declared : [add(`${manifest ?? ""}##${name}`, manifest, name)]) entry.resolved = fact;
  }
  for (const fact of facts(document, "packages_consumed")) {
    const name = stringField(fact, "name") ?? fact.key;
    const named = [...rows.values()].filter((entry) => entry.name === name && entry.manifest !== null);
    for (const entry of named.length ? named : [add(`##${name}`, null, name)]) entry.consumed = fact;
  }
  return grouped([...rows.values()]);
}

/** Package scripts with the verification commands that run them, grouped by manifest, and the verification commands of each CI definition. */
export function scriptGroups(document: FactDocument): { groups: ScriptGroup[]; ciSteps: Map<string, Fact[]> } {
  const rows = new Map<string, ScriptRow>();
  for (const fact of facts(document, "scripts")) {
    const manifest = stringField(fact, "manifest");
    const name = stringField(fact, "name") ?? fact.key;
    rows.set(`${manifest ?? ""}#${name}`, { id: `${manifest ?? ""}#${name}`, name, manifest, script: fact, verification: null });
  }
  const definitions = new Set(facts(document, "ci_systems").map((fact) => stringField(fact, "path") ?? fact.key));
  const ciSteps = new Map<string, Fact[]>();
  for (const fact of facts(document, "verification_commands")) {
    const source = stringField(fact, "source");
    const context = isObject(fact.value) && isObject(fact.value.context) ? fact.value.context : {};
    const script = typeof context.script === "string" ? context.script : null;
    const match = script !== null ? rows.get(`${source ?? ""}#${script}`) : undefined;
    if (match && !match.verification) match.verification = fact;
    else if (source !== null && definitions.has(source)) ciSteps.set(source, [...(ciSteps.get(source) ?? []), fact]);
    else rows.set(`#${fact.key}`, { id: `#${fact.key}`, name: fact.key, manifest: null, script: null, verification: fact });
  }
  return { groups: grouped([...rows.values()]), ciSteps };
}

/**
 * Why a shared table's cell has no fact. A category with no facts at all
 * gives its own reason. Otherwise the cell reads None detected only when the
 * category may claim absence after a complete search with nothing skipped,
 * and Unknown in every other case.
 */
export function missingCell(document: FactDocument, definition: CategoryDefinition, reasons: { absent: string; unknown: string }): NoValue {
  const category = categoryOf(document, definition.id);
  if (!category || !category.facts.length) return noValue(document, definition);
  if (definition.boundedNegative && category.search.complete && !category.search.skipped.length) return { state: "absent", reason: reasons.absent };
  return { state: "unknown", reason: reasons.unknown };
}
