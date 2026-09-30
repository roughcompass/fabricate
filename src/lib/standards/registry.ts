import { CLIENT_KINDS, SERVICE_FACTS } from "@repo-facts/contract";
import { EDGE_TYPES, NODE_KINDS, RESOLUTION_STATES } from "@/lib/relationships/schema";

/**
 * Schema registries for Standard expressions: every selector and collection a
 * Control may name, by input schema and version.
 *
 * A selector reads one typed value in a scope: a repository's Profile, one of
 * its Service Dependencies, the Relationship Map, or one map edge, node, or
 * coverage gap. A collection is a list a quantifier ranges over, whose items
 * are read in the collection's item scope. Validation resolves every selector
 * and collection here; nothing in a Control is interpreted as a property path,
 * function name, or pattern. See docs/standards.md.
 */

export const INPUT_SCHEMAS = ["repository_profile", "relationship_map"] as const;
export type InputSchema = (typeof INPUT_SCHEMAS)[number];

/** Input schema versions this release can evaluate. */
export const SUPPORTED_VERSIONS: Readonly<Record<InputSchema, readonly number[]>> = { repository_profile: [1], relationship_map: [1] };

export const SCOPES = ["repository", "service_dependency", "relationship_map", "edge", "node", "coverage_gap"] as const;
export type Scope = (typeof SCOPES)[number];

