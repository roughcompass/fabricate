import type { JsonObject } from "@repo-facts/contract";
import { countLabel, formatNumber } from "@/components/ui/count";
import { dependencyKind, humanize } from "@/components/ui/status";
import { isJsonObject } from "@/lib/json";
import { dependencyGroups } from "./joins";
import type { RepositoryKind } from "./kind";
import type { OverviewRow, OverviewValue } from "./overview";
import type { PackageProducer, RelatedRepository, RepositoryRelationships } from "./relationships";
import { type Fact, type FactDocument, type NoValue, categoryDefinitions, categoryOf, categoryState, noValue } from "./states";
import type { ProfileTabId } from "./tabs";
import { routes } from "@/lib/web/routes";
import { PRODUCT, SURVEYOR_RELEASE_LABEL } from "@/lib/product";

/**
 * The Overview's answers, one panel per question a reader brings to a
 * repository: what it is, how it fits into the web runtime, what it depends
 * on, how it uses its design system, and how it's built. Each row states only what its facts say,
 * carries their state, and links to the view that holds them; a question its
 * facts can't answer shows why. A repository that isn't a frontend gets only
 * the panels that apply to any repository.
 */
export interface SummaryPanel {
  /** The view the panel summarizes, which holds its facts. */
  tab: ProfileTabId;
  title: string;
  rows: OverviewRow[];
}

export interface SummaryContext {
  kind: RepositoryKind;
  relationships: RepositoryRelationships;
  /** The cataloged repositories that produce each declared package. */
  producers: ReadonlyMap<string, readonly PackageProducer[]>;
  /** The repository's own public id, so it isn't counted as another repository's producer. */
  self: string | null;
  services: { total: number; characterized: number };
}

const facts = (document: FactDocument, id: string): Fact[] => categoryOf(document, id)?.facts ?? [];
const valueOf = (fact: Fact): JsonObject => (isJsonObject(fact.value) ? fact.value : {});
const app = (fact: Fact): JsonObject => (isJsonObject(valueOf(fact).app) ? (valueOf(fact).app as JsonObject) : {});
const count = (object: JsonObject, name: string) => (typeof object[name] === "number" ? (object[name] as number) : 0);

function row(label: string, category: string, values: OverviewValue[], placeholders: OverviewRow["placeholders"] = [], options: Partial<OverviewRow> = {}): OverviewRow {
  return { label, category, values, placeholders, more: 0, stacked: false, summary: null, partial: false, ...options };
}

/** A row that has no value, with why: the category's own state and reason. */
function missing(document: FactDocument, label: string, category: string): OverviewRow {
  const definition = categoryDefinitions(document).find((candidate) => candidate.id === category);
  // A category the installed contract doesn't define is one this release can't report, either.
  return row(label, category, [], [{ value: definition ? noValue(document, definition) : { state: "not_covered", reason: `${SURVEYOR_RELEASE_LABEL} ${document.detector_release} doesn't report this category` } }]);
}

const pick = (rows: readonly OverviewRow[], label: string): OverviewRow[] => rows.filter((candidate) => candidate.label === label);

export function profileSummary(document: FactDocument, rows: readonly OverviewRow[], context: SummaryContext): SummaryPanel[] {
  const { frontend } = context.kind;
  const panels: SummaryPanel[] = [
    { tab: "overview", title: "What it is", rows: [...pick(rows, "Packages"), ...pick(rows, "Framework"), ...pick(rows, "Languages"), ...pick(rows, "Build")] },
    ...(frontend ? [{ tab: "composition" as const, title: "How it fits into the web runtime", rows: runtimeRows(document, rows, context) }] : []),
    { tab: "dependencies", title: "What it depends on", rows: dependencyRows(document, context) },
    ...(frontend ? [{ tab: "design-system" as const, title: "Design system", rows: designSystemRows(document, rows) }] : []),
    { tab: "tooling", title: "How it's built and tested", rows: [...pick(rows, "Tests"), ...pick(rows, "Tooling"), ...pick(rows, "Runtime"), scriptsRow(document)] },
  ];
  // A non-frontend repository's Service Dependencies still matter; a frontend's are part of how it fits in.
  if (!frontend) panels.splice(2, 0, { tab: "services", title: "Which services it calls", rows: [servicesRow(context)] });
  return panels;
}

