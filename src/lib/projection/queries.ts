import { and, asc, eq, inArray, ne, or } from "drizzle-orm";
import semver from "semver";
import type { Executor } from "@/lib/db/client";
import { assessmentTargets, dependencyFacts, evidenceIndex, graphEdges, projectionCoverage, repositoryProfiles } from "@/lib/db/schema";

/*
 * Questions answered from the projection alone. None of these reads a stored
 * Profile or Relationship Map document, so each stays cheap at 200 to 500
 * repositories. Each query is also exported unexecuted, so tests can check
 * that SQLite answers it from an index.
 */

/** A target in scope that has no facts in the projection, and why. */
export interface MissingTarget {
  target: string;
  source: string;
  state: "failed" | "canceled";
  reason: string | null;
}

export interface EvidenceLocation {
  evidenceId: string;
  profile: string;
  target: string;
  path: string;
  location: { kind: "lines"; start: number; end: number } | { kind: "pointer"; format: string | null; pointer: string } | { kind: "entry" };
  detector: string;
  rule: string;
  contentDigest: string;
}

export interface ResolvingRepository {
  target: string;
  source: string;
  manifest: string;
  field: string | null;
  specifier: string | null;
  resolvedVersion: string | null;
}

export interface ProjectedEdge {
  edgeId: string;
  type: string;
  state: string;
  from: string;
  to: string | null;
  rule: string;
  basis: string;
  reason: string | null;
  evidence: string[];
}

/** Targets of the Assessment that failed or were canceled, so no answer reads their absence as "no". */
export function missingTargets(db: Executor, assessmentId: number): MissingTarget[] {
  return db
    .select({ target: assessmentTargets.publicId, source: assessmentTargets.sourceName, state: projectionCoverage.state, reason: projectionCoverage.reason })
    .from(projectionCoverage)
    .innerJoin(assessmentTargets, eq(assessmentTargets.id, projectionCoverage.assessmentTargetId))
    .where(and(eq(projectionCoverage.assessmentId, assessmentId), ne(projectionCoverage.state, "contributed")))
    .orderBy(asc(assessmentTargets.position))
    .all() as MissingTarget[];
}

export function evidenceLocationQuery(db: Executor, assessmentId: number, evidenceId: string) {
  return db
    .select({ row: evidenceIndex, profile: repositoryProfiles.publicId, target: assessmentTargets.publicId })
    .from(evidenceIndex)
    .innerJoin(repositoryProfiles, eq(repositoryProfiles.id, evidenceIndex.profileId))
    .innerJoin(assessmentTargets, eq(assessmentTargets.id, evidenceIndex.assessmentTargetId))
    .where(and(eq(evidenceIndex.assessmentId, assessmentId), eq(evidenceIndex.evidenceId, evidenceId)))
    .orderBy(asc(evidenceIndex.profileId))
    .limit(1);
}

/** Where one evidence record of the Assessment points, and which Profile holds it. */
export function evidenceLocation(db: Executor, assessmentId: number, evidenceId: string): EvidenceLocation | undefined {
  const found = evidenceLocationQuery(db, assessmentId, evidenceId).get();
  if (!found) return undefined;
  const { row } = found;
  const location: EvidenceLocation["location"] =
    row.locationKind === "lines"
      ? { kind: "lines", start: row.lineStart!, end: row.lineEnd! }
      : row.locationKind === "pointer"
        ? { kind: "pointer", format: row.pointerFormat, pointer: row.pointer! }
        : { kind: "entry" };
  return { evidenceId: row.evidenceId, profile: found.profile, target: found.target, path: row.path, location, detector: row.detector, rule: row.rule, contentDigest: row.contentDigest };
}

export function resolvingQuery(db: Executor, assessmentId: number, packageName: string) {
  return db
    .select({
      target: assessmentTargets.publicId,
      source: assessmentTargets.sourceName,
      manifest: dependencyFacts.manifest,
      field: dependencyFacts.field,
      specifier: dependencyFacts.specifier,
      resolvedVersion: dependencyFacts.resolvedVersion,
    })
    .from(dependencyFacts)
    .innerJoin(assessmentTargets, eq(assessmentTargets.id, dependencyFacts.assessmentTargetId))
    .where(and(eq(dependencyFacts.assessmentId, assessmentId), eq(dependencyFacts.packageName, packageName)))
    .orderBy(asc(assessmentTargets.position), asc(dependencyFacts.manifest));
}

/**
 * The repositories of an Assessment that declare or resolve a package. With a
 * range, only resolved versions that satisfy it count; a dependency with no
 * resolved version can't be shown to satisfy one, so it's left out.
 */
export function repositoriesResolving(db: Executor, assessmentId: number, packageName: string, range?: string): { repositories: ResolvingRepository[]; missing: MissingTarget[] } {
  const rows = resolvingQuery(db, assessmentId, packageName).all();
  const repositories = range === undefined ? rows : rows.filter((row) => row.resolvedVersion !== null && semver.valid(row.resolvedVersion) !== null && semver.satisfies(row.resolvedVersion, range));
  return { repositories, missing: missingTargets(db, assessmentId) };
}

export interface EdgeFilter {
  direction?: "outgoing" | "incoming" | "both";
  types?: readonly string[];
  states?: readonly string[];
}

export function nodeEdgesQuery(db: Executor, mapId: number, nodeId: string, filter: EdgeFilter = {}) {
  const direction = filter.direction ?? "both";
  const endpoint =
    direction === "outgoing" ? eq(graphEdges.fromNode, nodeId) : direction === "incoming" ? eq(graphEdges.toNode, nodeId) : or(eq(graphEdges.fromNode, nodeId), eq(graphEdges.toNode, nodeId));
  return db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.mapId, mapId),
        endpoint,
        filter.types && filter.types.length > 0 ? inArray(graphEdges.type, filter.types as (typeof graphEdges.$inferSelect.type)[]) : undefined,
        filter.states && filter.states.length > 0 ? inArray(graphEdges.state, filter.states as (typeof graphEdges.$inferSelect.state)[]) : undefined,
      ),
    )
    .orderBy(asc(graphEdges.edgeId));
}

/** A node's edges in a map, by direction, type, and resolution state. */
export function edgesOfNode(db: Executor, mapId: number, nodeId: string, filter: EdgeFilter = {}): ProjectedEdge[] {
  return nodeEdgesQuery(db, mapId, nodeId, filter)
    .all()
    .map((row) => ({
      edgeId: row.edgeId,
      type: row.type,
      state: row.state,
      from: row.fromNode,
      to: row.toNode,
      rule: row.rule,
      basis: row.basis,
      reason: row.reason,
      evidence: JSON.parse(row.evidence) as string[],
    }));
}
