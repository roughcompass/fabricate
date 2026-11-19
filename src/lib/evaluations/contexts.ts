import { type JsonObject, type JsonValue, SKIPPED_INPUT_REASONS, compareCodeUnits } from "@repo-facts/contract";
import type { MapDocument, MapEdge, MapNode } from "@/lib/relationships/schema";
import type { Scope } from "@/lib/standards/registry";
import { asObject, asArray } from "@/lib/json";
import type { Context, Reading } from "./interpreter";

/*
 * The subjects Standard expressions are read against: how each selector reads
 * a Profile, a Service Dependency, or the Relationship Map.
 */

const known = (value: JsonValue, evidence: string[] = [], complete = true): Reading => ({ known: true, value, complete, reason: null, evidence });
const unknownReading = (reason: string, evidence: string[] = [], value: JsonValue = null): Reading => ({ known: false, value, complete: false, reason, evidence });
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** A repository's Profile, or, when it has none, a subject every selector reads as unknown. */
export function repositoryContext(factDocument: JsonObject | null, missingReason = "The repository has no Profile"): Context {
  if (!factDocument) return missingContext("repository", missingReason);
  const categories = asObject(factDocument.categories);
  const services = asArray(factDocument.service_dependencies).map(asObject);
  // A skipped source file may hide Service Dependencies, so the list is then incomplete.
  const skippedSource = asArray(factDocument.diagnostics)
    .map(asObject)
    .find((diagnostic) => SOURCE_FILE.test(String(diagnostic.path)) && SKIPPED_INPUT_REASONS.has(String(diagnostic.reason)));
  return {
    scope: "repository",
    read: (selector, parameter) => readRepository(categories, selector, parameter),
    collection: (id) => {
      if (id !== "service_dependencies") return { items: [], unseen: [] };
      return {
        items: services.map((service) => ({ subject: String(service.key), context: serviceContext(service) })),
        unseen: skippedSource ? [{ reason: `${String(skippedSource.path)} was skipped (${String(skippedSource.reason)}), so it may call services that were not found`, context: missingContext("service_dependency", "A Service Dependency in a skipped file is not known") }] : [],
      };
    },
  };
}

type Category = { state: string; facts: JsonObject[]; complete: boolean };

function category(categories: JsonObject, id: string): Category {
  const value = asObject(categories[id]);
  const search = asObject(value.search);
  return { state: String(value.state ?? "unknown"), facts: asArray(value.facts).map(asObject), complete: search.complete === true && asArray(search.skipped).length === 0 };
}

/** The members a category's facts establish; conflicting and unknown facts leave the set incomplete. */
function setOf(categories: JsonObject, id: string, extract: (fact: JsonObject) => JsonValue[]): Reading {
  const { facts, complete } = category(categories, id);
  const values = new Set<string>();
  const evidence: string[] = [];
  let uncertain = false;
  for (const fact of facts) {
    evidence.push(...asArray(fact.evidence).map(String));
    if (fact.state === "observed" || fact.state === "inferred") for (const value of extract(fact)) values.add(String(value));
    else uncertain = true;
  }
  const whole = complete && !uncertain;
  return { known: true, value: [...values].sort(compareCodeUnits), complete: whole, reason: whole ? null : `The ${id.replaceAll("_", " ")} evidence is incomplete or conflicting`, evidence };
}

function countOf(categories: JsonObject, id: string): Reading {
  const { facts, complete } = category(categories, id);
  const evidence = facts.flatMap((fact) => asArray(fact.evidence).map(String));
  return complete ? known(facts.length, evidence) : unknownReading(`The ${id.replaceAll("_", " ")} search was incomplete`, evidence);
}

