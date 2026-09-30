import { type JsonObject, type JsonValue, dump, sha256 } from "@repo-facts/contract";
import { z } from "zod";
import { DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";

/**
 * Relationship Map document, version 1.
 *
 * One map per Assessment, resolved from the relationship references in the
 * Assessment's own Profiles. Nodes are repositories (one per Profile),
 * packages, external services, out-of-scope catalog sources, and endpoints
 * that could not be resolved. Every edge is directional, keeps the reference
 * that declared it, and has a resolution state: resolved, ambiguous (with every
 * candidate), unresolved, or out of scope. Coverage lists the targets that
 * contributed a Profile and every target that did not, so a missing Profile is
 * never read as a repository without relationships.
 *
 * Identifiers are digests of each item's identity, so identical inputs produce
 * identical identifiers, and nodes and edges are ordered by identifier. The
 * map embeds every evidence record its edges cite.
 */

export const MAP_SCHEMA = DOCUMENT_SCHEMAS.relationshipMap.name;
export const MAP_SCHEMA_VERSION = 1;
export const RESOLVER_VERSION = "1";

export const NODE_KINDS = ["repository", "package", "external_service", "out_of_scope_source", "unresolved_endpoint"] as const;
export const EDGE_TYPES = ["package_dependency", "package_production", "composition", "iframe", "runtime_contract", "service_call"] as const;
export const RESOLUTION_STATES = ["resolved", "ambiguous", "unresolved", "out_of_scope"] as const;

export type NodeKind = (typeof NODE_KINDS)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type ResolutionState = (typeof RESOLUTION_STATES)[number];

export interface SourceIdentity {
  public_id: string;
  name: string;
}

export interface ReferenceIdentity {
  type: string;
  role: string;
  identifier: Record<string, string>;
}

export type MapNode =
  | { id: string; kind: "repository"; source: SourceIdentity; target: string; commit: string; profile_digest: string }
  | { id: string; kind: "package"; name: string }
  | { id: string; kind: "external_service"; key: string; protocol: string; identity: { kind: string; value: string }; scope: string | null }
  | { id: string; kind: "out_of_scope_source"; source: SourceIdentity & { canonical_url: string } }
  | { id: string; kind: "unresolved_endpoint"; reference: { type: string; identifier: Record<string, string> } };

export interface MapEdge {
  id: string;
  type: EdgeType;
  from: string;
  /** The endpoint; null only when the edge is ambiguous. */
  to: string | null;
  state: ResolutionState;
  /** Every plausible endpoint of an ambiguous edge; empty otherwise. */
  candidates: string[];
  reference: ReferenceIdentity;
  rule: string;
  basis: "observed" | "inferred";
  reason: string | null;
  evidence: string[];
  details: JsonObject;
}

export interface CoverageGap {
  target: string;
  source: SourceIdentity;
  state: "failed" | "canceled";
  reason: string | null;
}

export interface MapDocument {
  schema: string;
  schema_version: number;
  resolver_version: string;
  nodes: MapNode[];
  edges: MapEdge[];
  coverage: { complete: boolean; contributors: string[]; gaps: CoverageGap[] };
  evidence: Record<string, JsonObject>;
}

/** A node without its identifier, for each kind. */
export type NodeIdentity = { [K in MapNode["kind"]]: Omit<Extract<MapNode, { kind: K }>, "id"> }[MapNode["kind"]];

/** The fields that identify a node; everything else describes it. */
function nodeIdentity(node: NodeIdentity): JsonValue {
  switch (node.kind) {
    case "repository":
      return { kind: node.kind, source: node.source.public_id };
    case "package":
      return { kind: node.kind, name: node.name };
    case "external_service":
      return { kind: node.kind, key: node.key, scope: node.scope };
    case "out_of_scope_source":
      return { kind: node.kind, source: node.source.public_id };
    case "unresolved_endpoint":
      return { kind: node.kind, type: node.reference.type, identifier: node.reference.identifier };
  }
}

export function nodeId(node: NodeIdentity): string {
  return `node_${sha256(dump(nodeIdentity(node))).slice(0, 24)}`;
}

export function edgeId(edge: Pick<MapEdge, "type" | "from" | "reference">): string {
  return `edge_${sha256(dump({ type: edge.type, from: edge.from, reference: edge.reference as unknown as JsonObject })).slice(0, 24)}`;
}

const nodeIdPattern = z.string().regex(/^node_[0-9a-f]{24}$/);
const evidenceIds = z.array(z.string().regex(/^ev_[0-9a-f]{24}$/));
const source = z.strictObject({ public_id: z.string().min(1), name: z.string().min(1) });
const identifier = z.record(z.string(), z.string());

const nodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ id: nodeIdPattern, kind: z.literal("repository"), source, target: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/), profile_digest: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.strictObject({ id: nodeIdPattern, kind: z.literal("package"), name: z.string().min(1) }),
  z.strictObject({
    id: nodeIdPattern,
    kind: z.literal("external_service"),
    key: z.string().min(1),
    protocol: z.string().min(1),
    identity: z.strictObject({ kind: z.string().min(1), value: z.string().min(1) }),
    scope: z.string().min(1).nullable(),
  }),
  z.strictObject({ id: nodeIdPattern, kind: z.literal("out_of_scope_source"), source: source.extend({ canonical_url: z.string().min(1) }).strict() }),
  z.strictObject({ id: nodeIdPattern, kind: z.literal("unresolved_endpoint"), reference: z.strictObject({ type: z.string().min(1), identifier }) }),
]);

