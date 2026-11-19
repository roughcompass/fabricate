import { and, asc, eq, inArray } from "drizzle-orm";
import type { JsonObject } from "@repo-facts/contract";
import type { Run } from "@/lib/runs/run-records";
import type { Executor } from "@/lib/db/client";
import { runTargets, evidenceIndex, graphEdgeCandidates, graphEdges, graphNodes, relationshipMaps, repositoryProfiles, type EdgeKind } from "@/lib/db/schema";
import { type MissingTarget, missingTargets } from "@/lib/projection/queries";
import type { DiagramEdge } from "./diagram";
import type { RelationshipMap } from "./map-records";
import { type RuntimeLink, type RuntimeSystem, compare, runtimeSystems } from "./placement";
import type { RepositoryRelationship } from "./rollup";
import { routes } from "@/lib/web/routes";
import { chunked } from "@/lib/db/chunked";
import { runProfileIds } from "@/lib/profiles/evidence-owners";

/*
 * Everything a Relationship Map view needs, read from the assessment
 * projection. No view reads the map document: a map of 500 repositories is a
 * handful of indexed queries.
 */

export interface ViewRepository {
  nodeId: string;
  label: string;
  /** The assessment target's public ID. */
  target: string;
  /** The target's Profile, when one exists. */
  profile: string | null;
  sourceId: number;
  /** The ID of the runtime system the repository belongs to. */
  system: string;
}

export interface MapView {
  run: Run;
  map: RelationshipMap;
  base: string;
  repositories: Map<string, ViewRepository>;
  /** The Run's runtime systems by ID, each repository in exactly one. */
  systems: Map<string, RuntimeSystem>;
  missing: MissingTarget[];
}

/** The map record of an Assessment, without its document. */
function mapRecordOf(db: Executor, runId: number): RelationshipMap | undefined {
  return db.select().from(relationshipMaps).where(eq(relationshipMaps.runId, runId)).get();
}

export function loadMapView(db: Executor, run: Run): MapView | undefined {
  const map = mapRecordOf(db, run.id);
  if (!map) return undefined;

  const nodes = db
    .select({ nodeId: graphNodes.nodeId, label: graphNodes.label, sourceId: graphNodes.repositorySourceId, target: runTargets.publicId, profile: repositoryProfiles.publicId })
    .from(graphNodes)
    .innerJoin(runTargets, eq(runTargets.id, graphNodes.runTargetId))
    // A completed target's Profile is its survey's.
    .leftJoin(repositoryProfiles, and(eq(repositoryProfiles.surveyId, runTargets.surveyId), eq(runTargets.state, "complete")))
    .where(and(eq(graphNodes.mapId, map.id), eq(graphNodes.kind, "repository")))
    .orderBy(asc(graphNodes.label))
    .all();
  const linked = new Map(nodes.map((node) => [node.nodeId, node]));
  const systems = runtimeSystems(
    nodes.map((node) => ({ nodeId: node.nodeId, label: node.label })),
    runtimeLinks(db, map.id, linked),
  );
  const systemOf = new Map(systems.flatMap((system) => system.members.map((member) => [member, system.id] as const)));
  const repositories = new Map<string, ViewRepository>(
    nodes.map((node) => [node.nodeId, { nodeId: node.nodeId, label: node.label, target: node.target, profile: node.profile, sourceId: node.sourceId!, system: systemOf.get(node.nodeId)! }]),
  );

  return { run, map, base: routes.runMap(run.publicId), repositories, systems: new Map(systems.map((system) => [system.id, system])), missing: missingTargets(db, run.id) };
}

/** Composition, iframe, and runtime-contract links between repositories, which tie them into runtime systems. */
function runtimeLinks(db: Executor, mapId: number, repositories: ReadonlyMap<string, unknown>): RuntimeLink[] {
  return db
    .select({ from: graphEdges.fromNode, to: graphEdges.toNode, type: graphEdges.type })
    .from(graphEdges)
    .where(and(eq(graphEdges.mapId, mapId), eq(graphEdges.kind, "architecture"), inArray(graphEdges.type, ["composition", "iframe", "runtime_contract"]), eq(graphEdges.state, "resolved")))
    .all()
    .filter((edge) => edge.to !== null && repositories.has(edge.from) && repositories.has(edge.to))
    .map((edge) => ({ from: edge.from, to: edge.to!, type: edge.type as RuntimeLink["type"] }));
}

