import { type JsonObject, type JsonValue, compareCodeUnits } from "@repo-facts/contract";
import { CloneUrl } from "@/lib/catalog/clone-url";
import { type CoverageGap, type EdgeType, MAP_SCHEMA, MAP_SCHEMA_VERSION, type MapEdge, type MapNode, type NodeIdentity, RESOLVER_VERSION, type ReferenceIdentity, type ResolutionState, type SourceIdentity, edgeId, nodeId } from "./schema";

/**
 * Resolves one Assessment's relationship references into a Relationship Map.
 *
 * Resolution reads only the Profiles of this Assessment's targets, plus the
 * identity metadata (name and canonical URL) of catalog sources outside its
 * scope, which can label an otherwise unmatched reference but are never read.
 * It is pure: no Git, source reader, catalog write, DNS, or network access.
 *
 * - Packages: a consumer resolves to the one other repository that produces
 *   the exact package name.
 * - Composition: a Module Federation host resolves by the remote's declared
 *   federation name; import-map and single-spa hosts resolve by the package
 *   name an application produces.
 * - Iframes and runtime contracts name only URLs. Matching a URL needs the
 *   origin an application is served from, which no Profile records yet, so
 *   they stay unresolved and say so.
 * - Service calls resolve to a logical service by literal origin, by the
 *   origin of a tied OpenAPI contract, by shared configuration key, or by
 *   packaged client. Same-origin and host-provided services are scoped to
 *   their repository, and dynamic destinations stay unresolved.
 *
 * More than one candidate is ambiguous and none is unresolved; nothing is
 * guessed or dropped.
 */

export interface ResolverTarget {
  public_id: string;
  source: SourceIdentity;
  state: "complete" | "failed" | "canceled";
  failure: string | null;
  profile: { digest: string; document: JsonObject } | null;
}

/** A catalog source outside the Assessment's scope: identity metadata only. */
export interface CatalogIdentity {
  public_id: string;
  name: string;
  canonical_url: string;
}

interface Reference extends ReferenceIdentity {
  basis: "observed" | "inferred";
  evidence: string[];
}

interface Contributor {
  node: string;
  source: SourceIdentity;
  facts: JsonObject;
  references: Reference[];
}

const NO_SERVED_ORIGIN = "No Profile in this Assessment records the origin an application is served from, so a URL cannot be matched to a repository";

