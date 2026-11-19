import { eq, inArray } from "drizzle-orm";
import type { JsonObject } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import {
  EVIDENCE_LOCATION_KINDS,
  type EdgeKind,
  runTargets,
  dependencyFacts,
  evidenceIndex,
  graphEdgeCandidates,
  graphEdges,
  graphNodes,
  repositories,
} from "@/lib/db/schema";
import type { RepositoryProfile } from "@/lib/profiles/profile-records";
import type { RelationshipMap } from "@/lib/relationships/map-records";
import { asArray, asObject, isJsonObject } from "@/lib/json";
import { chunked } from "@/lib/db/chunked";

/**
 * The projection: indexed rows copied out of immutable Profile and
 * Relationship Map documents, so pages and tools never parse a whole document
 * to answer a question. Rows are written in the document's own transaction.
 * Stored documents may predate parts of the contract, so every reader here
 * tolerates a missing section and projects what the document holds.
 */

/** Bump to change what is projected; the rebuild command then recreates every row. */
export const PROJECTION_VERSION = 3;

/** Rows per INSERT, well under SQLite's bound-parameter limit at 16 columns. */
const CHUNK = 500;

type DependencyRow = typeof dependencyFacts.$inferInsert;
type EvidenceRow = typeof evidenceIndex.$inferInsert;
type NodeRow = typeof graphNodes.$inferInsert;
type EdgeRow = typeof graphEdges.$inferInsert;
type CandidateRow = typeof graphEdgeCandidates.$inferInsert;
/** The columns every map row shares, filled in by `projectMap`. */
type MapColumns = "mapId" | "runId" | "documentDigest" | "projectionVersion";

export function projectProfile(db: Executor, profile: RepositoryProfile, document: JsonObject): void {
  const facts = asObject(document.fact_document);
  const categories = asObject(facts?.categories);
  const common = { profileId: profile.id, documentDigest: profile.digest, projectionVersion: PROJECTION_VERSION };

  const dependencies: DependencyRow[] = [...dependencyRows(categories), ...producedRows(facts)].map((row) => ({ ...common, ...row }));
  for (const chunk of chunked(dependencies, CHUNK)) db.insert(dependencyFacts).values(chunk).run();

  const evidence: EvidenceRow[] = evidenceRows(asObject(facts?.evidence)).map((row) => ({ ...common, ...row }));
  for (const chunk of chunked(evidence, CHUNK)) db.insert(evidenceIndex).values(chunk).run();
}

export function projectMap(db: Executor, map: RelationshipMap, document: JsonObject): void {
  const common = { mapId: map.id, runId: map.runId, documentDigest: map.digest, projectionVersion: PROJECTION_VERSION };
  const nodes: NodeRow[] = nodeRows(db, map, asArray(document.nodes).filter(isJsonObject)).map((row) => ({ ...common, ...row }));
  for (const chunk of chunked(nodes, CHUNK)) db.insert(graphNodes).values(chunk).run();

  const { edges, candidates } = edgeRows(asArray(document.edges).filter(isJsonObject));
  for (const chunk of chunked(edges.map((row): EdgeRow => ({ ...common, ...row })), CHUNK)) db.insert(graphEdges).values(chunk).run();
  for (const chunk of chunked(candidates.map((row): CandidateRow => ({ ...common, ...row })), CHUNK)) db.insert(graphEdgeCandidates).values(chunk).run();
}