/** Versions or ranges from matching facts; conflicting facts contribute each candidate as an alternative. */
function versionsOf(categories: JsonObject, id: string, matches: (fact: JsonObject, value: JsonObject) => boolean, extract: (value: JsonObject) => string | null, absenceKnown: boolean): Reading {
  const { facts, complete } = category(categories, id);
  const values: string[] = [];
  const alternatives: string[][] = [];
  const evidence: string[] = [];
  for (const fact of facts) {
    if (fact.state === "conflicting") {
      const candidates = asArray(fact.candidates).map((candidate) => asObject(asObject(candidate).value));
      if (!candidates.some((candidate) => matches(fact, candidate))) continue;
      evidence.push(...asArray(fact.evidence).map(String));
      alternatives.push(candidates.map(extract).filter((value): value is string => value !== null));
      continue;
    }
    const value = asObject(fact.value);
    if (!matches(fact, value)) continue;
    evidence.push(...asArray(fact.evidence).map(String));
    const version = extract(value);
    if (version !== null && (fact.state === "observed" || fact.state === "inferred")) values.push(version);
  }
  const whole = complete && absenceKnown;
  if (alternatives.length) {
    // Each combination of one candidate per conflicting fact, plus the agreed values.
    const combinations = alternatives.reduce<string[][]>((sets, candidates) => sets.flatMap((set) => candidates.map((candidate) => [...set, candidate])), [values]);
    return { known: true, value: values, alternatives: combinations, complete: true, reason: `The ${id.replaceAll("_", " ")} declarations conflict, and the candidates disagree`, evidence };
  }
  return { known: true, value: [...new Set(values)].sort(compareCodeUnits), complete: values.length > 0 || whole, reason: values.length || whole ? null : `No ${id.replaceAll("_", " ")} evidence establishes this version`, evidence };
}

function readRepository(categories: JsonObject, selector: string, parameter: string | undefined): Reading {
  const field = (name: string) => (fact: JsonObject) => [asObject(fact.value)[name] ?? null].filter((value) => value !== null);
  switch (selector) {
    case "repository.languages":
      return setOf(categories, "languages", (fact) => [String(fact.key)]);
    case "repository.package_managers":
      return setOf(categories, "package_managers", (fact) => (typeof fact.value === "string" ? [fact.value] : []));
    case "repository.build_tools":
      return setOf(categories, "build_tools", field("id"));
    case "repository.test_frameworks":
      return setOf(categories, "test_frameworks", field("id"));
    case "repository.frameworks":
      return setOf(categories, "frameworks", field("id"));
    case "repository.ci_systems":
      return setOf(categories, "ci_systems", field("system"));
    case "repository.verification_command_kinds":
      return setOf(categories, "verification_commands", (fact) => asArray(asObject(fact.value).kinds));
    case "repository.composition_mechanisms":
      return setOf(categories, "composition", field("mechanism"));
    case "repository.packages_produced":
      return setOf(categories, "packages_produced", field("name"));
    case "repository.packages_consumed":
      return setOf(categories, "packages_consumed", field("name"));
    case "repository.runtime_integrations":
      return setOf(categories, "runtime_integrations", field("contract"));
    case "repository.access_signal_kinds":
      return setOf(categories, "access_signals", field("kind"));
    case "repository.egress_route_kinds":
      return setOf(categories, "egress_routes", field("kind"));
    case "repository.api_contract_kinds":
      return setOf(categories, "api_contracts", field("kind"));
    case "repository.test_substitute_kinds":
      return setOf(categories, "test_substitutes", field("kind"));
    case "repository.submodule_count":
      return countOf(categories, "submodules");
    case "repository.workspace_count":
      return countOf(categories, "workspaces");
    case "repository.node_range":
      return versionsOf(categories, "runtime_requirements", (fact) => fact.key === "node", (value) => (typeof value.range === "string" ? value.range : null), true);
    case "repository.declared_range":
      return versionsOf(categories, "dependencies", (_fact, value) => value.name === parameter, (value) => (typeof value.specifier === "string" ? value.specifier : null), true);
    case "repository.resolved_version":
      // Resolved versions are not a bounded search, so no lockfile entry never proves absence.
      return versionsOf(categories, "resolved_dependencies", (_fact, value) => value.name === parameter, (value) => (typeof value.version === "string" ? value.version : null), false);
    default:
      return readDesignSystem(categories, selector, parameter);
  }
}

// ---------------------------------------------------------------------------
// Design-system fields (Repository Profile version 2)
//
// They read the design_systems, ui_elements, and style_values categories of
// repo-facts fact document version 2. Counts and shares read the app scope,
// so stories and tests don't count. Fact keys are compared exactly or by
// prefix; nothing in a key or a parameter is interpreted as a pattern.

const APP_SCOPE = "app";