export function resolveRelationships(input: { targets: readonly ResolverTarget[]; outOfScope: readonly CatalogIdentity[] }): JsonObject {
  const map = new MapBuilder();
  const contributors: Contributor[] = [];
  const gaps: CoverageGap[] = [];

  for (const target of [...input.targets].sort((a, b) => compareCodeUnits(a.source.public_id, b.source.public_id))) {
    if (!target.profile) {
      if (target.state === "complete") throw new Error(`Target ${target.public_id} is complete but has no Profile`);
      gaps.push({ target: target.public_id, source: target.source, state: target.state, reason: target.failure });
      continue;
    }
    const facts = record(target.profile.document.fact_document);
    const node = map.node({ kind: "repository", source: target.source, target: target.public_id, commit: String(target.profile.document.commit), profile_digest: target.profile.digest });
    const references = list(facts.relationship_references).map((item) => {
      const value = record(item);
      return { type: String(value.type), role: String(value.role), identifier: strings(value.identifier), basis: value.basis === "inferred" ? "inferred" : "observed", evidence: list(value.evidence).map(String) } satisfies Reference;
    });
    contributors.push({ node, source: target.source, facts, references });
  }

  const producers = indexBy(contributors, (contributor) => contributor.references.filter((reference) => reference.type === "package" && reference.role === "producer").map((reference) => [reference.identifier.name!, reference]));
  const remotes = indexBy(contributors, (contributor) =>
    contributor.references.filter((reference) => reference.type === "composition" && reference.role === "remote" && reference.identifier.mechanism === "module-federation").map((reference) => [reference.identifier.name!, reference]),
  );
  const catalog = new CatalogLabels(input.outOfScope, map);

  for (const contributor of contributors) {
    for (const reference of contributor.references) {
      if (reference.type === "package" && reference.role === "producer") {
        const to = map.node({ kind: "package", name: reference.identifier.name! });
        map.edge(contributor, { type: "package_production", reference, to, state: "resolved", rule: "package.production", details: { package: reference.identifier.name! } }, [[contributor, reference.evidence]]);
      } else if (reference.type === "package" && reference.role === "consumer") {
        resolvePackage(map, catalog, contributor, reference, producers);
      } else if (reference.type === "composition" && reference.role === "host") {
        resolveComposition(map, catalog, contributor, reference, producers, remotes);
      } else if (reference.type === "iframe" || reference.type === "runtime_contract") {
        const type: EdgeType = reference.type;
        const to = map.node({ kind: "unresolved_endpoint", reference: { type: reference.type, identifier: reference.identifier } });
        map.edge(contributor, { type, reference, to, state: "unresolved", rule: `${reference.type === "iframe" ? "iframe" : "runtime-contract"}.served-origin`, reason: NO_SERVED_ORIGIN, details: { ...reference.identifier } }, [[contributor, reference.evidence]]);
      }
      // Remote declarations are endpoints, and service references are resolved from their Service Dependencies below.
    }
    for (const dependency of list(contributor.facts.service_dependencies)) resolveService(map, contributor, record(dependency));
  }

  const nodes = [...map.nodes.values()].sort((a, b) => compareCodeUnits(a.id, b.id));
  return {
    schema: MAP_SCHEMA,
    schema_version: MAP_SCHEMA_VERSION,
    resolver_version: RESOLVER_VERSION,
    nodes: nodes as unknown as JsonValue[],
    edges: map.edges.sort((a, b) => compareCodeUnits(a.id, b.id)) as unknown as JsonValue[],
    coverage: { complete: gaps.length === 0, contributors: contributors.map((contributor) => contributor.node).sort(compareCodeUnits), gaps: gaps as unknown as JsonValue[] },
    evidence: Object.fromEntries([...map.evidence.entries()].sort(([a], [b]) => compareCodeUnits(a, b))),
  };
}

type Candidate = { contributor: Contributor; reference: Reference };

function resolvePackage(map: MapBuilder, catalog: CatalogLabels, contributor: Contributor, reference: Reference, producers: Map<string, Candidate[]>) {
  const name = reference.identifier.name!;
  const details = { package: name };
  // A repository's use of its own workspace package is an internal fact in its Profile, never a consumer reference.
  const candidates = producers.get(name) ?? [];
  if (candidates.length) {
    resolveAmong(map, contributor, reference, candidates, { type: "package_dependency", rule: "package.exact-name", details, noun: `a package named ${name}` });
    return;
  }
  const label = catalog.match(name, gitUrlOf(contributor.facts, name));
  if (label) {
    map.edge(contributor, { type: "package_dependency", reference, ...label, details }, [[contributor, reference.evidence]]);
    return;
  }
  const to = map.node({ kind: "package", name });
  map.edge(contributor, { type: "package_dependency", reference, to, state: "unresolved", rule: "package.unresolved", reason: `No repository in this Assessment produces ${name}`, details }, [[contributor, reference.evidence]]);
}

