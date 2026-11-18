import type { CategoryDefinition, JsonObject, JsonValue } from "@repo-facts/contract";
import { formatValue } from "@/components/results/value";
import { checkKind, kindLabel } from "@/components/ui/status";
import { type Attention, attention } from "./attention";
import { type DependencyRow, type ScriptGroup, type ScriptRow, dependencyGroups, missingCell, scriptGroups } from "./joins";
import { type Cell, type RowCells, layoutOf, rowCells } from "./layouts";
import { type OverviewRow, overview } from "./overview";
import { type Fact, type FactDocument, type NoValue, type Search, categoryDefinitions, categoryOf, categoryState, noValue } from "./states";

/**
 * Everything the Repository Profile page shows, derived once from the stored
 * fact document: the overview, the attention list, each group's sections, the
 * Service Dependencies, and the diagnostics. The page renders this and
 * nothing else, and every fact, candidate, and evidence record in the
 * document appears somewhere in it.
 */

/** A fact a row holds, for the row's disclosure: its key, raw value, and evidence, and its rule when that differs from its category's. */
export interface HeldFact {
  category: string;
  fact: Fact;
  /** The fact's rule, when its category's facts came from more than one. */
  rule: string | null;
}

export interface Row {
  id: string;
  /** The row's state, only when it differs from its category's. */
  state: string | null;
  /** Why an inferred fact holds, shown with its value. */
  reasoning: string | null;
  cells: RowCells;
  /** Cells taken from another category, such as the CI steps of a definition. */
  steps: Cell[];
  /** What those steps check, each named once, for the row's summary. */
  checks: string[];
  held: HeldFact[];
  evidence: string[];
  /** How many facts the row stands for: facts whose cells are identical share one row. */
  occurrences: number;
}

/** A category's heading: its state, its search, and the rules its facts came from. */
export interface Heading {
  definition: CategoryDefinition;
  state: string;
  /** How many facts the category holds; a shared table leaves out the columns of a category with none. */
  facts: number;
  /** Why a category with no facts has none, in a sentence. */
  reason: string | null;
  search: Search | null;
  rules: string[];
}

export interface CategoryBlock {
  kind: "category";
  heading: Heading;
  columns: string[];
  /** The label of a column filled from another category, such as Steps. */
  stepsColumn: string | null;
  rows: Row[];
}

/** One cell of a shared table: a value, with its state when that differs from its category's, the whole fact as text, or why there is none. */
export type SharedCell = { kind: "value"; cell: Cell; state: string | null } | { kind: "whole"; text: string } | { kind: "none"; value: NoValue };

export interface SharedRow {
  id: string;
  name: string;
  manifest: string | null;
  /** The manifest field that declares a dependency, for the kind filter. */
  field: string | null;
  cells: SharedCell[];
  held: HeldFact[];
  evidence: string[];
}

export interface SharedBlock {
  kind: "dependencies" | "scripts";
  /** The source categories, each with its own heading line. */
  sources: Heading[];
  /** Each column's label, and the category it's taken from. */
  columns: { label: string; category: string | null }[];
  /** Each manifest's rows, and how many rows it holds when a page shows only some of them. */
  groups: { manifest: string | null; rows: SharedRow[]; total?: number }[];
}

export interface CompactBlock {
  kind: "compact";
  group: string;
  items: { definition: CategoryDefinition; value: NoValue }[];
}

export type Block = CategoryBlock | SharedBlock | CompactBlock;

export interface ServiceSummary {
  key: string;
  endpoint: { text: string; resolved: boolean; detail: string | null };
  client: string;
  /** The first call site's evidence, and how many more there are. */
  callSite: string | null;
  moreCallSites: number;
  characterized: boolean;
  service: JsonObject;
}

export interface ProfileView {
  overview: OverviewRow[];
  attention: Attention;
  groups: { label: string; blocks: Block[] }[];
  /** Navigation entries: each category with its state, by group. */
  navigation: { label: string; items: { id: string; label: string; state: string }[] }[];
  services: ServiceSummary[];
  diagnostics: { skipped: JsonObject[]; notes: JsonObject[] };
}

// The categories that share a table, and the group the table appears in.
const DEPENDENCY_SOURCES = ["dependencies", "resolved_dependencies", "packages_consumed"];
const SCRIPT_SOURCES = ["scripts", "verification_commands"];
const SHARED = new Set([...DEPENDENCY_SOURCES, ...SCRIPT_SOURCES]);

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const unique = <T>(values: T[]) => [...new Set(values)];

/** Every evidence id a fact cites, its candidates' included. */
const evidenceOf = (fact: Fact) => unique([...fact.evidence, ...(fact.candidates ?? []).flatMap((candidate) => candidate.evidence)]);

