import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { factText, formatValue } from "@/components/results/value";
import { formatBytes } from "@/components/ui/count";
import { checkKind, ciSystem, dependencyKind, kindLabel, runtimeName } from "@/components/ui/status";
import type { Fact } from "./states";

/** A cell's content: text, set in the monospace face for identifiers and paths, with optional secondary text below. */
export interface Cell {
  text: string;
  mono?: boolean;
  /** Set in the secondary color, as a value that repeats its neighbor is, so differences stand out. */
  muted?: boolean;
  secondary?: string;
}

export interface Column {
  label: string;
  /** The cell for +fact+, or null when its value lacks the field this column shows. */
  cell: (fact: Fact) => Cell | null;
  /** A column a row may leave empty. When a required column has no cell, the row writes its value out in full. */
  optional?: boolean;
}

/** The columns a category's facts are shown in. A generic layout shows each fact's key and its value as text. */
export interface Layout {
  columns: Column[];
  generic: boolean;
}

/** One fact as a row: its cells, its whole value when the value doesn't fit the columns, or a conflict's candidates. */
export type RowCells = { kind: "cells"; cells: (Cell | null)[] } | { kind: "whole"; text: string } | { kind: "candidates"; candidates: { text: string; evidence: string[] }[] };

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const field = (fact: Fact, name: string): JsonValue | undefined => (isObject(fact.value) ? fact.value[name] : undefined);
const text = (value: JsonValue | undefined): string | null => (typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : null);

/** A column that shows one field of the value. */
const fieldColumn = (label: string, name: string, options: { mono?: boolean; optional?: boolean; format?: (value: string) => string } = {}): Column => ({
  label,
  optional: options.optional,
  cell: (fact) => {
    const value = text(field(fact, name));
    return value === null ? null : { text: options.format ? options.format(value) : value, mono: options.mono };
  },
});

const keyColumn = (label: string, options: { mono?: boolean; format?: (key: string) => string } = {}): Column => ({ label, cell: (fact) => ({ text: options.format ? options.format(fact.key) : fact.key, mono: options.mono }) });

const manifestColumn = fieldColumn("Manifest", "manifest", { mono: true });

/** A tool by its label, with its identifier below. */
const toolColumn: Column = {
  label: "Tool",
  cell: (fact) => {
    const label = text(field(fact, "label"));
    return label === null ? null : { text: label, secondary: text(field(fact, "id")) ?? undefined };
  },
};

const booleanColumn = (label: string, name: string, yes: string, no: string): Column => ({
  label,
  cell: (fact) => {
    const value = field(fact, name);
    return typeof value === "boolean" ? { text: value ? yes : no } : null;
  },
});

// Facts whose values differ by kind lead with that kind; the rest of the value is its detail.
const KIND_FIELDS = ["kind", "mechanism", "contract"];
const LOCATION_FIELDS = ["path", "source", "configuration"];

const KIND_FIRST: Layout = {
  generic: false,
  columns: [
    {
      label: "Kind",
      cell: (fact) => {
        const kind = KIND_FIELDS.map((name) => text(field(fact, name))).find((value) => value !== null);
        return kind ? { text: kindLabel(kind) } : null;
      },
    },
    {
      label: "Detail",
      optional: true,
      cell: (fact) => {
        if (!isObject(fact.value)) return null;
        const location = LOCATION_FIELDS.find((name) => text(field(fact, name)) !== null);
        const rest = Object.fromEntries(Object.entries(fact.value).filter(([name]) => !KIND_FIELDS.includes(name) && name !== location));
        return Object.keys(rest).length ? { text: formatValue(rest) } : null;
      },
    },
    {
      label: "Location",
      optional: true,
      cell: (fact) => {
        const location = LOCATION_FIELDS.map((name) => text(field(fact, name))).find((value) => value !== null);
        return location ? { text: location, mono: true } : null;
      },
    },
  ],
};

const layout = (...columns: Column[]): Layout => ({ generic: false, columns });

