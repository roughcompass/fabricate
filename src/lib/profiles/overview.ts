import type { CategoryDefinition, JsonObject, JsonValue } from "@repo-facts/contract";
import { factText, formatValue } from "@/components/results/value";
import { countLabel } from "@/components/ui/count";
import { ciSystem, kindLabel, runtimeName } from "@/components/ui/status";
import { dependencyGroups } from "./joins";
import { type Fact, type FactDocument, type NoValue, categoryDefinitions, categoryOf, noValue } from "./states";

/** One value in the overview, with the state of the fact it comes from. Scope values come from the inventory and carry no state. */
export interface OverviewValue {
  state: string | null;
  text: string;
  secondary?: string;
}

/** A category of a row that has no value, with why. A row of several categories names which one. */
export interface OverviewPlaceholder {
  label?: string;
  value: NoValue;
}

export interface OverviewRow {
  label: string;
  /** The category the row links to, or null for Scope. */
  category: string | null;
  values: OverviewValue[];
  placeholders: OverviewPlaceholder[];
  /** Values left out after the first few, such as further languages. */
  more: number;
}

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const field = (fact: Fact, name: string): string | null => (isObject(fact.value) && (typeof fact.value[name] === "string" || typeof fact.value[name] === "number") ? String(fact.value[name]) : null);
const distinct = (values: OverviewValue[]) => values.filter((value, index) => values.findIndex((other) => other.text === value.text && other.state === value.state) === index);

/** A conflicting fact's candidates as one value, so the overview never picks one: "18 or >=20". */
function candidates(fact: Fact): string {
  const declared = (value: JsonValue) => (isObject(value) && (typeof value.declared === "string" || Array.isArray(value.declared)) ? formatValue(value.declared) : formatValue(value));
  return (fact.candidates ?? []).map((candidate) => declared(candidate.value)).join(" or ");
}

/** A fact as an overview value: +describe+ for a fact with a value, its candidates when conflicting, and its reason when unknown. */
function valueOf(fact: Fact, describe: (fact: Fact) => OverviewValue | null): OverviewValue {
  if (fact.state === "conflicting") return { state: "conflicting", text: candidates(fact) };
  if (fact.state === "unknown") return { state: "unknown", text: factText(fact.state, fact.value) };
  return describe(fact) ?? { state: fact.state, text: formatValue(fact.value) };
}

interface RowDefinition {
  label: string;
  categories: string[];
  describe: (fact: Fact, category: string, document: FactDocument) => OverviewValue | null;
  /** How many values to show before "+N more". */
  limit?: number;
  order?: (facts: Fact[]) => Fact[];
}