/** One row per map node. A repository node names its Run target; an out-of-scope source names its repository when the record has it. */
function nodeRows(db: Executor, map: RelationshipMap, nodes: readonly JsonObject[]): Omit<NodeRow, MapColumns>[] {
  const targets = new Map(
    db
      .select({ id: runTargets.id, publicId: runTargets.publicId, repositoryId: runTargets.repositoryId })
      .from(runTargets)
      .where(eq(runTargets.runId, map.runId))
      .all()
      .map((target) => [target.publicId, target]),
  );
  const outOfScope = nodes.filter((node) => node.kind === "out_of_scope_source").map((node) => stringOf(asObject(node.source)?.public_id)).filter(isString);
  const sources = new Map(
    outOfScope.length === 0
      ? []
      : db
          .select({ id: repositories.id, publicId: repositories.publicId })
          .from(repositories)
          .where(inArray(repositories.publicId, outOfScope))
          .all()
          .map((source) => [source.publicId, source.id]),
  );

  const rows: Omit<NodeRow, MapColumns>[] = [];
  for (const node of nodes) {
    const nodeId = stringOf(node.id);
    const kind = stringOf(node.kind);
    if (!nodeId || !kind) continue;
    const row: Omit<NodeRow, MapColumns> = { nodeId, kind: kind as NodeRow["kind"], label: nodeLabel(node) };
    if (kind === "repository") {
      const targetId = stringOf(node.target);
      const target = targetId ? targets.get(targetId) : undefined;
      if (!target) throw new Error(`Relationship Map ${map.publicId} names repository target ${targetId ?? "(none)"}, which isn't in its Assessment`);
      row.runTargetId = target.id;
      row.repositoryId = target.repositoryId;
    } else if (kind === "out_of_scope_source") {
      row.repositoryId = sources.get(stringOf(asObject(node.source)?.public_id) ?? "") ?? null;
    }
    rows.push(row);
  }
  return rows;
}

/** One row per map edge, and one per candidate node of an ambiguous edge. */
function edgeRows(edges: readonly JsonObject[]): { edges: Omit<EdgeRow, MapColumns>[]; candidates: Omit<CandidateRow, MapColumns>[] } {
  const rows: Omit<EdgeRow, MapColumns>[] = [];
  const candidates: Omit<CandidateRow, MapColumns>[] = [];
  for (const edge of edges) {
    const edgeId = stringOf(edge.id);
    if (!edgeId) continue;
    const reference = asObject(edge.reference);
    const row: Omit<EdgeRow, MapColumns> = {
      edgeId,
      type: stringOf(edge.type) as EdgeRow["type"],
      state: stringOf(edge.state) as EdgeRow["state"],
      fromNode: stringOf(edge.from) ?? "",
      toNode: stringOf(edge.to) ?? null,
      rule: stringOf(edge.rule) ?? "",
      basis: stringOf(edge.basis) ?? "",
      reason: stringOf(edge.reason) ?? null,
      evidence: stringsOf(edge.evidence),
      referenceType: stringOf(reference?.type) ?? "",
      // Documents parse into null-prototype objects, which Drizzle can't bind; a copy can.
      referenceIdentifier: { ...asObject(reference?.identifier) } as Record<string, string>,
    };
    row.kind = edgeKind(row);
    rows.push(row);
    for (const candidate of sortedUnique(stringsOf(edge.candidates))) candidates.push({ edgeId, candidateNode: candidate });
  }
  return { edges: rows, candidates };
}

type ProfileColumns = "profileId" | "documentDigest" | "projectionVersion";

/** One row per package the repository produces, from its producer references, which package focuses read instead of Relationship Maps. */
function producedRows(facts: JsonObject | undefined): Omit<DependencyRow, ProfileColumns>[] {
  return asArray(facts?.relationship_references)
    .filter(isJsonObject)
    .filter((reference) => reference.type === "package" && reference.role === "producer")
    .flatMap((reference) => {
      const identifier = asObject(reference.identifier);
      const name = stringOf(identifier?.name);
      if (!name) return [];
      return [{ kind: "produced" as const, manifest: stringOf(identifier?.manifest) ?? "package.json", packageName: name, field: null, specifier: null, resolvedVersion: stringOf(identifier?.version) ?? null, state: reference.basis === "inferred" ? "inferred" : "observed", evidence: sortedUnique(stringsOf(reference.evidence)) }];
    });
}

