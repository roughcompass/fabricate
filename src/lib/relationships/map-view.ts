import { and, asc, eq, inArray } from "drizzle-orm";
import type { JsonObject } from "@repo-facts/contract";
import type { Assessment } from "@/lib/assessments/assessment-records";
import type { Executor } from "@/lib/db/client";
import { assessmentTargets, evidenceIndex, graphEdgeCandidates, graphEdges, graphNodes, relationshipMaps, repositoryProfiles, type EdgeKind } from "@/lib/db/schema";
import { type RepositoryOwnership, ownershipForAssessment, portalOwnership } from "@/lib/ownership/read";
import { type MissingTarget, missingTargets } from "@/lib/projection/queries";
import type { DiagramEdge } from "./diagram";
import type { RelationshipMap } from "./map-records";
import { type Placements, type RuntimeLink, compare, placeRepositories } from "./placement";
import type { Labels, RepositoryRelationship } from "./rollup";

/*
 * Everything a Relationship Map view needs, read from the assessment
 * projection and current ownership. No view reads the map document: a map
 * of 500 repositories is a handful of indexed queries.
 */

export interface ViewRepository {
  nodeId: string;
  label: string;
  /** The assessment target's public ID. */
  target: string;
  /** The target's Profile, when one exists. */
  profile: string | null;
  sourceId: number;
  ownership: RepositoryOwnership | undefined;
  /** The SEAL application's public ID, or null when the repository has no claim. */
  application: string | null;
  lineOfBusiness: string | null;
  portals: string[];
}

export interface ViewApplication {
  id: string;
  sealId: string;
  name: string | null;
  lineOfBusiness: string | null;
}

export interface ViewPortal {
  id: string;
  label: string;
  /** The approved ontology concept, or null while the portal is pending review. */
  conceptKey: string | null;
  /** Its owner's Line of Business. */
  lineOfBusiness: string | null;
  owner: ViewApplication | null;
  /** The host repository's node, when the host is claimed and in this Run. */
  host: string | null;
  /** The host repository's name when one is claimed, in this Run or not. */
  hostName: string | null;
}

export interface MapView {
  assessment: Assessment;
  map: RelationshipMap;
  base: string;
  repositories: Map<string, ViewRepository>;
  applications: Map<string, ViewApplication>;
  portals: Map<string, ViewPortal>;
  linesOfBusiness: Map<string, string>;
  placements: Placements;
  labels: Labels;
  /** The latest time any ownership in effect was stated, or null when nothing is claimed. */
  asOf: Date | null;
  missing: MissingTarget[];
}

/** The Relationship Map address focused on a target's repository, or null while the Run has no map. */
export function repositoryFocusHref(db: Executor, assessment: Pick<Assessment, "publicId">, targetId: number): string | null {
  const node = db.select({ nodeId: graphNodes.nodeId }).from(graphNodes).where(and(eq(graphNodes.assessmentTargetId, targetId), eq(graphNodes.kind, "repository"))).get();
  return node ? `/runs/${assessment.publicId}/map?${new URLSearchParams({ focus: node.nodeId })}` : null;
}

/** The map record of an Assessment, without its document. */
export function mapRecordOf(db: Executor, assessmentId: number): RelationshipMap | undefined {
  return db.select().from(relationshipMaps).where(eq(relationshipMaps.assessmentId, assessmentId)).get();
}