function headingOf(document: FactDocument, definition: CategoryDefinition): Heading {
  const category = categoryOf(document, definition.id);
  const rules = category?.facts.length ? unique(category.facts.map((fact) => fact.rule)) : (category?.search.rules ?? []);
  const facts = category?.facts.length ?? 0;
  return { definition, state: categoryState(document, definition.id), facts, reason: facts ? null : noValue(document, definition).reason, search: category?.search ?? null, rules };
}

function held(document: FactDocument, category: string, fact: Fact): HeldFact {
  const rules = unique(categoryOf(document, category)?.facts.map((candidate) => candidate.rule) ?? []);
  return { category, fact, rule: rules.length > 1 ? fact.rule : null };
}

/** A fact's state, when it differs from its category's. In a mixed category, observed is the norm, so only the others show. */
function differing(document: FactDocument, category: string, fact: Fact): string | null {
  const state = categoryState(document, category);
  return fact.state === state || (state === "mixed" && fact.state === "observed") ? null : fact.state;
}

function stepCell(fact: Fact): Cell {
  const value = isObject(fact.value) ? fact.value : {};
  const context = isObject(value.context) ? value.context : {};
  // Steps are numbered from 0 in the document, and from 1 for people.
  const step = typeof context.step === "string" && /^\d+$/.test(context.step) ? String(Number(context.step) + 1) : context.step;
  const where = typeof context.job === "string" ? `${context.job} · step ${String(step ?? "")}` : fact.key;
  const kinds = Array.isArray(value.kinds) && value.kinds.length ? value.kinds.map((kind) => checkKind(String(kind))).join(", ") : undefined;
  return { text: typeof value.command === "string" ? value.command : formatValue(fact.value), mono: true, secondary: [where, kinds].filter(Boolean).join(" · ") };
}

function categoryBlock(document: FactDocument, definition: CategoryDefinition, ciSteps: Map<string, Fact[]>): CategoryBlock {
  const layout = layoutOf(definition.id);
  const all = categoryOf(document, definition.id)?.facts ?? [];
  const facts = layout.sort ? [...all].sort(layout.sort) : all;
  const isCi = definition.id === "ci_systems";
  return {
    kind: "category",
    heading: headingOf(document, definition),
    columns: layout.columns.map((column) => column.label),
    stepsColumn: isCi ? "Steps" : null,
    rows: mergeIdentical(
      facts.map((fact): Row => {
      const path = isObject(fact.value) && typeof fact.value.path === "string" ? fact.value.path : fact.key;
      const steps = isCi ? (ciSteps.get(path) ?? []) : [];
      return {
        id: fact.key,
        state: differing(document, definition.id, fact),
        reasoning: fact.reasoning ?? null,
        cells: rowCells(layout, fact),
        steps: steps.map(stepCell),
        checks: unique(steps.flatMap((step) => (isObject(step.value) && Array.isArray(step.value.kinds) ? step.value.kinds.map((kind) => checkKind(String(kind))) : []))),
        held: [held(document, definition.id, fact), ...steps.map((step) => held(document, "verification_commands", step))],
        evidence: unique([...evidenceOf(fact), ...steps.flatMap(evidenceOf)]),
        occurrences: 1,
      };
      }),
    ),
  };
}

/**
 * Rows a reader couldn't tell apart, such as the same module mocked in many
 * test files, as one row that holds every one of their facts and evidence
 * records and counts them.
 */
function mergeIdentical(rows: Row[]): Row[] {
  const merged = new Map<string, Row>();
  for (const row of rows) {
    const key = JSON.stringify([row.cells, row.state, row.reasoning, row.steps]);
    const existing = merged.get(key);
    if (existing) merged.set(key, { ...existing, held: [...existing.held, ...row.held], evidence: unique([...existing.evidence, ...row.evidence]), occurrences: existing.occurrences + 1 });
    else merged.set(key, row);
  }
  return [...merged.values()];
}

const NOT_ESTABLISHED = { absent: "Not found by a complete search", unknown: "Not established for this row" };

/** A shared table's cell from +fact+'s column +index+ of its category's layout, or why the row has no such fact. */
function sharedCell(document: FactDocument, definitions: Map<string, CategoryDefinition>, category: string, fact: Fact | null, index: number, reasons = NOT_ESTABLISHED): SharedCell {
  if (!fact) return { kind: "none", value: missingCell(document, definitions.get(category)!, reasons) };
  const row = rowCells(layoutOf(category), fact);
  if (row.kind === "whole") return { kind: "whole", text: row.text };
  if (row.kind === "candidates") return { kind: "whole", text: `Conflicting: ${row.candidates.map((candidate) => candidate.text).join(" or ")}` };
  const cell = row.cells[index];
  return cell ? { kind: "value", cell, state: differing(document, category, fact) } : { kind: "none", value: missingCell(document, definitions.get(category)!, reasons) };
}