/** One row per declared dependency, joined to its resolved version, plus versions a lockfile records without a declaration. */
function dependencyRows(categories: JsonObject | undefined): Omit<DependencyRow, ProfileColumns>[] {
  const resolved = new Map<string, { manifest: string; name: string; version: string | null; state: string; evidence: string[] }>();
  for (const fact of factsOf(categories?.resolved_dependencies)) {
    const value = asObject(fact.value);
    const manifest = stringOf(value?.manifest);
    const name = stringOf(value?.name);
    if (!manifest || !name) continue;
    resolved.set(dependencyKey(manifest, name), { manifest, name, version: stringOf(value?.version) ?? null, state: stringOf(fact.state) ?? "observed", evidence: stringsOf(fact.evidence) });
  }

  const rows: ReturnType<typeof dependencyRows> = [];
  const joined = new Set<string>();
  for (const fact of factsOf(categories?.dependencies)) {
    const value = asObject(fact.value);
    const manifest = stringOf(value?.manifest);
    const name = stringOf(value?.name);
    if (!manifest || !name) continue;
    const key = dependencyKey(manifest, name);
    const version = resolved.get(key);
    if (version) joined.add(key);
    rows.push({
      kind: "dependency",
      manifest,
      packageName: name,
      field: stringOf(value?.field) ?? null,
      specifier: stringOf(value?.specifier) ?? null,
      resolvedVersion: version?.version ?? null,
      state: stringOf(fact.state) ?? "observed",
      evidence: sortedUnique([...stringsOf(fact.evidence), ...(version?.evidence ?? [])]),
    });
  }
  for (const [key, version] of resolved) {
    if (joined.has(key)) continue;
    rows.push({ kind: "dependency", manifest: version.manifest, packageName: version.name, field: null, specifier: null, resolvedVersion: version.version, state: version.state, evidence: sortedUnique(version.evidence) });
  }
  return rows;
}

function evidenceRows(evidence: JsonObject | undefined): Omit<EvidenceRow, ProfileColumns>[] {
  const rows: ReturnType<typeof evidenceRows> = [];
  for (const [evidenceId, value] of Object.entries(evidence ?? {})) {
    const record = asObject(value);
    const location = asObject(record?.location);
    const kind = stringOf(location?.kind);
    const path = stringOf(record?.path);
    if (!record || !path || !kind || !(EVIDENCE_LOCATION_KINDS as readonly string[]).includes(kind)) continue;
    const lines = kind === "lines" && typeof location?.start === "number" && typeof location?.end === "number";
    const pointer = kind === "pointer" ? stringOf(location?.pointer) : undefined;
    if ((kind === "lines" && !lines) || (kind === "pointer" && pointer === undefined)) continue;
    rows.push({
      evidenceId,
      path,
      locationKind: kind as EvidenceRow["locationKind"],
      lineStart: lines ? (location!.start as number) : null,
      lineEnd: lines ? (location!.end as number) : null,
      pointer: pointer ?? null,
      pointerFormat: kind === "pointer" ? (stringOf(location?.format) ?? null) : null,
      detector: stringOf(record.detector) ?? "",
      rule: stringOf(record.rule) ?? "",
    });
  }
  return rows;
}

function nodeLabel(node: JsonObject): string {
  switch (node.kind) {
    case "repository":
    case "out_of_scope_source":
      return stringOf(asObject(node.source)?.name) ?? stringOf(node.id)!;
    case "package":
      return stringOf(node.name) ?? stringOf(node.id)!;
    case "external_service":
      return stringOf(node.key) ?? stringOf(node.id)!;
    case "unresolved_endpoint": {
      const reference = asObject(node.reference);
      const identifier = Object.values(asObject(reference?.identifier) ?? {}).filter(isString);
      return [stringOf(reference?.type), ...identifier].filter(isString).join(" ") || stringOf(node.id)!;
    }
    default:
      return stringOf(node.id)!;
  }
}

/**
 * What an edge means for review. A dependency nobody in the Run produces is
 * third-party; a repository's production of its own package and its
 * relationship to itself are kept out of diagrams; the rest is architecture.
 */
function edgeKind(edge: Pick<EdgeRow, "type" | "rule" | "fromNode" | "toNode">): EdgeKind {
  if (edge.type === "package_dependency" && edge.rule === "package.unresolved") return "third_party";
  if (edge.type === "package_production") return "own_package";
  if (edge.toNode !== null && edge.toNode !== undefined && edge.toNode === edge.fromNode) return "self";
  return "architecture";
}

const dependencyKey = (manifest: string, name: string) => `${manifest}\u0000${name}`;

function factsOf(category: unknown): JsonObject[] {
  return asArray(asObject(category).facts).filter(isJsonObject);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringsOf(value: unknown): string[] {
  return asArray(value).filter(isString);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
