import { eq, inArray } from "drizzle-orm";
import type { JsonObject } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import {
  EVIDENCE_LOCATION_KINDS,
  type EdgeKind,
  assessmentTargets,
  dependencyFacts,
  evidenceIndex,
  graphEdgeCandidates,
  graphEdges,
  graphNodes,
  projectionCoverage,
  repositorySources,
} from "@/lib/db/schema";
import type { RepositoryProfile } from "@/lib/profiles/profile-records";
import type { RelationshipMap } from "@/lib/relationships/map-records";

/**
 * The assessment projection: indexed rows copied out of immutable Profile and
 * Relationship Map documents, so pages and tools never parse a whole document
 * to answer a question. Rows are written in the document's own transaction.
 * Stored documents may predate parts of the contract, so every reader here
 * tolerates a missing section and projects what the document holds.
 */

/** Bump to change what is projected; the rebuild command then recreates every row. */
export const PROJECTION_VERSION = 2;

/** Rows per INSERT, well under SQLite's bound-parameter limit at 16 columns. */
const CHUNK = 500;

type DependencyRow = typeof dependencyFacts.$inferInsert;
type EvidenceRow = typeof evidenceIndex.$inferInsert;
type NodeRow = typeof graphNodes.$inferInsert;
type EdgeRow = typeof graphEdges.$inferInsert;
type CandidateRow = typeof graphEdgeCandidates.$inferInsert;
type CoverageRow = typeof projectionCoverage.$inferInsert;

export function projectProfile(db: Executor, profile: RepositoryProfile, document: JsonObject): void {
  const facts = objectOf(document.fact_document);
  const categories = objectOf(facts?.categories);
  const common = {
    profileId: profile.id,
    assessmentId: profile.assessmentId,
    assessmentTargetId: profile.assessmentTargetId,
    documentDigest: profile.digest,
    projectionVersion: PROJECTION_VERSION,
  };

  const dependencies: DependencyRow[] = dependencyRows(categories).map((row) => ({ ...common, ...row }));
  for (const chunk of chunks(dependencies)) db.insert(dependencyFacts).values(chunk).run();

  const evidence: EvidenceRow[] = evidenceRows(objectOf(facts?.evidence)).map((row) => ({ ...common, ...row }));
  for (const chunk of chunks(evidence)) db.insert(evidenceIndex).values(chunk).run();
}

export function projectMap(db: Executor, map: RelationshipMap, document: JsonObject): void {
  const targets = new Map(
    db
      .select({ id: assessmentTargets.id, publicId: assessmentTargets.publicId, repositorySourceId: assessmentTargets.repositorySourceId })
      .from(assessmentTargets)
      .where(eq(assessmentTargets.assessmentId, map.assessmentId))
      .all()
      .map((target) => [target.publicId, target]),
  );
  const nodes = arrayOf(document.nodes).map(objectOf).filter((node): node is JsonObject => node !== undefined);
  const outOfScope = nodes.filter((node) => node.kind === "out_of_scope_source").map((node) => stringOf(objectOf(node.source)?.public_id)).filter(isString);
  const sources = new Map(
    outOfScope.length === 0
      ? []
      : db
          .select({ id: repositorySources.id, publicId: repositorySources.publicId })
          .from(repositorySources)
          .where(inArray(repositorySources.publicId, outOfScope))
          .all()
          .map((source) => [source.publicId, source.id]),
  );
  const common = { mapId: map.id, assessmentId: map.assessmentId, documentDigest: map.digest, projectionVersion: PROJECTION_VERSION };

  const nodeRows: NodeRow[] = [];
  const targetOfNode = new Map<string, number>();
  for (const node of nodes) {
    const nodeId = stringOf(node.id);
    const kind = stringOf(node.kind);
    if (!nodeId || !kind) continue;
    const row: NodeRow = { ...common, nodeId, kind: kind as NodeRow["kind"], label: nodeLabel(node) };
    if (kind === "repository") {
      const targetId = stringOf(node.target);
      const target = targetId ? targets.get(targetId) : undefined;
      if (!target) throw new Error(`Relationship Map ${map.publicId} names repository target ${targetId ?? "(none)"}, which isn't in its Assessment`);
      row.assessmentTargetId = target.id;
      row.repositorySourceId = target.repositorySourceId;
      row.commitSha = stringOf(node.commit) ?? null;
      targetOfNode.set(nodeId, target.id);
    } else if (kind === "out_of_scope_source") {
      row.repositorySourceId = sources.get(stringOf(objectOf(node.source)?.public_id) ?? "") ?? null;
    }
    nodeRows.push(row);
  }
  for (const chunk of chunks(nodeRows)) db.insert(graphNodes).values(chunk).run();

  const edgeRows: EdgeRow[] = [];
  const candidateRows: CandidateRow[] = [];
  for (const edge of arrayOf(document.edges).map(objectOf)) {
    const edgeId = stringOf(edge?.id);
    if (!edge || !edgeId) continue;
    const reference = objectOf(edge.reference);
    const row: EdgeRow = {
      ...common,
      edgeId,
      type: stringOf(edge.type) as EdgeRow["type"],
      state: stringOf(edge.state) as EdgeRow["state"],
      fromNode: stringOf(edge.from) ?? "",
      toNode: stringOf(edge.to) ?? null,
      rule: stringOf(edge.rule) ?? "",
      basis: stringOf(edge.basis) ?? "",
      reason: stringOf(edge.reason) ?? null,
      evidence: JSON.stringify(stringsOf(edge.evidence)),
      referenceType: stringOf(reference?.type) ?? "",
      referenceIdentifier: JSON.stringify(objectOf(reference?.identifier) ?? {}),
    };
    row.kind = edgeKind(row);
    edgeRows.push(row);
    for (const candidate of sortedUnique(stringsOf(edge.candidates))) candidateRows.push({ ...common, edgeId, candidateNode: candidate });
  }
  for (const chunk of chunks(edgeRows)) db.insert(graphEdges).values(chunk).run();
  for (const chunk of chunks(candidateRows)) db.insert(graphEdgeCandidates).values(chunk).run();

  const coverage = objectOf(document.coverage);
  if (!coverage) return;
  const coverageRows: CoverageRow[] = [];
  const covered = new Set<number>();
  for (const contributor of stringsOf(coverage.contributors)) {
    const targetId = targetOfNode.get(contributor);
    if (targetId === undefined || covered.has(targetId)) continue;
    covered.add(targetId);
    coverageRows.push({ assessmentId: map.assessmentId, assessmentTargetId: targetId, state: "contributed", reason: null, projectionVersion: PROJECTION_VERSION });
  }
  for (const gap of arrayOf(coverage.gaps).map(objectOf)) {
    const target = targets.get(stringOf(gap?.target) ?? "");
    const state = stringOf(gap?.state);
    if (!target || (state !== "failed" && state !== "canceled") || covered.has(target.id)) continue;
    covered.add(target.id);
    coverageRows.push({ assessmentId: map.assessmentId, assessmentTargetId: target.id, state, reason: stringOf(gap?.reason) ?? null, projectionVersion: PROJECTION_VERSION });
  }
  for (const chunk of chunks(coverageRows)) db.insert(projectionCoverage).values(chunk).run();
}