// Relationship types in words, as the Relationship Map names them.
const RELATIONSHIP_TYPES: Record<string, string> = { composition: "composes", package_dependency: "package", iframe: "embeds", runtime_contract: "runtime contract" };

function related(repositories: readonly RelatedRepository[]): OverviewValue[] {
  // Each is a resolved relationship in the Run's map, observed in both repositories' source.
  return repositories.map((repository) => ({ state: "observed", text: repository.name, secondary: repository.types.map((type) => RELATIONSHIP_TYPES[type] ?? humanize(type)).join(" · "), href: routes.repository(repository.publicId) }));
}

function runtimeRows(document: FactDocument, rows: readonly OverviewRow[], context: SummaryContext): OverviewRow[] {
  const { relationships } = context;
  // Relationships exist only within a Run's map; without one they're unknown, not none.
  const unmapped: NoValue = { state: "unknown", reason: "No Assessment Run has mapped it with other repositories" };
  const none: NoValue = { state: "absent", reason: "None in its newest Assessment Run" };
  const relationshipRow = (label: string, repositories: readonly RelatedRepository[]) =>
    row(label, "relationships", related(repositories).slice(0, 5), relationships.run ? (repositories.length ? [] : [{ value: none }]) : [{ value: unmapped }], { more: Math.max(0, repositories.length - 5) });
  const integrations = facts(document, "runtime_integrations");
  const directions = [...new Set(integrations.map((fact) => String(valueOf(fact).direction ?? "")).filter(Boolean))].sort();
  return [
    ...pick(rows, "Composition"),
    // Without a mapped Run both directions are unknown for the same reason, so it's said once.
    ...(relationships.run ? [relationshipRow("Uses", relationships.uses), relationshipRow("Used by", relationships.usedBy)] : [row("Relationships", "relationships", [], [{ value: unmapped }])]),
    servicesRow(context),
    ...(integrations.length ? [row("Window messages", "runtime_integrations", [{ state: categoryState(document, "runtime_integrations"), text: countLabel(integrations.length, "postMessage contract"), secondary: directions.length === 2 ? "sends and receives" : directions[0] === "send" ? "sends only" : "receives only" }])] : []),
  ];
}

function servicesRow(context: SummaryContext): OverviewRow {
  const { total, characterized } = context.services;
  if (!total) return row("Services", "services", [], [{ value: { state: "absent", reason: "No outbound call was found in committed source" } }]);
  return row("Services", "services", [{ state: "observed", text: countLabel(total, "Service Dependency", "Service Dependencies"), secondary: `${formatNumber(characterized)} with characterized boundaries` }]);
}