function readDesignSystem(categories: JsonObject, selector: string, parameter: string | undefined): Reading {
  const system = parameter ?? "";
  const keyed = (key: string) => (fact: JsonObject) => fact.key === key;
  const prefixed = (prefix: string) => (fact: JsonObject) => String(fact.key).startsWith(prefix);
  const sites = (scope: JsonObject) => scope.sites;
  const count = (scope: JsonObject) => scope.count;
  switch (selector) {
    case "repository.design_systems":
      return present(categories, "design_systems") ?? setOf(categories, "design_systems", (fact) => [String(fact.key)]);
    case "repository.design_system_theme_imported":
      return designSystemFlag(categories, system, "theme_stylesheet");
    case "repository.design_system_provider":
      return designSystemFlag(categories, system, "provider");
    case "repository.design_system_elements":
      return appSum(categories, "ui_elements", prefixed(`component:${system}:`), sites);
    case "repository.design_system_raw_equivalents":
      return appSum(categories, "ui_elements", (fact) => String(fact.key).startsWith("intrinsic:") && String(asObject(fact.value).equivalent ?? "").startsWith(`${system}:`), sites);
    case "repository.design_system_customized_share":
      return appShare(categories, "ui_elements", system, "customized_share");
    case "repository.design_system_adoption_share":
      return appShare(categories, "ui_elements", system, "adoption_share");
    case "repository.design_system_token_share":
      return appShare(categories, "style_values", system, "token_share");
    case "repository.design_system_internal_selectors":
      return appSum(categories, "style_values", keyed(`internal-selector:${system}`), count);
    case "repository.unknown_token_count":
      return appSum(categories, "style_values", prefixed("unknown-token:"), count);
    case "repository.token_redefinition_count":
      return appSum(categories, "style_values", prefixed("redefinition:"), count);
    case "repository.global_element_selector_count":
      return appSum(categories, "style_values", prefixed("element-selector:"), count);
    case "repository.important_count":
      return appSum(categories, "style_values", keyed("important"), count);
    default:
      return unknownReading(`${selector} is not a repository field`);
  }
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = { design_systems: "design systems", ui_elements: "UI elements", style_values: "style values" };

/** Unknown when the Profile's fact document has no such category: it was created before Repository Profile version 2. */
function present(categories: JsonObject, id: string): Reading | null {
  return categories[id] === undefined ? unknownReading(`The Profile has no ${CATEGORY_LABELS[id] ?? id} facts; it predates Repository Profile version 2`) : null;
}

/** Why a category's search can't support a count, or null when it was complete with nothing skipped. */
function incomplete(categories: JsonObject, id: string): string | null {
  const search = asObject(asObject(categories[id]).search);
  const skipped = asArray(search.skipped).map(String);
  if (skipped.length) return `The ${CATEGORY_LABELS[id] ?? id} search skipped ${skipped.join(", ")}`;
  return search.complete === true ? null : `The ${CATEGORY_LABELS[id] ?? id} search was incomplete`;
}

/** A sum over the app scope of the matching facts; a matching fact that is missing contributes nothing after a complete search. */
function appSum(categories: JsonObject, id: string, matches: (fact: JsonObject) => boolean, field: (scope: JsonObject) => JsonValue | undefined): Reading {
  const missing = present(categories, id);
  if (missing) return missing;
  const facts = category(categories, id).facts.filter(matches);
  const evidence = facts.flatMap((fact) => asArray(fact.evidence).map(String));
  const reason = incomplete(categories, id);
  if (reason) return unknownReading(reason, evidence);
  let total = 0;
  for (const fact of facts) {
    const value = field(asObject(asObject(fact.value)[APP_SCOPE]));
    if ((fact.state !== "observed" && fact.state !== "inferred") || typeof value !== "number") return unknownReading(`The ${CATEGORY_LABELS[id] ?? id} fact ${String(fact.key)} is not established`, evidence);
    total += value;
  }
  return known(total, evidence);
}

/** A whole-number share from the design system's summary, in the app scope; unknown when it has nothing to divide. */
function appShare(categories: JsonObject, id: string, system: string, field: string): Reading {
  const missing = present(categories, id);
  if (missing) return missing;
  const summary = category(categories, id).facts.find((fact) => fact.key === `summary:${system}`);
  const evidence = summary ? asArray(summary.evidence).map(String) : [];
  const reason = incomplete(categories, id);
  if (reason) return unknownReading(reason, evidence);
  const value = summary ? asObject(asObject(summary.value)[APP_SCOPE])[field] : undefined;
  if (typeof value !== "number") return unknownReading(`The ${field.replaceAll("_", " ")} for ${system} has nothing to divide in app code`, evidence);
  return known(value, evidence);
}

/** Whether a recognized design system's theme stylesheet or provider was found; false when the design system isn't recognized after a complete search. */
function designSystemFlag(categories: JsonObject, system: string, field: "theme_stylesheet" | "provider"): Reading {
  const missing = present(categories, "design_systems");
  if (missing) return missing;
  const fact = category(categories, "design_systems").facts.find((item) => item.key === system);
  const evidence = fact ? asArray(fact.evidence).map(String) : [];
  const established = fact !== undefined && (fact.state === "observed" || fact.state === "inferred");
  if (established && asObject(fact.value)[field] === true) return known(true, evidence);
  // Not found is false only after a complete search: a skipped input may hold the import or the provider.
  const reason = incomplete(categories, "design_systems");
  if (reason) return unknownReading(reason, evidence);
  return fact && !established ? unknownReading(`The ${system} design-system fact is not established`, evidence) : known(false, evidence);
}

function serviceContext(service: JsonObject): Context {
  return { scope: "service_dependency", read: (selector) => readService(service, selector), collection: () => ({ items: [], unseen: [] }) };
}

function readService(service: JsonObject, selector: string): Reading {
  const fact = (name: string) => asObject(service[name]);
  const evidenceOf = (name: string) => asArray(fact(name).evidence).map(String);
  const established = (name: string) => fact(name).state === "observed" || fact(name).state === "inferred";
  const presence = (name: string, label: string): Reading => {
    const state = fact(name).state;
    if (state === "observed" || state === "inferred" || state === "conflicting") return known(true, evidenceOf(name));
    if (state === "absent") return known(false, evidenceOf(name));
    return unknownReading(`Whether the service has ${label} is not established`, evidenceOf(name));
  };
  switch (selector) {
    case "service.key":
      return known(String(service.key));
    case "service.client":
      return known(String(asObject(service.client).kind ?? "unknown"), asArray(service.call_sites).map(String));
    case "service.protocol":
      return established("protocol") ? known(String(fact("protocol").value), evidenceOf("protocol")) : unknownReading("The protocol is not established", evidenceOf("protocol"));
    case "service.endpoint_derivation": {
      if (established("endpoint")) return known(String(asObject(fact("endpoint").value).derivation), evidenceOf("endpoint"));
      const detail = asObject(fact("endpoint").value);
      return unknownReading(fact("endpoint").state === "conflicting" ? "The call sites derive the endpoint in conflicting ways" : `The endpoint cannot be established statically${typeof detail.detail === "string" ? `: ${detail.detail}` : ""}`, evidenceOf("endpoint"));
    }
    case "service.characterizable":
      return known(service.characterizable === true, asArray(service.call_sites).map(String));
    case "service.missing_evidence":
      return known(asArray(service.missing_evidence).map(String).sort(compareCodeUnits), asArray(service.call_sites).map(String));
    case "service.operation_count":
      return fact("operations").state === "observed" ? known(asArray(fact("operations").value).length, evidenceOf("operations")) : unknownReading("The operations are not all established", evidenceOf("operations"));
    case "service.authenticated":
      return presence("authentication", "an authentication signal");
    case "service.authentication_headers": {
      const values = fact("authentication").state === "conflicting" ? asArray(fact("authentication").candidates).flatMap((candidate) => asArray(asObject(candidate).value)) : asArray(fact("authentication").value);
      const headers = values.map(asObject).flatMap((item) => (typeof item.header === "string" ? [item.header] : []));
      // Interceptors and wrappers can add headers outside the call site.
      return { known: true, value: [...new Set(headers)].sort(compareCodeUnits), complete: false, reason: "Headers can be added outside the call site", evidence: evidenceOf("authentication") };
    }
    case "service.timeout_ms": {
      const state = fact("timeout").state;
      if (state === "absent") return known(null, evidenceOf("timeout"));
      if (state === "observed") {
        const ms = asObject(fact("timeout").value).ms;
        return known(typeof ms === "number" ? ms : null, evidenceOf("timeout"));
      }
      return unknownReading(state === "conflicting" ? "The call sites set different timeouts" : "The timeout is not established", evidenceOf("timeout"));
    }
    case "service.has_retry": {
      const state = fact("retry").state;
      if (state === "observed") return known(fact("retry").value !== null, evidenceOf("retry"));
      if (state === "absent") return known(false, evidenceOf("retry"));
      return unknownReading(state === "conflicting" ? "The call sites configure retries differently" : "Retries could be configured outside the call site", evidenceOf("retry"));
    }
    case "service.has_contract":
      return presence("contracts", "contract evidence");
    case "service.has_substitute":
      return presence("substitutes", "test substitute evidence");
    case "service.proxied":
      return presence("proxy", "a development proxy");
    case "service.access_state":
      return known(String(asObject(service.access).state ?? "unknown"));
    default:
      return unknownReading(`${selector} is not a Service Dependency field`);
  }
}

/** The Relationship Map: its coverage, and collections of edges, nodes, and gaps. */
export function mapContext(map: MapDocument): Context {
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));
  const gaps = map.coverage.gaps;
  const unseen = (kind: "edge" | "node") =>
    gaps.map((gap) => ({
      reason: `${gap.source.name} has no Profile (${gap.state}), so its relationships are not known`,
      context: kind === "edge" ? unseenEdgeContext(gap.source.name) : missingContext("node", `${gap.source.name} has no Profile`),
    }));
  return {
    scope: "relationship_map",
    read: (selector) => {
      if (selector === "map.coverage_complete") return known(map.coverage.complete);
      if (selector === "map.coverage_gap_count") return known(gaps.length);
      return unknownReading(`${selector} is not a Relationship Map field`);
    },
    collection: (id) => {
      switch (id) {
        case "edges":
          return { items: map.edges.map((edge) => ({ subject: edge.id, context: edgeContext(edge, nodes) })), unseen: unseen("edge") };
        case "nodes":
          return { items: map.nodes.map((node) => ({ subject: node.id, context: nodeContext(node) })), unseen: unseen("node") };
        case "coverage_gaps":
          return { items: gaps.map((gap) => ({ subject: gap.target, context: gapContext(gap) })), unseen: [] };
        default:
          return { items: [], unseen: [] };
      }
    },
  };
}