function dependencyBlock(document: FactDocument, definitions: Map<string, CategoryDefinition>): SharedBlock {
  const row = (entry: DependencyRow): SharedRow => {
    const facts = [
      ["dependencies", entry.declared],
      ["resolved_dependencies", entry.resolved],
      ["packages_consumed", entry.consumed],
    ].filter((pair): pair is [string, Fact] => pair[1] !== null);
    const field = entry.declared && isObject(entry.declared.value) && typeof entry.declared.value.field === "string" ? entry.declared.value.field : null;
    const declared = { absent: "Not declared in this manifest", unknown: "Not established for this package" };
    return {
      id: entry.id,
      name: entry.name,
      manifest: entry.manifest,
      field,
      cells: [
        { kind: "value", cell: { text: entry.name, mono: true }, state: null },
        // Without a declaration, the Declared cell says why once, and Kind stays empty.
        entry.declared ? sharedCell(document, definitions, "dependencies", entry.declared, 1, declared) : { kind: "value", cell: { text: "" }, state: null },
        sharedCell(document, definitions, "dependencies", entry.declared, 2, declared),
        sharedCell(document, definitions, "resolved_dependencies", entry.resolved, 1, { absent: "No lockfile resolves this package", unknown: "No lockfile entry was found for this package" }),
        sharedCell(document, definitions, "packages_consumed", entry.consumed, 1, { absent: "Not consumed", unknown: "Not established for this package" }),
      ],
      held: facts.map(([category, fact]) => held(document, category, fact)),
      evidence: unique(facts.flatMap(([, fact]) => evidenceOf(fact))),
    };
  };
  // A resolved version that repeats its declared range reads as secondary, so the ones that differ stand out.
  const quiet = (shared: SharedRow): SharedRow => {
    const [, , declared, resolved] = shared.cells;
    if (declared?.kind !== "value" || resolved?.kind !== "value" || declared.cell.text !== resolved.cell.text) return shared;
    return { ...shared, cells: shared.cells.map((cell, index) => (index === 3 && cell.kind === "value" ? { ...cell, cell: { ...cell.cell, muted: true } } : cell)) };
  };
  return {
    kind: "dependencies",
    sources: DEPENDENCY_SOURCES.map((id) => headingOf(document, definitions.get(id)!)),
    columns: [
      { label: "Package", category: null },
      { label: "Kind", category: "dependencies" },
      { label: "Declared", category: "dependencies" },
      { label: "Resolved", category: "resolved_dependencies" },
      { label: "Consumed", category: "packages_consumed" },
    ],
    groups: dependencyGroups(document).map((group) => ({ manifest: group.manifest, rows: group.rows.map(row).map(quiet) })),
  };
}

function scriptBlock(document: FactDocument, definitions: Map<string, CategoryDefinition>, groups: ScriptGroup[]): SharedBlock {
  const row = (entry: ScriptRow): SharedRow => {
    const facts = [
      ["scripts", entry.script],
      ["verification_commands", entry.verification],
    ].filter((pair): pair is [string, Fact] => pair[1] !== null);
    // A row is a script, a verification command that is neither a script nor a CI step, or both joined.
    const command = entry.script ? sharedCell(document, definitions, "scripts", entry.script, 1) : sharedCell(document, definitions, "verification_commands", entry.verification, 0);
    return {
      id: entry.id,
      name: entry.name,
      manifest: entry.manifest,
      field: null,
      cells: [{ kind: "value", cell: { text: entry.name, mono: true }, state: null }, command, checks(entry.verification)],
      held: facts.map(([category, fact]) => held(document, category, fact)),
      evidence: unique(facts.flatMap(([, fact]) => evidenceOf(fact))),
    };
  };
  // A script that no verification command runs checks nothing; that's a value, not a missing one.
  const checks = (fact: Fact | null): SharedCell => {
    if (!fact) return { kind: "value", cell: { text: "None" }, state: null };
    const cell = sharedCell(document, definitions, "verification_commands", fact, 1);
    return cell.kind === "none" ? { kind: "value", cell: { text: "None" }, state: differing(document, "verification_commands", fact) } : cell;
  };
  const rows = groups.map((group) => ({ manifest: group.manifest, rows: group.rows.map(row) }));
  return {
    kind: "scripts",
    sources: SCRIPT_SOURCES.map((id) => headingOf(document, definitions.get(id)!)),
    columns: [
      { label: "Script", category: "scripts" },
      { label: "Command", category: "scripts" },
      { label: "Checks", category: "verification_commands" },
    ],
    groups: rows,
  };
}