function dependencyRows(document: FactDocument, context: SummaryContext): OverviewRow[] {
  const declared = dependencyGroups(document).flatMap((group) => group.rows.filter((entry) => entry.declared));
  if (!declared.length) return [missing(document, "Declared", "dependencies"), ...frameworkRow(document)];
  const state = categoryState(document, "dependencies");
  const fields = new Map<string, number>();
  for (const entry of declared) {
    const field = String(valueOf(entry.declared!).field ?? "dependencies");
    fields.set(field, (fields.get(field) ?? 0) + 1);
  }
  const names = [...new Set(declared.map((entry) => entry.name))];
  // A package is internal when this repository's own workspaces produce it, or when another cataloged repository does.
  const ownInternal = new Set(facts(document, "packages_consumed").filter((fact) => valueOf(fact).internal === true).map((fact) => String(valueOf(fact).name)));
  const fromFleet = names.filter((name) => !ownInternal.has(name) && (context.producers.get(name) ?? []).some((producer) => producer.publicId !== context.self));
  const internal = names.filter((name) => ownInternal.has(name)).length + fromFleet.length;
  const producers = [...new Set(fromFleet.flatMap((name) => (context.producers.get(name) ?? []).filter((producer) => producer.publicId !== context.self).map((producer) => producer.name)))];

  const resolved = facts(document, "resolved_dependencies").length;
  return [
    row("Declared", "dependencies", [
      {
        state,
        text: countLabel(names.length, "package"),
        // By the field that declares them; a package several manifests declare counts once per declaration.
        secondary: `${declared.length > names.length ? `${countLabel(declared.length, "declaration")}: ` : ""}${[...fields].sort(([, a], [, b]) => b - a).map(([field, total]) => `${formatNumber(total)} ${dependencyKind(field).toLowerCase()}`).join(" · ")}`,
      },
    ]),
    row("Origin", "packages_consumed", [
      { state, text: `${formatNumber(names.length - internal)} third-party` },
      { state, text: `${formatNumber(internal)} internal`, secondary: producers.length ? `from ${producers.slice(0, 3).join(", ")}${producers.length > 3 ? ` and ${producers.length - 3} more` : ""}` : internal ? "from its own workspaces" : undefined },
    ]),
    ...frameworkRow(document),
    resolved ? row("Resolved", "resolved_dependencies", [{ state: categoryState(document, "resolved_dependencies"), text: `${formatNumber(resolved)} resolved by a lockfile` }]) : missing(document, "Resolved", "resolved_dependencies"),
  ];
}

/** Each framework with the range its manifests declare, such as React ^18.3.1. */
function frameworkRow(document: FactDocument): OverviewRow[] {
  const values = new Map<string, OverviewValue>();
  for (const fact of facts(document, "frameworks")) {
    const value = valueOf(fact);
    const specifiers = isJsonObject(value.specifiers) ? Object.values(value.specifiers).filter((item): item is string => typeof item === "string" && !/^[a-z]+:/i.test(item)) : [];
    const text = [String(value.label ?? fact.key), specifiers[0]].filter(Boolean).join(" ");
    values.set(text, { state: fact.state, text });
  }
  return values.size ? [row("Frameworks", "frameworks", [...values.values()].slice(0, 4), [], { more: Math.max(0, values.size - 4) })] : [];
}

function scriptsRow(document: FactDocument): OverviewRow {
  const scripts = facts(document, "scripts");
  return scripts.length ? row("Scripts", "scripts", [{ state: categoryState(document, "scripts"), text: countLabel(scripts.length, "script") }]) : missing(document, "Scripts", "scripts");
}

// Raw controls a design system usually provides, for a repository whose design system isn't recognized.
const CONTROLS = ["button", "a", "input", "select", "textarea", "dialog", "table", "label"];