/** One row per declared dependency, joined to its resolved version, plus versions a lockfile records without a declaration. */
function dependencyRows(categories: JsonObject | undefined): Omit<DependencyRow, "profileId" | "assessmentId" | "assessmentTargetId" | "documentDigest" | "projectionVersion">[] {
  const resolved = new Map<string, { manifest: string; name: string; version: string | null; state: string; evidence: string[] }>();
  for (const fact of factsOf(categories?.resolved_dependencies)) {
    const value = objectOf(fact.value);
    const manifest = stringOf(value?.manifest);
    const name = stringOf(value?.name);
    if (!manifest || !name) continue;
    resolved.set(dependencyKey(manifest, name), { manifest, name, version: stringOf(value?.version) ?? null, state: stringOf(fact.state) ?? "observed", evidence: stringsOf(fact.evidence) });
  }

  const rows: ReturnType<typeof dependencyRows> = [];
  const joined = new Set<string>();
  for (const fact of factsOf(categories?.dependencies)) {
    const value = objectOf(fact.value);
    const manifest = stringOf(value?.manifest);
    const name = stringOf(value?.name);
    if (!manifest || !name) continue;
    const key = dependencyKey(manifest, name);
    const version = resolved.get(key);
    if (version) joined.add(key);
    rows.push({
      manifest,
      packageName: name,
      field: stringOf(value?.field) ?? null,
      specifier: stringOf(value?.specifier) ?? null,
      resolvedVersion: version?.version ?? null,
      state: stringOf(fact.state) ?? "observed",
      evidence: JSON.stringify(sortedUnique([...stringsOf(fact.evidence), ...(version?.evidence ?? [])])),
    });
  }
  for (const [key, version] of resolved) {
    if (joined.has(key)) continue;
    rows.push({ manifest: version.manifest, packageName: version.name, field: null, specifier: null, resolvedVersion: version.version, state: version.state, evidence: JSON.stringify(sortedUnique(version.evidence)) });
  }
  return rows;
}

function evidenceRows(evidence: JsonObject | undefined): Omit<EvidenceRow, "profileId" | "assessmentId" | "assessmentTargetId" | "documentDigest" | "projectionVersion">[] {
  const rows: ReturnType<typeof evidenceRows> = [];
  for (const [evidenceId, value] of Object.entries(evidence ?? {})) {
    const record = objectOf(value);
    const location = objectOf(record?.location);
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
      contentDigest: stringOf(record.content_digest) ?? "",
    });
  }
  return rows;
}

function nodeLabel(node: JsonObject): string {
  switch (node.kind) {
    case "repository":
    case "out_of_scope_source":
      return stringOf(objectOf(node.source)?.name) ?? stringOf(node.id)!;
    case "package":
      return stringOf(node.name) ?? stringOf(node.id)!;
    case "external_service":
      return stringOf(node.key) ?? stringOf(node.id)!;
    case "unresolved_endpoint": {
      const reference = objectOf(node.reference);
      const identifier = Object.values(objectOf(reference?.identifier) ?? {}).filter(isString);
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
  return arrayOf(objectOf(category)?.facts)
    .map(objectOf)
    .filter((fact): fact is JsonObject => fact !== undefined);
}

function objectOf(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringsOf(value: unknown): string[] {
  return arrayOf(value).filter(isString);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function* chunks<T>(rows: readonly T[]): Generator<T[]> {
  for (let start = 0; start < rows.length; start += CHUNK) yield rows.slice(start, start + CHUNK);
}