const edgeSchema = z.strictObject({
  id: z.string().regex(/^edge_[0-9a-f]{24}$/),
  type: z.enum(EDGE_TYPES),
  from: nodeIdPattern,
  to: nodeIdPattern.nullable(),
  state: z.enum(RESOLUTION_STATES),
  candidates: z.array(nodeIdPattern),
  reference: z.strictObject({ type: z.string().min(1), role: z.string().min(1), identifier }),
  rule: z.string().min(1),
  basis: z.enum(["observed", "inferred"]),
  reason: z.string().min(1).nullable(),
  evidence: evidenceIds.min(1),
  details: z.record(z.string(), z.unknown()),
});

const mapSchema = z.strictObject({
  schema: z.literal(MAP_SCHEMA),
  schema_version: z.literal(MAP_SCHEMA_VERSION),
  resolver_version: z.string().min(1),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  coverage: z.strictObject({
    complete: z.boolean(),
    contributors: z.array(nodeIdPattern),
    gaps: z.array(z.strictObject({ target: z.string().min(1), source, state: z.enum(["failed", "canceled"]), reason: z.string().min(1).nullable() })),
  }),
  evidence: z.record(z.string().regex(/^ev_[0-9a-f]{24}$/), z.record(z.string(), z.unknown())),
});

/** Every problem with a map document: its shape, identifiers, ordering, and references between nodes, edges, and evidence. */
export function mapProblems(document: JsonObject): string[] {
  const parsed = mapSchema.safeParse(document);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".") || "(document)"}: ${issue.message}`);
  const map = document as unknown as MapDocument;
  const problems: string[] = [];

  const nodes = new Map<string, MapNode>();
  for (const node of map.nodes) {
    if (nodes.has(node.id)) problems.push(`node ${node.id} appears more than once`);
    if (nodeId(node) !== node.id) problems.push(`node ${node.id} does not match its identity`);
    nodes.set(node.id, node);
  }
  const edges = new Set<string>();
  for (const edge of map.edges) {
    const label = `edge ${edge.id}`;
    if (edges.has(edge.id)) problems.push(`${label} appears more than once`);
    edges.add(edge.id);
    if (edgeId(edge) !== edge.id) problems.push(`${label} does not match its identity`);
    if (nodes.get(edge.from)?.kind !== "repository") problems.push(`${label} must start at a repository node`);
    const ambiguous = edge.state === "ambiguous";
    if (ambiguous !== (edge.to === null)) problems.push(`${label} must name its endpoint unless it is ambiguous`);
    if (ambiguous !== edge.candidates.length > 1) problems.push(`${label} must list two or more candidates exactly when it is ambiguous`);
    for (const id of [edge.to, ...edge.candidates]) if (id !== null && !nodes.has(id)) problems.push(`${label} refers to missing node ${id}`);
    if (edge.state !== "resolved" && !edge.reason) problems.push(`${label} must explain why it is ${edge.state}`);
    for (const id of edge.evidence) if (!map.evidence[id]) problems.push(`${label} cites missing evidence ${id}`);
    if (!isSorted(edge.candidates) || !isSorted(edge.evidence)) problems.push(`${label} must list candidates and evidence in order`);
  }
  if (!isSorted(map.nodes.map((node) => node.id))) problems.push("Nodes must be ordered by identifier");
  if (!isSorted(map.edges.map((edge) => edge.id))) problems.push("Edges must be ordered by identifier");
  for (const id of map.coverage.contributors) if (nodes.get(id)?.kind !== "repository") problems.push(`contributor ${id} is not a repository node`);
  if (map.coverage.complete !== (map.coverage.gaps.length === 0)) problems.push("Coverage is complete exactly when no target is missing");
  return problems;
}

function isSorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}