function resolveComposition(map: MapBuilder, catalog: CatalogLabels, contributor: Contributor, reference: Reference, producers: Map<string, Candidate[]>, remotes: Map<string, Candidate[]>) {
  const mechanism = reference.identifier.mechanism;
  const compositionFacts = list(record(record(contributor.facts.categories).composition).facts).map(record);
  let name: string;
  let candidates: Candidate[];
  let rule: string;
  let noun: string;
  const details: JsonObject = { ...reference.identifier };
  if (mechanism === "module-federation") {
    name = reference.identifier.name!;
    candidates = remotes.get(name) ?? [];
    rule = "composition.federation-name";
    noun = `a Module Federation remote named ${name}`;
    const remote = compositionFacts.flatMap((fact) => list(record(fact.value).remotes).map(record)).find((item) => item.federation_name === name);
    const entry = record(remote?.entry);
    if (entry.kind === "literal" && typeof entry.value === "string") details.url = entry.value;
  } else {
    name = mechanism === "import-map" ? reference.identifier.specifier! : reference.identifier.application!;
    candidates = producers.get(name) ?? [];
    rule = mechanism === "import-map" ? "composition.import-map-specifier" : "composition.single-spa-application";
    noun = `a package named ${name}`;
    const mapped = compositionFacts.find((fact) => record(fact.value).mechanism === "import-map" && record(fact.value).specifier === name);
    if (typeof record(mapped?.value).url === "string") details.url = record(mapped?.value).url as string;
  }
  if (candidates.length) {
    resolveAmong(map, contributor, reference, candidates, { type: "composition", rule, details, noun });
    return;
  }
  const label = catalog.match(name, null);
  if (label) {
    map.edge(contributor, { type: "composition", reference, ...label, details }, [[contributor, reference.evidence]]);
    return;
  }
  const to = map.node({ kind: "unresolved_endpoint", reference: { type: reference.type, identifier: reference.identifier } });
  const reason = `No repository in this Assessment declares ${noun}${details.url ? `, and its URL cannot be matched: ${NO_SERVED_ORIGIN.charAt(0).toLowerCase()}${NO_SERVED_ORIGIN.slice(1)}` : ""}`;
  map.edge(contributor, { type: "composition", reference, to, state: "unresolved", rule, reason, details }, [[contributor, reference.evidence]]);
}

/** One candidate resolves the reference; several leave it ambiguous with all of them. */
function resolveAmong(map: MapBuilder, contributor: Contributor, reference: Reference, candidates: Candidate[], options: { type: EdgeType; rule: string; details: JsonObject; noun: string }) {
  const cited: [Contributor, string[]][] = [[contributor, reference.evidence], ...candidates.map((candidate): [Contributor, string[]] => [candidate.contributor, candidate.reference.evidence])];
  const nodes = [...new Set(candidates.map((candidate) => candidate.contributor.node))].sort(compareCodeUnits);
  if (nodes.length === 1) {
    map.edge(contributor, { type: options.type, reference, to: nodes[0]!, state: "resolved", rule: options.rule, details: options.details }, cited);
  } else {
    map.edge(contributor, { type: options.type, reference, to: null, candidates: nodes, state: "ambiguous", rule: options.rule, reason: `${nodes.length} repositories in this Assessment declare ${options.noun}`, details: options.details }, cited);
  }
}