function endpointOf(service: JsonObject): ServiceSummary["endpoint"] {
  const endpoint = isObject(service.endpoint) ? service.endpoint : {};
  const value = isObject(endpoint.value) ? endpoint.value : {};
  const known = endpoint.state === "observed" || endpoint.state === "inferred";
  if (!known || value.derivation === "unknown") return { text: "Unresolved endpoint", resolved: false, detail: typeof value.detail === "string" ? value.detail : null };
  if (typeof value.origin === "string") return { text: value.origin, resolved: true, detail: null };
  if (value.derivation === "configured" && typeof value.key === "string") return { text: `${String(value.source ?? "configuration")}.${value.key}`, resolved: true, detail: "Configured" };
  if (value.derivation === "relative") return { text: typeof value.base_path === "string" ? `Same origin ${value.base_path}` : "Same origin", resolved: true, detail: null };
  return { text: formatValue(endpoint.value), resolved: true, detail: null };
}

function serviceSummary(service: JsonObject): ServiceSummary {
  const client = isObject(service.client) ? service.client : {};
  const callSites = Array.isArray(service.call_sites) ? service.call_sites.map(String) : [];
  return {
    key: String(service.key),
    endpoint: endpointOf(service),
    client: [typeof client.kind === "string" ? kindLabel(client.kind) : "Unknown client", typeof client.package === "string" ? client.package : null].filter(Boolean).join(" from "),
    callSite: callSites[0] ?? null,
    moreCallSites: Math.max(0, callSites.length - 1),
    characterized: service.characterizable === true,
    service,
  };
}

/** The Dependencies table's filters, as the page's query holds them. */
export interface DependencyFilters {
  /** The manifest field that declares a package, such as `devDependencies`. */
  kind?: string;
  manifest?: string;
  /** Part of a package name, in any case. */
  package?: string;
}

/** One page of a shared table's rows, in manifest order, each group keeping the count of rows it holds in all. */
export function pageOfGroups(block: SharedBlock, page: number, size: number): SharedBlock {
  const start = (page - 1) * size;
  let offset = 0;
  const groups = block.groups.flatMap((group) => {
    const first = offset;
    offset += group.rows.length;
    const rows = group.rows.slice(Math.max(0, start - first), Math.max(0, start + size - first));
    return rows.length ? [{ ...group, rows, total: group.total ?? group.rows.length }] : [];
  });
  return { ...block, groups };
}

/** The Dependencies table with only the rows its filters match, and how many rows it holds in all. */
export function filterDependencies(block: SharedBlock, filters: DependencyFilters): { block: SharedBlock; shown: number; total: number } {
  const search = filters.package?.trim().toLowerCase();
  const matches = (row: SharedRow) => (!filters.kind || row.field === filters.kind) && (!filters.manifest || row.manifest === filters.manifest) && (!search || row.name.toLowerCase().includes(search));
  const groups = block.groups.map((group) => ({ ...group, rows: group.rows.filter(matches) }));
  const count = (entries: SharedBlock["groups"]) => entries.reduce((sum, group) => sum + group.rows.length, 0);
  return { block: { ...block, groups }, shown: count(groups), total: count(block.groups) };
}

export function profileView(document: FactDocument, diagnostics: { skipped: JsonObject[]; notes: JsonObject[] }): ProfileView {
  const definitions = categoryDefinitions(document);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const scripts = scriptGroups(document);
  const hasFacts = (id: string) => Boolean(categoryOf(document, id)?.facts.length);
  const dependenciesShared = DEPENDENCY_SOURCES.some(hasFacts);
  const scriptsShared = SCRIPT_SOURCES.some(hasFacts);

  const groups = unique(definitions.map((definition) => definition.group)).map((group) => {
    const blocks: Block[] = [];
    const compact: CompactBlock = { kind: "compact", group, items: [] };
    for (const definition of definitions.filter((candidate) => candidate.group === group)) {
      const id = definition.id;
      if (SHARED.has(id) && (DEPENDENCY_SOURCES.includes(id) ? dependenciesShared : scriptsShared)) {
        // The shared table appears once, where its first source category is.
        if (id === "dependencies") blocks.push(dependencyBlock(document, byId));
        if (id === "scripts") blocks.push(scriptBlock(document, byId, scripts.groups));
        continue;
      }
      if (hasFacts(id)) blocks.push(categoryBlock(document, definition, scripts.ciSteps));
      else compact.items.push({ definition, value: noValue(document, definition) });
    }
    if (compact.items.length) blocks.push(compact);
    return { label: group, blocks };
  });

  return {
    overview: overview(document),
    attention: attention(document, diagnostics),
    groups,
    navigation: unique(definitions.map((definition) => definition.group)).map((group) => ({
      label: group,
      items: definitions.filter((definition) => definition.group === group).map((definition) => ({ id: definition.id, label: definition.label, state: categoryState(document, definition.id) })),
    })),
    services: (document.service_dependencies ?? []).map(serviceSummary),
    diagnostics,
  };
}