export const VALUE_TYPES = ["boolean", "string", "string_set", "number", "version"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export interface SelectorDefinition {
  id: string;
  label: string;
  description: string;
  scope: Scope;
  type: ValueType;
  schema: InputSchema;
  versions: readonly number[];
  /** A selector that reads one named item, such as a package, takes a parameter. */
  parameter?: { label: string; description: string };
  /** The closed vocabulary of a string value, when it has one. */
  choices?: readonly string[];
}

export interface CollectionDefinition {
  id: string;
  label: string;
  description: string;
  /** The scope the collection appears in. */
  scope: Scope;
  /** The scope its items are read in. */
  item: Scope;
  schema: InputSchema;
  versions: readonly number[];
}

const profile = (id: string, label: string, type: ValueType, description: string, extra: Partial<SelectorDefinition> = {}): SelectorDefinition => ({ id, label, description, scope: "repository", type, schema: "repository_profile", versions: [1], ...extra });
const service = (id: string, label: string, type: ValueType, description: string, extra: Partial<SelectorDefinition> = {}): SelectorDefinition => ({ id, label, description, scope: "service_dependency", type, schema: "repository_profile", versions: [1], ...extra });
const graph = (scope: Scope, id: string, label: string, type: ValueType, description: string, extra: Partial<SelectorDefinition> = {}): SelectorDefinition => ({ id, label, description, scope, type, schema: "relationship_map", versions: [1], ...extra });

export const SELECTORS: readonly SelectorDefinition[] = [
  profile("repository.languages", "Languages", "string_set", "Languages by committed file extension"),
  profile("repository.package_managers", "Package managers", "string_set", "Package managers declared or implied by lockfiles"),
  profile("repository.build_tools", "Build tools", "string_set", "Bundlers and compilers, by identifier"),
  profile("repository.test_frameworks", "Test frameworks", "string_set", "Test runners, by identifier"),
  profile("repository.frameworks", "Frameworks", "string_set", "Application frameworks, by identifier"),
  profile("repository.ci_systems", "CI systems", "string_set", "CI systems with a supported definition"),
  profile("repository.verification_command_kinds", "Verification command kinds", "string_set", "Kinds of declared verification commands, such as test, lint, and build"),
  profile("repository.composition_mechanisms", "Composition mechanisms", "string_set", "Micro-frontend and composition mechanisms"),
  profile("repository.packages_produced", "Packages produced", "string_set", "Package names this repository produces"),
  profile("repository.packages_consumed", "Packages consumed", "string_set", "Package names this repository depends on"),
  profile("repository.runtime_integrations", "Runtime integrations", "string_set", "Runtime contracts produced or consumed, such as postMessage"),
  profile("repository.access_signal_kinds", "Access signal kinds", "string_set", "Kinds of credential, certificate, authentication, and network-zone signals, never their values"),
  profile("repository.egress_route_kinds", "Proxy and gateway kinds", "string_set", "Kinds of proxy variables, development proxies, and gateway configuration"),
  profile("repository.api_contract_kinds", "API contract kinds", "string_set", "Kinds of committed API contracts and generated schemas"),
  profile("repository.test_substitute_kinds", "Test substitute kinds", "string_set", "Kinds of existing interceptors, mocks, stubs, and fixtures"),
  profile("repository.submodule_count", "Submodules", "number", "Number of Git submodule declarations"),
  profile("repository.workspace_count", "Workspace packages", "number", "Number of workspace package directories"),
  profile("repository.node_range", "Node.js requirement", "version", "The Node.js versions the repository's declarations allow"),
  profile("repository.declared_range", "Declared dependency range", "version", "The version range manifests declare for a direct dependency", { parameter: { label: "Package", description: "The dependency's exact package name" } }),
  profile("repository.resolved_version", "Resolved dependency version", "version", "The versions lockfiles resolve for a direct dependency", { parameter: { label: "Package", description: "The dependency's exact package name" } }),

  service("service.key", "Service identity", "string", "The logical identity key of the Service Dependency"),
  service("service.client", "Client kind", "string", "How the service is called", { choices: CLIENT_KINDS }),
  service("service.protocol", "Protocol", "string", "HTTP, GraphQL, WebSocket, or server-sent events", { choices: ["http", "graphql", "websocket", "sse"] }),
  service("service.endpoint_derivation", "Endpoint derivation", "string", "Whether the destination is a literal, relative to the application, configured, provided by a host, or unknown", {
    choices: ["literal", "relative", "configured", "host_provided", "unknown"],
  }),
  service("service.characterizable", "Boundary characterizable", "boolean", "Whether endpoint, operations, and consumed response fields are all established"),
  service("service.missing_evidence", "Missing evidence", "string_set", "Service facts that are unknown or conflicting", { choices: SERVICE_FACTS }),
  service("service.operation_count", "Operations", "number", "Number of distinct operations the calls make"),
  service("service.authenticated", "Authentication signal", "boolean", "Whether the call site states an authentication signal, such as a credential header"),
  service("service.authentication_headers", "Authentication headers", "string_set", "Credential header names the call sites send, never values"),
  service("service.timeout_ms", "Timeout", "number", "The timeout the call sites set, in milliseconds"),
  service("service.has_retry", "Retry configured", "boolean", "Whether retries are configured for the calls"),
  service("service.has_contract", "Contract evidence", "boolean", "Whether a committed contract or generated schema is tied to the service by evidence"),
  service("service.has_substitute", "Test substitute evidence", "boolean", "Whether an existing interceptor, mock, stub, or fixture is tied to the service by evidence"),
  service("service.proxied", "Development proxy", "boolean", "Whether a development proxy route handles the calls"),
  service("service.access_state", "Access", "string", "Always unknown: static discovery cannot establish entitlement or reachability", { choices: ["unknown"] }),

  graph("relationship_map", "map.coverage_complete", "Coverage complete", "boolean", "Whether every scoped repository contributed a Profile"),
  graph("relationship_map", "map.coverage_gap_count", "Coverage gaps", "number", "Number of scoped repositories without a Profile"),
  graph("edge", "edge.type", "Relationship type", "string", "The kind of relationship", { choices: EDGE_TYPES }),
  graph("edge", "edge.state", "Resolution state", "string", "Whether the endpoint is resolved, ambiguous, unresolved, or out of scope", { choices: RESOLUTION_STATES }),
  graph("edge", "edge.rule", "Resolver rule", "string", "The rule that resolved the relationship"),
  graph("edge", "edge.from", "From repository", "string", "The source name of the repository that declares the relationship"),
  graph("edge", "edge.to", "To", "string", "The endpoint's name: a repository, package, service key, or catalog source; unknown when ambiguous"),
  graph("edge", "edge.package", "Package", "string", "The package a package relationship names"),
  graph("node", "node.kind", "Node kind", "string", "Repository, package, external service, out-of-scope source, or unresolved endpoint", { choices: NODE_KINDS }),
  graph("node", "node.name", "Node name", "string", "A repository's source name, a package name, a service key, or a catalog source name"),
  graph("coverage_gap", "gap.state", "Gap state", "string", "Whether the repository failed or was canceled", { choices: ["failed", "canceled"] }),
  graph("coverage_gap", "gap.repository", "Gap repository", "string", "The source name of the repository without a Profile"),
];

export const COLLECTIONS: readonly CollectionDefinition[] = [
  { id: "service_dependencies", label: "Service Dependencies", description: "The repository's outbound Service Dependencies", scope: "repository", item: "service_dependency", schema: "repository_profile", versions: [1] },
  { id: "edges", label: "Relationships", description: "Every edge in the Relationship Map", scope: "relationship_map", item: "edge", schema: "relationship_map", versions: [1] },
  { id: "nodes", label: "Nodes", description: "Every node in the Relationship Map", scope: "relationship_map", item: "node", schema: "relationship_map", versions: [1] },
  { id: "coverage_gaps", label: "Coverage gaps", description: "Scoped repositories that did not contribute a Profile", scope: "relationship_map", item: "coverage_gap", schema: "relationship_map", versions: [1] },
];

/** Lookups by identifier. Maps keep untrusted identifiers away from object property lookup. */
export const SELECTOR_BY_ID: ReadonlyMap<string, SelectorDefinition> = new Map(SELECTORS.map((selector) => [selector.id, selector]));
export const COLLECTION_BY_ID: ReadonlyMap<string, CollectionDefinition> = new Map(COLLECTIONS.map((collection) => [collection.id, collection]));

/** The scope a Control's expressions start in. */
export const SUBJECT_SCOPE = { repository: "repository", relationship_map: "relationship_map" } as const satisfies Record<string, Scope>;

/** The input schema each scope reads. */
export function schemaOfScope(scope: Scope): InputSchema {
  return scope === "repository" || scope === "service_dependency" ? "repository_profile" : "relationship_map";
}