function nodeName(node: MapNode | undefined): string | null {
  if (!node) return null;
  switch (node.kind) {
    case "repository":
      return node.source.name;
    case "package":
      return node.name;
    case "external_service":
      return node.key;
    case "out_of_scope_source":
      return node.source.name;
    case "unresolved_endpoint":
      return null;
  }
}

function edgeContext(edge: MapEdge, nodes: ReadonlyMap<string, MapNode>): Context {
  return {
    scope: "edge",
    read: (selector) => {
      switch (selector) {
        case "edge.type":
          return known(edge.type, edge.evidence);
        case "edge.state":
          return known(edge.state, edge.evidence);
        case "edge.rule":
          return known(edge.rule, edge.evidence);
        case "edge.from":
          return known(nodeName(nodes.get(edge.from)), edge.evidence);
        case "edge.to":
          // An ambiguous or unresolved endpoint is not known, so it is never matched or ruled out.
          if (edge.state === "ambiguous") {
            const candidates = edge.candidates.map((id) => nodeName(nodes.get(id)) ?? id).sort(compareCodeUnits);
            return unknownReading(`The endpoint is ambiguous among ${candidates.join(", ")}`, edge.evidence);
          }
          if (edge.state === "unresolved") return unknownReading(edge.reason ?? "The endpoint is unresolved", edge.evidence);
          return known(nodeName(nodes.get(edge.to ?? "")), edge.evidence);
        case "edge.package":
          return known(typeof edge.details.package === "string" ? edge.details.package : null, edge.evidence);
        default:
          return unknownReading(`${selector} is not a relationship field`);
      }
    },
    collection: () => ({ items: [], unseen: [] }),
  };
}