const ROWS: RowDefinition[] = [
  {
    label: "Packages",
    categories: ["package_identity"],
    describe: (fact, _category, document) => {
      const name = field(fact, "name");
      if (name === null) return null;
      const manifest = field(fact, "manifest");
      const produced = categoryOf(document, "packages_produced")?.facts.find((candidate) => field(candidate, "manifest") === manifest);
      const published = produced && isObject(produced.value) ? produced.value.published : undefined;
      const visibility = published === true ? "published" : isObject(fact.value) && fact.value.private === true ? "private" : "not private";
      const directory = manifest && manifest.includes("/") ? `${manifest.slice(0, manifest.lastIndexOf("/") + 1)}` : null;
      return { state: fact.state, text: [name, field(fact, "version")].filter(Boolean).join(" "), secondary: [visibility, directory].filter(Boolean).join(" · ") };
    },
  },
  {
    label: "Languages",
    categories: ["languages"],
    limit: 3,
    order: (facts) => [...facts].sort((a, b) => Number(field(b, "files") ?? 0) - Number(field(a, "files") ?? 0)),
    describe: (fact) => ({ state: fact.state, text: fact.key, secondary: field(fact, "files") === null ? undefined : countLabel(Number(field(fact, "files")), "file") }),
  },
  {
    label: "Framework",
    categories: ["frameworks"],
    describe: (fact) => {
      const label = field(fact, "label");
      const specifiers = isObject(fact.value) ? fact.value.specifiers : undefined;
      const version = isObject(specifiers) ? Object.values(specifiers).find((value) => typeof value === "string") : undefined;
      return label === null ? null : { state: fact.state, text: [label, version].filter(Boolean).join(" ") };
    },
  },
  { label: "Build", categories: ["build_tools"], describe: (fact) => (field(fact, "label") === null ? null : { state: fact.state, text: field(fact, "label")! }) },
  { label: "Tests", categories: ["test_frameworks"], describe: (fact) => (field(fact, "label") === null ? null : { state: fact.state, text: field(fact, "label")! }) },
  {
    label: "Tooling",
    categories: ["package_managers", "ci_systems"],
    describe: (fact, category) => {
      if (category === "package_managers") return typeof fact.value === "string" ? { state: fact.state, text: fact.value } : null;
      const system = field(fact, "system");
      return system === null ? null : { state: fact.state, text: ciSystem(system) };
    },
  },
  {
    label: "Runtime",
    categories: ["runtime_requirements"],
    describe: (fact) => (field(fact, "range") === null ? null : { state: fact.state, text: `${runtimeName(fact.key)} ${field(fact, "range")}` }),
  },
  {
    label: "Composition",
    categories: ["composition"],
    describe: (fact) => {
      const mechanism = field(fact, "mechanism");
      return mechanism === null ? null : { state: fact.state, text: kindLabel(mechanism) };
    },
  },
  { label: "Design system", categories: ["design_systems"], describe: (fact) => (field(fact, "name") === null ? null : { state: fact.state, text: field(fact, "name")! }) },
];

/**
 * What the repository is, in fixed rows that always appear. A value carries
 * its fact's state; a conflict shows its candidates, never one of them; and a
 * category with no value shows its state and reason instead of being left out.
 */
export function overview(document: FactDocument): OverviewRow[] {
  const definitions = new Map(categoryDefinitions(document).map((definition) => [definition.id, definition]));
  const rows = ROWS.map((row): OverviewRow => {
    const values: OverviewValue[] = [];
    const placeholders: OverviewPlaceholder[] = [];
    for (const id of row.categories) {
      const definition = definitions.get(id) as CategoryDefinition;
      const facts = categoryOf(document, id)?.facts ?? [];
      if (!facts.length) {
        placeholders.push({ label: row.categories.length > 1 ? definition.label : undefined, value: noValue(document, definition) });
        continue;
      }
      // A fact on the conflicting side of a runtime names its runtime.
      const described = (row.order ? row.order(facts) : facts).map((fact) => {
        const value = valueOf(fact, (candidate) => row.describe(candidate, id, document));
        return id === "runtime_requirements" && fact.state !== "observed" && fact.state !== "inferred" ? { ...value, text: `${runtimeName(fact.key)}: ${value.text}` } : value;
      });
      values.push(...distinct(described));
    }
    const shown = row.limit ? values.slice(0, row.limit) : values;
    return { label: row.label, category: row.categories[0]!, values: shown, placeholders, more: values.length - shown.length };
  });
  return [...rows, scope(document)];
}

/** How much of the commit was read, and how much the Profile found. Files no detector opened are neither read nor skipped. */
function scope(document: FactDocument): OverviewRow {
  const inventory = document.inventory ?? {};
  const dependencies = dependencyGroups(document).reduce((sum, group) => sum + group.rows.filter((row) => row.declared).length, 0);
  const values: OverviewValue[] = [
    ...(typeof inventory.files === "number" ? [{ state: null, text: `${(inventory.files_read ?? 0).toLocaleString("en-US")} of ${countLabel(inventory.files, "file")} read` }] : []),
    { state: null, text: countLabel(dependencies, "dependency", "dependencies") },
    { state: null, text: countLabel(categoryOf(document, "scripts")?.facts.length ?? 0, "script") },
    { state: null, text: countLabel(document.service_dependencies?.length ?? 0, "Service Dependency", "Service Dependencies") },
  ];
  return { label: "Scope", category: null, values, placeholders: [], more: 0 };
}