function designSystemRows(document: FactDocument, rows: readonly OverviewRow[]): OverviewRow[] {
  const result: OverviewRow[] = [...pick(rows, "Design system")];
  const elements = facts(document, "ui_elements");
  const styles = facts(document, "style_values");
  if (!categoryOf(document, "ui_elements")) return result;
  const systems = new Map(facts(document, "design_systems").map((fact) => [fact.key, String(valueOf(fact).name ?? fact.key)]));

  // Adoption, never as a bare percentage: with the counts it divides.
  for (const fact of elements.filter((candidate) => candidate.key.startsWith("summary:"))) {
    const scope = app(fact);
    const name = systems.get(fact.key.slice("summary:".length)) ?? "design system";
    if (typeof scope.adoption_share !== "number") continue;
    result.push(
      row("Adoption", "ui_elements", [
        { state: fact.state, text: `${scope.adoption_share}% of elements that could use ${name} do`, secondary: `${formatNumber(count(scope, "design_system"))} ${name} components of ${formatNumber(count(scope, "elements"))} elements${typeof scope.customized_share === "number" ? ` · ${scope.customized_share}% customized` : ""}` },
      ]),
    );
  }

  const intrinsic = elements.filter((fact) => fact.key.startsWith("intrinsic:") && count(app(fact), "sites") > 0);
  const equivalent = intrinsic.filter((fact) => valueOf(fact).group === "equivalent").sort((a, b) => count(app(b), "sites") - count(app(a), "sites"));
  // From fact document version 3, a design system names the entry it was compared against; with none for its version, nothing could be matched.
  const uncompared = facts(document, "design_systems").every((fact) => "entry" in valueOf(fact) && !isJsonObject(valueOf(fact).entry));
  if (systems.size && uncompared) {
    result.push(row("Replaceable HTML", "ui_elements", [], [{ value: { state: "unknown", reason: `No ${PRODUCT.referenceCatalog} entry for its version to match raw elements against` } }], { stacked: false }));
  } else if (systems.size) {
    const sites = equivalent.reduce((sum, fact) => sum + count(app(fact), "sites"), 0);
    result.push(
      row(
        "Replaceable HTML",
        "ui_elements",
        equivalent.slice(0, 3).map((fact) => ({ state: fact.state, text: `<${fact.key.slice("intrinsic:".length)}> → ${String(valueOf(fact).equivalent ?? "").split(":").pop()}`, secondary: countLabel(count(app(fact), "sites"), "site") })),
        equivalent.length ? [] : [{ value: { state: "absent", reason: "No raw element in the app has a design-system equivalent" } }],
        { more: Math.max(0, equivalent.length - 3), summary: equivalent.length ? `${countLabel(sites, "element")} written as raw HTML` : null, stacked: false },
      ),
    );
  } else {
    // With no design system recognized nothing has an equivalent, so name the raw controls a design system would provide.
    const controls = intrinsic.filter((fact) => CONTROLS.includes(fact.key.slice("intrinsic:".length))).sort((a, b) => count(app(b), "sites") - count(app(a), "sites"));
    if (controls.length) result.push(row("Raw controls", "ui_elements", controls.slice(0, 4).map((fact) => ({ state: fact.state, text: `<${fact.key.slice("intrinsic:".length)}>`, secondary: countLabel(count(app(fact), "sites"), "site") })), [], { more: Math.max(0, controls.length - 4) }));
  }

  // Raw values in the families tokens cover, and the token share where a design system defines tokens.
  const families = styles.filter((fact) => fact.key.startsWith("declarations:") && fact.key !== "declarations:layout" && fact.key !== "declarations:other");
  const raw = families.reduce((sum, fact) => sum + count(app(fact), "raw"), 0);
  const tokenShare = styles.filter((fact) => fact.key.startsWith("summary:") && typeof app(fact).token_share === "number");
  const values: OverviewValue[] = [
    ...tokenShare.map((fact) => ({ state: fact.state, text: `${app(fact).token_share as number}% use ${systems.get(fact.key.slice("summary:".length)) ?? "design-system"} tokens`, secondary: `${formatNumber(count(app(fact), "tokenized"))} of ${formatNumber(count(app(fact), "token_capable"))} declarations that could` })),
    ...(raw ? [{ state: "observed", text: `${formatNumber(raw)} raw values`, secondary: [...families].sort((a, b) => count(app(b), "raw") - count(app(a), "raw")).filter((fact) => count(app(fact), "raw") > 0).slice(0, 3).map((fact) => `${fact.key.slice("declarations:".length)} ${formatNumber(count(app(fact), "raw"))}`).join(" · ") }] : []),
  ];
  if (values.length) result.push(row("Style values", "style_values", values));

  const finding = (prefix: string) => styles.filter((fact) => fact.key.startsWith(prefix)).reduce((sum, fact) => sum + count(app(fact), "count"), 0);
  const overrides = [
    [finding("redefinition:"), "token redefinition"],
    [finding("unknown-token:"), "unknown token"],
    [finding("internal-selector:"), "internal-class selector"],
    [finding("element-selector:"), "global element selector"],
    [finding("important"), "!important declaration"],
  ] as const;
  const present = overrides.filter(([total]) => total > 0);
  if (present.length) result.push(row("Overrides", "style_values", present.map(([total, noun]) => ({ state: "observed", text: countLabel(total, noun) }))));
  return result;
}