/** A relationship a repository without a Profile may declare: only its origin is known. */
function unseenEdgeContext(repository: string): Context {
  return {
    scope: "edge",
    read: (selector) => (selector === "edge.from" ? known(repository) : unknownReading(`${repository} has no Profile, so its relationships are not known`)),
    collection: () => ({ items: [], unseen: [] }),
  };
}

function nodeContext(node: MapNode): Context {
  return {
    scope: "node",
    read: (selector) => (selector === "node.kind" ? known(node.kind) : selector === "node.name" ? known(nodeName(node)) : unknownReading(`${selector} is not a node field`)),
    collection: () => ({ items: [], unseen: [] }),
  };
}

function gapContext(gap: MapDocument["coverage"]["gaps"][number]): Context {
  return {
    scope: "coverage_gap",
    read: (selector) => (selector === "gap.state" ? known(gap.state) : selector === "gap.repository" ? known(gap.source.name) : unknownReading(`${selector} is not a coverage gap field`)),
    collection: () => ({ items: [], unseen: [] }),
  };
}

function missingContext(scope: Scope, reason: string): Context {
  return { scope, read: () => unknownReading(reason), collection: () => ({ items: [], unseen: [{ reason, context: missingContext(scope === "relationship_map" ? "edge" : "service_dependency", reason) }] }) };
}