function resolveService(map: MapBuilder, contributor: Contributor, dependency: JsonObject) {
  const key = String(dependency.key);
  const identity = record(dependency.identity);
  const identityValue = record(identity.value);
  const kind = identity.state === "observed" || identity.state === "inferred" ? String(identityValue.kind) : "call_site";
  const protocol = typeof record(dependency.protocol).value === "string" ? String(record(dependency.protocol).value) : "http";
  const reference: ReferenceIdentity = { type: "service", role: "caller", identifier: { key } };
  const callSites = list(dependency.call_sites).map(String);
  const cited = [...callSites, ...list(identity.evidence).map(String)];
  const details = serviceDetails(dependency);
  const basis = identity.state === "observed" ? "observed" : "inferred";

  if (kind === "call_site") {
    const to = map.node({ kind: "unresolved_endpoint", reference: { type: "service", identifier: { key } } });
    map.edge(contributor, { type: "service_call", reference, to, state: "unresolved", rule: "service.dynamic-destination", reason: "The call's destination is not determined statically", details }, [[contributor, cited]]);
    return;
  }
  if (kind === "origin") {
    const to = map.node({ kind: "external_service", key, protocol, identity: { kind, value: String(identityValue.value) }, scope: null });
    map.edge(contributor, { type: "service_call", reference, to, state: "resolved", rule: "service.literal-origin", basis, details }, [[contributor, cited]]);
    return;
  }

  // A tied OpenAPI contract whose servers name literal origins identifies the service by origin.
  const contract = contractOrigins(contributor.facts, dependency);
  if (contract.origins.length) {
    const prefix = protocol === "http" ? "" : `${protocol}:`;
    const nodes = contract.origins.map((origin) => map.node({ kind: "external_service", key: `${prefix}${origin}`, protocol, identity: { kind: "origin", value: origin }, scope: null }));
    const evidence: [Contributor, string[]][] = [[contributor, [...cited, ...contract.evidence]]];
    if (nodes.length === 1) {
      map.edge(contributor, { type: "service_call", reference, to: nodes[0]!, state: "resolved", rule: "service.contract-origin", basis: "inferred", reason: null, details: { ...details, contract_origins: contract.origins } }, evidence);
    } else {
      map.edge(contributor, { type: "service_call", reference, to: null, candidates: [...nodes].sort(compareCodeUnits), state: "ambiguous", rule: "service.contract-origin", basis: "inferred", reason: `The contracts tied to this service name ${nodes.length} different origins`, details: { ...details, contract_origins: contract.origins } }, evidence);
    }
    return;
  }

  // Configuration keys and packaged clients identify a service across repositories; same-origin and host-provided services belong to their repository.
  const scoped = kind === "same_origin" || kind === "host";
  const rule = kind === "configuration" ? "service.configuration-key" : kind === "package" ? "service.packaged-client" : kind === "same_origin" ? "service.same-origin" : "service.host-provided";
  const to = map.node({ kind: "external_service", key, protocol, identity: { kind, value: String(identityValue.value) }, scope: scoped ? contributor.source.public_id : null });
  map.edge(contributor, { type: "service_call", reference, to, state: "resolved", rule, basis, details }, [[contributor, cited]]);
}

/** The Service Dependency facts a relationship Control may read, with their states. */
function serviceDetails(dependency: JsonObject): JsonObject {
  const fact = (name: string): JsonValue => {
    const value = record(dependency[name]);
    if (!value.state) return null;
    return { state: value.state as string, value: value.value ?? null, ...(Array.isArray(value.candidates) && { candidates: value.candidates.map((candidate) => record(candidate).value ?? null) }) };
  };
  return {
    key: String(dependency.key),
    client: dependency.client ?? null,
    identity: fact("identity"),
    protocol: fact("protocol"),
    endpoint: fact("endpoint"),
    operations: fact("operations"),
    authentication: fact("authentication"),
    contracts: fact("contracts"),
    substitutes: fact("substitutes"),
    proxy: fact("proxy"),
    access: dependency.access ?? null,
    characterizable: dependency.characterizable ?? null,
    missing_evidence: dependency.missing_evidence ?? [],
  };
}