/** Resolved architecture relationships between repositories of the Run: what rolls up into groups. */
export function repositoryRelationships(db: Executor, view: MapView): RepositoryRelationship[] {
  return db
    .select({ edgeId: graphEdges.edgeId, from: graphEdges.fromNode, to: graphEdges.toNode })
    .from(graphEdges)
    .where(and(eq(graphEdges.mapId, view.map.id), eq(graphEdges.kind, "architecture"), eq(graphEdges.state, "resolved")))
    .all()
    .filter((edge) => edge.to !== null && view.repositories.has(edge.from) && view.repositories.has(edge.to))
    .map((edge) => ({ edgeId: edge.edgeId, from: edge.from, to: edge.to! }));
}

type EdgeRow = typeof graphEdges.$inferSelect;

/** Every edge that leaves one of +nodes+, with its candidates, as diagrams read them. */
export function edgesFrom(db: Executor, view: MapView, nodes: readonly string[]): DiagramEdge[] {
  if (nodes.length === 0) return [];
  const rows: EdgeRow[] = [];
  for (const chunk of chunked([...new Set(nodes)])) rows.push(...db.select().from(graphEdges).where(and(eq(graphEdges.mapId, view.map.id), inArray(graphEdges.fromNode, chunk))).all());
  return withCandidates(db, view, rows);
}

/** Every edge whose endpoint is one of +nodes+. */
export function edgesInto(db: Executor, view: MapView, nodes: readonly string[]): DiagramEdge[] {
  if (nodes.length === 0) return [];
  const rows: EdgeRow[] = [];
  for (const chunk of chunked([...new Set(nodes)])) rows.push(...db.select().from(graphEdges).where(and(eq(graphEdges.mapId, view.map.id), inArray(graphEdges.toNode, chunk))).all());
  return withCandidates(db, view, rows);
}

/** The edges with the given IDs. */
export function edgesByIds(db: Executor, view: MapView, ids: readonly string[]): DiagramEdge[] {
  const rows: EdgeRow[] = [];
  for (const chunk of chunked([...new Set(ids)])) rows.push(...db.select().from(graphEdges).where(and(eq(graphEdges.mapId, view.map.id), inArray(graphEdges.edgeId, chunk))).all());
  return withCandidates(db, view, rows);
}

function withCandidates(db: Executor, view: MapView, rows: readonly EdgeRow[]): DiagramEdge[] {
  const ambiguous = rows.filter((row) => row.state === "ambiguous").map((row) => row.edgeId);
  const candidates = new Map<string, string[]>();
  for (const chunk of chunked(ambiguous)) {
    for (const row of db.select().from(graphEdgeCandidates).where(and(eq(graphEdgeCandidates.mapId, view.map.id), inArray(graphEdgeCandidates.edgeId, chunk))).all()) {
      candidates.set(row.edgeId, [...(candidates.get(row.edgeId) ?? []), row.candidateNode]);
    }
  }
  return rows.map((row) => ({
    edgeId: row.edgeId,
    from: row.fromNode,
    to: row.toNode,
    type: row.type,
    state: row.state,
    rule: row.rule,
    basis: row.basis,
    reason: row.reason,
    evidence: row.evidence,
    kind: (row.kind ?? "architecture") as EdgeKind,
    referenceIdentifier: row.referenceIdentifier ?? {},
    candidates: (candidates.get(row.edgeId) ?? []).sort(compare),
  }));
}

export interface NodeSummary {
  nodeId: string;
  kind: string;
  label: string;
}

/** The labels and kinds of +nodes+ in the map. */
export function nodesOf(db: Executor, view: MapView, nodes: readonly string[]): Map<string, NodeSummary> {
  const result = new Map<string, NodeSummary>();
  for (const chunk of chunked([...new Set(nodes)])) {
    for (const row of db.select({ nodeId: graphNodes.nodeId, kind: graphNodes.kind, label: graphNodes.label }).from(graphNodes).where(and(eq(graphNodes.mapId, view.map.id), inArray(graphNodes.nodeId, chunk))).all()) result.set(row.nodeId, row);
  }
  return result;
}

/** Evidence records for +ids+, shaped as the evidence list reads them, from the evidence index. */
export function evidenceRecords(db: Executor, runId: number, ids: readonly string[]): JsonObject {
  const records: Record<string, JsonObject> = {};
  for (const chunk of chunked([...new Set(ids)])) {
    for (const row of db.select().from(evidenceIndex).where(and(inArray(evidenceIndex.profileId, runProfileIds(db, runId)), inArray(evidenceIndex.evidenceId, chunk))).all()) {
      if (records[row.evidenceId]) continue;
      const location: JsonObject =
        row.locationKind === "lines" ? { kind: "lines", start: row.lineStart!, end: row.lineEnd! } : row.locationKind === "pointer" ? { kind: "pointer", format: row.pointerFormat, pointer: row.pointer! } : { kind: "entry" };
      records[row.evidenceId] = { path: row.path, location, detector: row.detector, rule: row.rule };
    }
  }
  return records as JsonObject;
}