export function loadMapView(db: Executor, assessment: Assessment): MapView | undefined {
  const map = mapRecordOf(db, assessment.id);
  if (!map) return undefined;

  const nodes = db
    .select({ nodeId: graphNodes.nodeId, label: graphNodes.label, sourceId: graphNodes.repositorySourceId, targetId: graphNodes.assessmentTargetId, target: assessmentTargets.publicId, profile: repositoryProfiles.publicId })
    .from(graphNodes)
    .innerJoin(assessmentTargets, eq(assessmentTargets.id, graphNodes.assessmentTargetId))
    .leftJoin(repositoryProfiles, eq(repositoryProfiles.assessmentTargetId, graphNodes.assessmentTargetId))
    .where(and(eq(graphNodes.mapId, map.id), eq(graphNodes.kind, "repository")))
    .orderBy(asc(graphNodes.label))
    .all();
  const { byTarget, asOf } = ownershipForAssessment(db, assessment.id);

  const applications = new Map<string, ViewApplication>();
  const linesOfBusiness = new Map<string, string>();
  const portalIds = new Set<number>();
  const repositories = new Map<string, ViewRepository>();
  for (const node of nodes) {
    const ownership = byTarget.get(node.targetId!);
    const application = ownership?.application.value ?? null;
    const lineOfBusiness = ownership?.lineOfBusiness.value ?? null;
    if (application) applications.set(application.publicId, { id: application.publicId, sealId: application.sealId, name: application.name, lineOfBusiness: lineOfBusiness?.publicId ?? null });
    if (lineOfBusiness) linesOfBusiness.set(lineOfBusiness.publicId, lineOfBusiness.label);
    const portals = (ownership?.portals ?? []).filter((item) => !item.flagged).map((item) => item.portal);
    for (const portal of [...portals, ...(ownership?.hosts ?? [])]) portalIds.add(portal.id);
    repositories.set(node.nodeId, {
      nodeId: node.nodeId,
      label: node.label,
      target: node.target,
      profile: node.profile,
      sourceId: node.sourceId!,
      ownership,
      application: application?.publicId ?? null,
      lineOfBusiness: lineOfBusiness?.publicId ?? null,
      portals: portals.map((portal) => portal.publicId),
    });
  }

  const nodeOfSource = new Map([...repositories.values()].map((repository) => [repository.sourceId, repository.nodeId]));
  const portals = new Map<string, ViewPortal>();
  for (const ownership of portalOwnership(db, [...portalIds]).values()) {
    const owner = ownership.owner.value;
    const lineOfBusiness = ownership.lineOfBusiness.value;
    if (lineOfBusiness) linesOfBusiness.set(lineOfBusiness.publicId, lineOfBusiness.label);
    portals.set(ownership.portal.publicId, {
      id: ownership.portal.publicId,
      label: ownership.portal.label,
      conceptKey: ownership.portal.conceptKey,
      lineOfBusiness: lineOfBusiness?.publicId ?? null,
      owner: owner ? { id: owner.publicId, sealId: owner.sealId, name: owner.name, lineOfBusiness: lineOfBusiness?.publicId ?? null } : null,
      host: ownership.host.value ? (nodeOfSource.get(ownership.host.value.id) ?? null) : null,
      hostName: ownership.host.value?.name ?? null,
    });
  }

  const placements = placeRepositories(
    [...repositories.values()].map((repository) => ({ nodeId: repository.nodeId, label: repository.label, application: repository.application, lineOfBusiness: repository.lineOfBusiness, portals: repository.portals })),
    [...portals.values()].map((portal) => ({ id: portal.id, lineOfBusiness: portal.lineOfBusiness, host: portal.host })),
    runtimeLinks(db, map.id, repositories),
  );
  const systems = new Map(placements.systems.map((system) => [system.id, system.name]));
  const labels: Labels = {
    lineOfBusiness: (id) => (id === null ? "No Line of Business" : (linesOfBusiness.get(id) ?? id)),
    portal: (id) => portals.get(id)?.label ?? id,
    application: (id) => applicationLabel(applications.get(id)) ?? id,
    system: (id) => systems.get(id) ?? id,
  };

  return { assessment, map, base: `/runs/${assessment.publicId}/map`, repositories, applications, portals, linesOfBusiness, placements, labels, asOf, missing: missingTargets(db, assessment.id) };
}

export function applicationLabel(application: Pick<ViewApplication, "sealId" | "name"> | undefined): string | undefined {
  if (!application) return undefined;
  return application.name ? `${application.name} (${application.sealId})` : application.sealId;
}

/** Composition, iframe, and runtime-contract links between repositories, which tie unclaimed ones into runtime systems. */
function runtimeLinks(db: Executor, mapId: number, repositories: ReadonlyMap<string, ViewRepository>): RuntimeLink[] {
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
    evidence: JSON.parse(row.evidence) as string[],
    kind: (row.kind ?? "architecture") as EdgeKind,
    referenceIdentifier: JSON.parse(row.referenceIdentifier ?? "{}") as Record<string, string>,
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
export function evidenceRecords(db: Executor, assessmentId: number, ids: readonly string[]): JsonObject {
  const records: Record<string, JsonObject> = {};
  for (const chunk of chunked([...new Set(ids)])) {
    for (const row of db.select().from(evidenceIndex).where(and(eq(evidenceIndex.assessmentId, assessmentId), inArray(evidenceIndex.evidenceId, chunk))).all()) {
      if (records[row.evidenceId]) continue;
      const location: JsonObject =
        row.locationKind === "lines" ? { kind: "lines", start: row.lineStart!, end: row.lineEnd! } : row.locationKind === "pointer" ? { kind: "pointer", format: row.pointerFormat, pointer: row.pointer! } : { kind: "entry" };
      records[row.evidenceId] = { path: row.path, location, detector: row.detector, rule: row.rule };
    }
  }
  return records as JsonObject;
}

function chunked<T>(values: readonly T[], size = 500): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) chunks.push(values.slice(start, start + size));
  return chunks;
}