function contractOrigins(facts: JsonObject, dependency: JsonObject): { origins: string[]; evidence: string[] } {
  const contracts = record(dependency.contracts);
  const values = contracts.state === "observed" || contracts.state === "inferred" ? [contracts.value] : contracts.state === "conflicting" ? list(contracts.candidates).map((candidate) => record(candidate).value) : [];
  const paths = new Set(values.flatMap((value) => list(value).map(record)).filter((item) => item.kind === "openapi").map((item) => String(item.path)));
  const documents = list(record(record(facts.categories).api_contracts).facts).map(record).filter((fact) => paths.has(String(fact.key)));
  const origins = new Set<string>();
  for (const document of documents) {
    for (const server of list(record(document.value).servers)) {
      const origin = /^((?:https?|wss?):\/\/[^/?#]+)/i.exec(String(server))?.[1];
      if (origin) origins.add(origin.toLowerCase());
    }
  }
  return { origins: [...origins].sort(compareCodeUnits), evidence: [...list(contracts.evidence).map(String), ...documents.flatMap((document) => list(document.evidence).map(String))] };
}

/** The canonical Git URL a consumer declares for +name+, when its specifier is one. */
function gitUrlOf(facts: JsonObject, name: string): string | null {
  const dependencyFacts = list(record(record(facts.categories).dependencies).facts).map(record);
  for (const fact of dependencyFacts) {
    const values = fact.state === "conflicting" ? list(fact.candidates).map((candidate) => record(record(candidate).value)) : [record(fact.value)];
    for (const value of values) {
      if (value.name !== name || typeof value.specifier !== "string") continue;
      try {
        // A `#committish` names a revision of the repository, not a different one.
        return CloneUrl.parse(value.specifier.replace(/^git\+/, "").replace(/#.*$/, "")).canonical;
      } catch {
        // Not a clone URL: a version range, tag, or path.
      }
    }
  }
  return null;
}

/** Labels an unmatched reference with a catalog source outside the scope, from its identity metadata alone. */
class CatalogLabels {
  constructor(
    private readonly sources: readonly CatalogIdentity[],
    private readonly map: MapBuilder,
  ) {}

  match(name: string, url: string | null): { to: string | null; candidates?: string[]; state: ResolutionState; rule: string; basis: "observed" | "inferred"; reason: string } | null {
    const byUrl = url ? this.sources.filter((source) => source.canonical_url === url) : [];
    const matches = byUrl.length ? byUrl : this.sources.filter((source) => source.name === name);
    if (!matches.length) return null;
    const rule = byUrl.length ? "catalog.canonical-url" : "catalog.name";
    const basis = byUrl.length ? "observed" : "inferred";
    const nodes = matches.map((source) => this.map.node({ kind: "out_of_scope_source", source: { public_id: source.public_id, name: source.name, canonical_url: source.canonical_url } })).sort(compareCodeUnits);
    const how = byUrl.length ? `the declared Git URL ${url}` : `the name ${name}`;
    if (nodes.length === 1) return { to: nodes[0]!, state: "out_of_scope", rule, basis, reason: `A catalog source outside this Assessment's scope matches ${how}; it was not analyzed` };
    return { to: null, candidates: nodes, state: "ambiguous", rule, basis, reason: `${nodes.length} catalog sources outside this Assessment's scope match ${how}; none was analyzed` };
  }
}

type EdgeInput = { type: EdgeType; reference: ReferenceIdentity; to: string | null; candidates?: string[]; state: ResolutionState; rule: string; basis?: "observed" | "inferred"; reason?: string | null; details: JsonObject };

class MapBuilder {
  readonly nodes = new Map<string, MapNode>();
  readonly edges: MapEdge[] = [];
  readonly evidence = new Map<string, JsonObject>();

  node(identity: NodeIdentity): string {
    const id = nodeId(identity);
    if (!this.nodes.has(id)) this.nodes.set(id, { id, ...identity } as MapNode);
    return id;
  }

  /** Adds an edge from +from+, embedding every evidence record it cites from each contributing Profile. */
  edge(from: Contributor, input: EdgeInput, cited: readonly [Contributor, readonly string[]][]): void {
    const evidence = new Set<string>();
    for (const [contributor, ids] of cited) {
      const records = record(contributor.facts.evidence);
      for (const id of ids) {
        if (!records[id]) continue;
        evidence.add(id);
        this.evidence.set(id, record(records[id]));
      }
    }
    const reference = { type: input.reference.type, role: input.reference.role, identifier: input.reference.identifier };
    this.edges.push({
      id: edgeId({ type: input.type, from: from.node, reference }),
      type: input.type,
      from: from.node,
      to: input.to,
      state: input.state,
      candidates: input.candidates ?? [],
      reference,
      rule: input.rule,
      basis: input.basis ?? (input.reference as Partial<Reference>).basis ?? "observed",
      reason: input.reason ?? null,
      evidence: [...evidence].sort(compareCodeUnits),
      details: input.details,
    });
  }
}

function indexBy(contributors: readonly Contributor[], entries: (contributor: Contributor) => [string, Reference][]): Map<string, Candidate[]> {
  const index = new Map<string, Candidate[]>();
  for (const contributor of contributors) {
    for (const [key, reference] of entries(contributor)) index.set(key, [...(index.get(key) ?? []), { contributor, reference }]);
  }
  return index;
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function list(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, String(item)]));
}
