import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { factText, formatValue } from "@/components/results/value";
import { countLabel, formatBytes } from "@/components/ui/count";
import { checkKind, ciSystem, dependencyKind, humanize, kindLabel, runtimeName } from "@/components/ui/status";
import type { Fact } from "./states";

/** A cell's content: text, set in the monospace face for identifiers, paths, and versions, with optional secondary text below. */
export interface Cell {
  text: string;
  mono?: boolean;
  /** Kept on one line, for short values such as a version or a kind that would otherwise wrap in a narrow column. */
  nowrap?: boolean;
  /** Free text that may hold long unbroken tokens, such as module paths, and may break anywhere so its column can narrow. */
  breakable?: boolean;
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
  /** A count or size, aligned right so its digits line up. */
  numeric?: boolean;
  /** Short values kept on one line. */
  nowrap?: boolean;
  /** Free text that may break anywhere. */
  breakable?: boolean;
}

/** The columns a category's facts are shown in. A generic layout shows each fact's key and its value as text. */
export interface Layout {
  columns: Column[];
  generic: boolean;
  /** The order rows read best in, such as a summary first; facts keep the document's order otherwise. */
  sort?: (a: Fact, b: Fact) => number;
  /** What a row that stands for several identical facts counts; "occurrence" unless the facts are, say, files. */
  unit?: string;
}

/** One fact as a row: its cells, its whole value when the value doesn't fit the columns, or a conflict's candidates. */
export type RowCells = { kind: "cells"; cells: (Cell | null)[] } | { kind: "whole"; text: string } | { kind: "candidates"; candidates: { text: string; evidence: string[] }[] };

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const field = (fact: Fact, name: string): JsonValue | undefined => (isObject(fact.value) ? fact.value[name] : undefined);
const text = (value: JsonValue | undefined): string | null => (typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : null);