const LAYOUTS: Record<string, Layout> = {
  languages: layout(keyColumn("Language"), fieldColumn("Files", "files"), { label: "Size", cell: (fact) => (typeof field(fact, "bytes") === "number" ? { text: formatBytes(field(fact, "bytes") as number) } : null) }),
  submodules: layout(fieldColumn("Path", "path", { mono: true }), fieldColumn("Commit", "commit", { mono: true, format: (commit) => commit.slice(0, 12) })),
  package_identity: layout(fieldColumn("Package", "name", { mono: true }), fieldColumn("Version", "version", { optional: true }), booleanColumn("Visibility", "private", "Private", "Not private"), manifestColumn),
  packages_produced: layout(fieldColumn("Package", "name", { mono: true }), fieldColumn("Version", "version", { optional: true }), booleanColumn("Visibility", "published", "Published", "Not published"), manifestColumn),
  workspaces: layout(fieldColumn("Directory", "directory", { mono: true }), fieldColumn("Package", "package", { mono: true, optional: true })),
  package_managers: layout(keyColumn("Directory", { mono: true, format: (directory) => (directory === "." ? "Repository root" : directory) }), { label: "Manager", cell: (fact) => (typeof fact.value === "string" ? { text: fact.value } : null) }),
  build_tools: layout(toolColumn),
  test_frameworks: layout(toolColumn),
  frameworks: layout(
    fieldColumn("Framework", "label"),
    {
      label: "Version",
      optional: true,
      cell: (fact) => {
        const specifiers = field(fact, "specifiers");
        const first = isObject(specifiers) ? Object.values(specifiers).find((value) => typeof value === "string") : undefined;
        return typeof first === "string" ? { text: first, mono: true } : null;
      },
    },
    manifestColumn,
  ),
  ci_systems: layout(fieldColumn("Definition", "path", { mono: true }), fieldColumn("System", "system", { format: ciSystem })),
  runtime_requirements: layout(
    keyColumn("Runtime", { format: runtimeName }),
    fieldColumn("Allowed range", "range", { mono: true }),
    {
      label: "Declarations",
      optional: true,
      cell: (fact) => {
        const declared = field(fact, "declared");
        return Array.isArray(declared) && declared.length ? { text: declared.map(String).join(", "), mono: true } : null;
      },
    },
  ),
  composition: KIND_FIRST,
  runtime_integrations: KIND_FIRST,
  access_signals: KIND_FIRST,
  egress_routes: KIND_FIRST,
  api_contracts: KIND_FIRST,
  test_substitutes: KIND_FIRST,
  // The categories that share the Dependencies and Scripts tables, as the cells those tables take from them.
  dependencies: layout(fieldColumn("Package", "name", { mono: true }), fieldColumn("Kind", "field", { format: dependencyKind }), fieldColumn("Declared", "specifier", { mono: true }), manifestColumn),
  resolved_dependencies: layout(fieldColumn("Package", "name", { mono: true }), fieldColumn("Resolved", "version", { mono: true }), manifestColumn),
  packages_consumed: layout(fieldColumn("Package", "name", { mono: true }), booleanColumn("Internal", "internal", "Internal", "External")),
  scripts: layout(fieldColumn("Script", "name", { mono: true }), fieldColumn("Command", "command", { mono: true }), manifestColumn),
  verification_commands: layout(
    fieldColumn("Command", "command", { mono: true }),
    {
      label: "Checks",
      optional: true,
      cell: (fact) => {
        const kinds = field(fact, "kinds");
        return Array.isArray(kinds) && kinds.length ? { text: kinds.map((kind) => checkKind(String(kind))).join(", ") } : null;
      },
    },
    fieldColumn("Source", "source", { mono: true }),
  ),
};

const GENERIC: Layout = { generic: true, columns: [keyColumn("Fact", { mono: true }), { label: "Value", cell: (fact) => ({ text: formatValue(fact.value) }) }] };

/** The columns for a category's facts: its own, or the generic fact and value columns for the Interface and extension categories. */
export function layoutOf(id: string): Layout {
  return Object.hasOwn(LAYOUTS, id) ? LAYOUTS[id]! : GENERIC;
}

/**
 * A fact as a row of its layout's cells. A conflict lists its candidates, an
 * unknown fact states why, and a value that lacks a required column's field
 * is written out in full, so no fact is ever dropped.
 */
export function rowCells(layout: Layout, fact: Fact): RowCells {
  if (fact.state === "conflicting") return { kind: "candidates", candidates: (fact.candidates ?? []).map((candidate) => ({ text: formatValue(candidate.value), evidence: candidate.evidence })) };
  if (fact.state === "unknown") return { kind: "whole", text: factText(fact.state, fact.value) };
  const cells = layout.columns.map((column) => column.cell(fact));
  if (layout.columns.some((column, index) => !column.optional && cells[index] === null)) return { kind: "whole", text: formatValue(fact.value) };
  return { kind: "cells", cells };
}