/** A column that shows one field of the value. */
const fieldColumn = (label: string, name: string, options: { mono?: boolean; optional?: boolean; numeric?: boolean; nowrap?: boolean; format?: (value: string) => string } = {}): Column => ({
  label,
  optional: options.optional,
  numeric: options.numeric,
  nowrap: options.nowrap,
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
  nowrap: true,
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
      nowrap: true,
      cell: (fact) => {
        const kind = KIND_FIELDS.map((name) => text(field(fact, name))).find((value) => value !== null);
        return kind ? { text: kindLabel(kind) } : null;
      },
    },
    {
      label: "Detail",
      optional: true,
      breakable: true,
      cell: (fact) => {
        if (!isObject(fact.value)) return null;
        const location = LOCATION_FIELDS.find((name) => text(field(fact, name)) !== null);
        const rest = Object.entries(fact.value).filter(([name]) => !KIND_FIELDS.includes(name) && name !== location);
        return rest.length ? { text: detailText(rest) } : null;
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

/** A value's remaining fields in words, "Direction: send · Target origin: none", each long or nested value cut short; the evidence panel keeps the raw value. */
function detailText(entries: [string, JsonValue][]): string {
  const DETAIL_LIMIT = 80;
  return entries
    .map(([name, value]) => {
      const text = formatValue(value);
      // A camelCase field such as targetOrigin reads as "Target origin".
      return `${humanize(name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase())}: ${text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT - 1)}…` : text}`;
    })
    .join(" · ");
}

// The Interface categories: what a design system is and how it's set up, how
// elements use it, and how style values use its tokens. Their values count
// sites per scope (app, stories, tests); only the app scope counts toward a
// Standard, so it leads and the other scopes follow as a note.

const number = (value: number) => value.toLocaleString("en-US");
const scopeOf = (fact: Fact, scope: string): JsonObject => {
  const value = field(fact, scope);
  return isObject(value) ? value : {};
};
const count = (object: JsonObject, name: string): number => (typeof object[name] === "number" ? (object[name] as number) : 0);
/** The non-zero counts as a phrase, each noun in its plural only when the count isn't one: "1 token · 12 raw values". */
const nonzero = (parts: [value: number, label: string, plural?: string][]) => parts.filter(([value]) => value > 0).map(([value, label, plural]) => `${number(value)} ${value === 1 || !plural ? label : plural}`).join(" · ");
const keyParts = (fact: Fact) => fact.key.split(":");
// A catalog id, such as `salt`, as a design system's name.
const systemName = (id: string | undefined) => (id ? humanize(id) : "Design system");

/** Uses outside the app, such as in tests, which a Standard doesn't count. */
const outsideApp = (names: string[]): Column => ({
  label: "Outside the app",
  optional: true,
  cell: (fact) => {
    const text = nonzero([
      [names.reduce((sum, name) => sum + count(scopeOf(fact, "stories"), name), 0), "in stories"],
      [names.reduce((sum, name) => sum + count(scopeOf(fact, "tests"), name), 0), "in tests"],
    ]);
    return text ? { text } : null;
  },
});

const designSystems = layout(
  {
    label: "Design system",
    cell: (fact) => {
      const name = text(field(fact, "name"));
      if (name === null) return null;
      const catalog = [text(field(fact, "catalog")), text(field(fact, "catalog_version"))].filter(Boolean).join(" ");
      return { text: name, secondary: catalog ? `Catalog ${catalog}` : undefined };
    },
  },
  {
    label: "Set up",
    optional: true,
    cell: (fact) => {
      const checks: [string, string, string][] = [
        ["theme_stylesheet", "Theme stylesheet imported", "No theme stylesheet imported"],
        ["provider", "Provider rendered", "No provider rendered"],
        ["imported", "Imported by source", "Not imported by source"],
      ];
      const known = checks.filter(([name]) => typeof field(fact, name) === "boolean");
      if (!known.length) return null;
      const missing = known.filter(([name]) => field(fact, name) !== true).map(([, , no]) => no);
      const present = known.filter(([name]) => field(fact, name) === true).map(([, yes]) => yes);
      return { text: missing.length ? missing.join(" · ") : present.join(" · "), secondary: missing.length && present.length ? present.join(" · ") : undefined };
    },
  },
  {
    label: "Packages",
    optional: true,
    cell: (fact) => {
      const packages = field(fact, "packages");
      if (!Array.isArray(packages) || !packages.length) return null;
      const ranges = new Map<string, Set<string>>();
      const manifests = new Set<string>();
      for (const entry of packages) {
        if (!isObject(entry) || typeof entry.name !== "string") continue;
        if (!ranges.has(entry.name)) ranges.set(entry.name, new Set());
        if (typeof entry.range === "string") ranges.get(entry.name)!.add(entry.range);
        if (typeof entry.manifest === "string") manifests.add(entry.manifest);
      }
      const listed = [...ranges].map(([name, versions]) => [name, [...versions].join(" or ")].filter(Boolean).join(" "));
      return { text: listed.join(" · "), secondary: manifests.size ? `Declared in ${countLabel(manifests.size, "manifest")}` : undefined };
    },
  },
);

const UI_ORDER = ["summary", "component", "wrapper", "library", "intrinsic", "rendered", "layout-only", "other"];
const uiElements: Layout = {
  generic: false,
  sort: (a, b) => UI_ORDER.indexOf(keyParts(a)[0]!) - UI_ORDER.indexOf(keyParts(b)[0]!) || count(scopeOf(b, "app"), "sites") - count(scopeOf(a, "app"), "sites"),
  columns: [
    {
      label: "Element",
      cell: (fact) => {
        const [kind, first, second] = keyParts(fact);
        const pkg = text(field(fact, "package"));
        if (kind === "summary") return { text: `All ${systemName(first)} use`, secondary: "Elements across the app" };
        if (kind === "wrapper" && second) return { text: second, secondary: `Styled wrapper of a ${systemName(first)} component` };
        if (kind === "component" && second) return { text: second, secondary: [`${systemName(first)} component`, pkg].filter(Boolean).join(" · ") };
        if (kind === "intrinsic" && first) {
          const equivalent = text(field(fact, "equivalent"));
          const [system, component] = equivalent?.split(":") ?? [];
          return { text: `<${first}>`, mono: true, secondary: component ? `HTML element · ${systemName(system)} has ${component}` : "HTML element" };
        }
        // Its reasoning, shown below, says why it's listed, so its kind is enough here.
        if (kind === "layout-only" && first) return { text: `<${first}>`, mono: true, secondary: "HTML container" };
        if (kind === "rendered" && first) {
          const components = field(fact, "components");
          return { text: `<${first}>`, mono: true, secondary: Array.isArray(components) && components.length ? `Rendered by ${components.map(String).join(", ")}` : "Rendered by a component" };
        }
        if (kind === "library" && first) return { text: [first, ...keyParts(fact).slice(2)].join(":"), secondary: "Element from another UI library" };
        if (kind === "other") return { text: "Other elements", secondary: "Elements no design system covers" };
        return null;
      },
    },
    {
      label: "Uses in the app",
      numeric: true,
      cell: (fact) => {
        const app = scopeOf(fact, "app");
        if (keyParts(fact)[0] === "summary") return typeof app.elements === "number" ? { text: `${number(count(app, "design_system"))} of ${number(count(app, "elements"))}` } : null;
        if (typeof app.definitions === "number") return { text: countLabel(count(app, "definitions"), "definition") };
        return typeof app.sites === "number" ? { text: number(count(app, "sites")) } : null;
      },
    },
    {
      label: "How",
      optional: true,
      cell: (fact) => {
        const app = scopeOf(fact, "app");
        const kind = keyParts(fact)[0];
        if (kind === "summary") {
          const shares = [typeof app.adoption_share === "number" ? `${app.adoption_share}% adoption` : null, typeof app.customized_share === "number" ? `${app.customized_share}% customized` : null].filter(Boolean).join(" · ");
          return shares ? { text: shares, secondary: "Adoption: elements that use it rather than an HTML equivalent" } : null;
        }
        if (kind === "component") {
          const mechanisms = isObject(app.mechanisms) ? nonzero(Object.entries(app.mechanisms).map(([name, value]) => [typeof value === "number" ? value : 0, `by ${humanize(name).toLowerCase()}`])) : "";
          const styles = isObject(app.styles) ? nonzero([[count(app.styles, "resolved"), "resolved"], [count(app.styles, "partial"), "partly resolved"], [count(app.styles, "unresolved"), "unresolved"]]) : "";
          const text = nonzero([[count(app, "as_is"), "as is"], [count(app, "customized"), "customized"], [count(app, "unknown"), "unknown"]]);
          return text ? { text, secondary: [mechanisms && `Customized ${mechanisms}`, styles && `Styles ${styles}`].filter(Boolean).join(" · ") || undefined } : null;
        }
        if (kind === "intrinsic") {
          const text = nonzero([[count(app, "unstyled"), "unstyled"], [count(app, "styled"), "styled"]]);
          return text ? { text } : null;
        }
        return null;
      },
    },
    outsideApp(["sites", "definitions"]),
  ],
};

// API contracts: what each contract is, how many operations it declares, and where it's committed.
const CONTRACT_ORDER = ["openapi", "graphql_schema", "graphql_operations", "generated_schema"];
const CONTRACT_NAMES: Record<string, string> = { openapi: "OpenAPI", graphql: "GraphQL" };
const OPERATIONS_SHOWN = 3;
const directoryOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "Repository root");

const apiContracts: Layout = {
  generic: false,
  unit: "file",
  sort: (a, b) => CONTRACT_ORDER.indexOf(text(field(a, "kind")) ?? "") - CONTRACT_ORDER.indexOf(text(field(b, "kind")) ?? ""),
  columns: [
    {
      label: "Contract",
      cell: (fact) => {
        const kind = text(field(fact, "kind"));
        if (kind === "openapi") {
          const servers = field(fact, "servers");
          const version = text(field(fact, "version"));
          return { text: text(field(fact, "title")) ?? "OpenAPI document", secondary: [version ? `OpenAPI ${version}` : "OpenAPI", Array.isArray(servers) && servers.length ? countLabel(servers.length, "server") : null].filter(Boolean).join(" · ") };
        }
        if (kind === "graphql_schema") {
          const definitions = field(fact, "definitions");
          return { text: "GraphQL schema", secondary: typeof definitions === "number" ? countLabel(definitions, "definition") : undefined };
        }
        if (kind === "graphql_operations") {
          const operations = field(fact, "operations");
          const names = Array.isArray(operations) ? operations.map(String) : [];
          const shown = names.slice(0, OPERATIONS_SHOWN).join(", ");
          return { text: names.length ? `${shown}${names.length > OPERATIONS_SHOWN ? `, and ${names.length - OPERATIONS_SHOWN} more` : ""}` : "GraphQL operations", secondary: "GraphQL operations" };
        }
        if (kind === "generated_schema") {
          const contract = text(field(fact, "contract"));
          return { text: `Generated ${CONTRACT_NAMES[contract ?? ""] ?? humanize(contract ?? "API")} client`, secondary: text(field(fact, "generator")) ? `By ${text(field(fact, "generator"))}` : undefined };
        }
        return null;
      },
    },
    {
      label: "Operations",
      numeric: true,
      optional: true,
      cell: (fact) => {
        const operations = field(fact, "operations");
        if (typeof operations === "number") return { text: number(operations) };
        return Array.isArray(operations) ? { text: number(operations.length) } : null;
      },
    },
    {
      label: "Location",
      optional: true,
      cell: (fact) => {
        const path = text(field(fact, "path"));
        if (path === null) return null;
        // A generated client is many files; its directory names it, so its files share one row.
        return text(field(fact, "kind")) === "generated_schema" ? { text: directoryOf(path), mono: true } : { text: path, mono: true };
      },
    },
  ],
};

const STYLE_ORDER = ["summary", "declarations", "important", "internal-selector", "element-selector", "unknown-token", "token-aliases", "redefinition"];
const DECLARATION_KINDS: [name: string, label: string, plural?: string][] = [
  ["token", "token", "tokens"],
  ["raw", "raw value", "raw values"],
  ["other_custom_property", "other custom property", "other custom properties"],
  ["neutral", "neutral"],
  ["unresolved", "unresolved"],
  ["unparsed", "unparsed"],
];
/** What a style finding comes to, under its name: a declaration family's values by kind, or a share's counts. */
function styleDetail(fact: Fact): string | undefined {
  const app = scopeOf(fact, "app");
  const kind = keyParts(fact)[0];
  if (kind === "summary") return typeof app.token_capable === "number" ? `${number(count(app, "tokenized"))} of ${number(count(app, "token_capable"))} token-capable declarations use a token or an alias` : undefined;
  if (kind === "declarations") return nonzero(DECLARATION_KINDS.map(([name, label, plural]) => [count(app, name), label, plural])) || undefined;
  if (kind === "token-aliases") return `In ${countLabel(count(app, "declarations"), "declaration")}`;
  if (kind === "unknown-token") return "Unknown token";
  if (kind === "redefinition") return "Redefined token";
  return undefined;
}

const styleValues: Layout = {
  generic: false,
  sort: (a, b) => STYLE_ORDER.indexOf(keyParts(a)[0]!) - STYLE_ORDER.indexOf(keyParts(b)[0]!),
  columns: [
    {
      label: "Finding",
      cell: (fact) => {
        const [kind, ...rest] = keyParts(fact);
        const name = rest.join(":");
        const secondary = styleDetail(fact);
        if (kind === "summary") return { text: `${systemName(name)} token share`, secondary };
        if (kind === "declarations") return { text: `${humanize(name)} declarations`, secondary };
        if (kind === "important") return { text: "!important declarations" };
        if (kind === "internal-selector") return { text: `Selectors into ${systemName(name)} internals` };
        if (kind === "element-selector") return { text: `Global rules for <${name}>`, secondary: "A design system has a component for this element" };
        if (kind === "unknown-token" || kind === "redefinition") return { text: name, mono: true, secondary };
        if (kind === "token-aliases") return { text: `${humanize(name)} token aliases`, secondary };
        return null;
      },
    },
    {
      label: "In the app",
      numeric: true,
      cell: (fact) => {
        const app = scopeOf(fact, "app");
        const kind = keyParts(fact)[0];
        if (kind === "summary") return typeof app.token_share === "number" ? { text: `${app.token_share}%` } : typeof app.token_capable === "number" ? { text: "No share" } : null;
        if (kind === "declarations") return { text: number(DECLARATION_KINDS.reduce((sum, [name]) => sum + count(app, name), 0)) };
        if (kind === "token-aliases") return typeof app.aliases === "number" ? { text: number(count(app, "aliases")) } : null;
        return typeof app.count === "number" ? { text: number(count(app, "count")) } : null;
      },
    },
    {
      label: "Outside the app",
      optional: true,
      cell: (fact) => {
        const kind = keyParts(fact)[0];
        const total = (scope: string) => {
          const object = scopeOf(fact, scope);
          if (kind === "declarations") return DECLARATION_KINDS.reduce((sum, [name]) => sum + count(object, name), 0);
          if (kind === "summary") return count(object, "token_capable");
          if (kind === "token-aliases") return count(object, "aliases");
          return count(object, "count");
        };
        const text = nonzero([
          [total("stories"), "in stories"],
          [total("tests"), "in tests"],
        ]);
        return text ? { text } : null;
      },
    },
  ],
};

const LAYOUTS: Record<string, Layout> = {
  languages: layout(keyColumn("Language"), fieldColumn("Files", "files", { numeric: true, format: (files) => Number(files).toLocaleString("en-US") }), { label: "Size", numeric: true, cell: (fact) => (typeof field(fact, "bytes") === "number" ? { text: formatBytes(field(fact, "bytes") as number) } : null) }),
  submodules: layout(fieldColumn("Path", "path", { mono: true }), fieldColumn("Commit", "commit", { mono: true, format: (commit) => commit.slice(0, 12) })),
  package_identity: layout(fieldColumn("Package", "name", { mono: true }), fieldColumn("Version", "version", { optional: true, mono: true, nowrap: true }), booleanColumn("Visibility", "private", "Private", "Public"), manifestColumn),
  packages_produced: layout(fieldColumn("Package", "name", { mono: true }), fieldColumn("Version", "version", { optional: true, mono: true, nowrap: true }), booleanColumn("Published", "published", "Published", "Not published"), manifestColumn),
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
  ci_systems: layout(fieldColumn("Definition", "path", { mono: true }), fieldColumn("System", "system", { nowrap: true, format: ciSystem })),
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
  api_contracts: apiContracts,
  test_substitutes: KIND_FIRST,
  design_systems: designSystems,
  ui_elements: uiElements,
  style_values: styleValues,
  // The categories that share the Dependencies and Scripts tables, as the cells those tables take from them.
  dependencies: layout(fieldColumn("Package", "name", { mono: true }), fieldColumn("Kind", "field", { format: dependencyKind }), fieldColumn("Declared", "specifier", { mono: true, nowrap: true }), manifestColumn),
  resolved_dependencies: layout(fieldColumn("Package", "name", { mono: true }), fieldColumn("Resolved", "version", { mono: true, nowrap: true }), manifestColumn),
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

const GENERIC: Layout = { generic: true, columns: [keyColumn("Fact", { mono: true }), { label: "Value", breakable: true, cell: (fact) => ({ text: formatValue(fact.value) }) }] };

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
  const cells = layout.columns.map((column) => {
    const cell = column.cell(fact);
    return cell && (column.nowrap || column.breakable) ? { ...cell, ...(column.nowrap ? { nowrap: true } : {}), ...(column.breakable ? { breakable: true } : {}) } : cell;
  });
  if (layout.columns.some((column, index) => !column.optional && cells[index] === null)) return { kind: "whole", text: formatValue(fact.value) };
  return { kind: "cells", cells };
}
