import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assessmentTargets, assessments } from "./assessments";
import { repositorySources } from "./catalog";
import { id, sqlList } from "./columns";
import { ontologyReleases } from "./ontology";
import { relationshipMaps, repositoryProfiles } from "./results";

// These lists mirror the Relationship Map contract in src/lib/relationships/schema.ts.
// Schema modules import nothing outside the schema, so a unit test keeps them equal.
export const PROJECTED_NODE_KINDS = ["repository", "package", "external_service", "out_of_scope_source", "unresolved_endpoint"] as const;
export const PROJECTED_EDGE_TYPES = ["package_dependency", "package_production", "composition", "iframe", "runtime_contract", "service_call"] as const;
export const PROJECTED_EDGE_STATES = ["resolved", "ambiguous", "unresolved", "out_of_scope"] as const;
export const EVIDENCE_LOCATION_KINDS = ["lines", "pointer", "entry"] as const;
export const CLASSIFICATION_STATES = ["observed", "inferred", "unknown", "not_applicable", "not_covered"] as const;
export const COVERAGE_STATES = ["contributed", "failed", "canceled"] as const;
/**
 * What an edge means for review, from projection version 2: a dependency on a
 * package no repository in the Run produces, a repository's production of its
 * own package, a repository's relationship to itself, or architecture.
 */
export const EDGE_KINDS = ["third_party", "own_package", "self", "architecture"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export type ClassificationState = (typeof CLASSIFICATION_STATES)[number];
export type CoverageState = (typeof COVERAGE_STATES)[number];

/*
 * The assessment projection: indexed, write-once copies of what immutable
 * Profile and Relationship Map documents hold. Every row names the document
 * digest and projection version that produced it. Rows are written in the
 * document's own transaction and removed only by a rebuild, which recreates
 * them from the documents.
 */

const digestCheck = (name: string, column: unknown) => check(name, sql`length(${column}) = 64`);
const versionCheck = (name: string, column: unknown) => check(name, sql`${column} > 0`);
const jsonArrayCheck = (name: string, column: unknown) => check(name, sql`json_valid(${column}) AND json_type(${column}) = 'array'`);

/** One declared or resolved direct dependency of one manifest in one Profile. */
export const dependencyFacts = sqliteTable(
  "dependency_facts",
  {
    id: id(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => repositoryProfiles.id, { onDelete: "restrict" }),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    assessmentTargetId: integer("assessment_target_id")
      .notNull()
      .references(() => assessmentTargets.id, { onDelete: "restrict" }),
    manifest: text("manifest").notNull(),
    packageName: text("package_name").notNull(),
    /** The manifest field that declares it, such as dependencies; null when only a lockfile records it. */
    field: text("field"),
    specifier: text("specifier"),
    resolvedVersion: text("resolved_version"),
    state: text("state").notNull(),
    evidence: text("evidence").notNull(),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
  },
  (t) => [
    index("dependency_facts_assessment_package").on(t.assessmentId, t.packageName),
    index("dependency_facts_package_version").on(t.packageName, t.resolvedVersion),
    index("dependency_facts_profile").on(t.profileId),
    check("dependency_facts_package_name", sql`length(${t.packageName}) > 0`),
    jsonArrayCheck("dependency_facts_evidence", t.evidence),
    digestCheck("dependency_facts_document_digest", t.documentDigest),
    versionCheck("dependency_facts_projection_version", t.projectionVersion),
  ],
);

/** One node of a Relationship Map. A repository node names its catalog source and assessment target. */
export const graphNodes = sqliteTable(
  "graph_nodes",
  {
    id: id(),
    mapId: integer("map_id")
      .notNull()
      .references(() => relationshipMaps.id, { onDelete: "restrict" }),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    nodeId: text("node_id").notNull(),
    kind: text("kind", { enum: PROJECTED_NODE_KINDS }).notNull(),
    label: text("label").notNull(),
    repositorySourceId: integer("repository_source_id").references(() => repositorySources.id, { onDelete: "restrict" }),
    assessmentTargetId: integer("assessment_target_id").references(() => assessmentTargets.id, { onDelete: "restrict" }),
    commitSha: text("commit_sha"),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
  },
  (t) => [
    uniqueIndex("graph_nodes_map_node").on(t.mapId, t.nodeId),
    index("graph_nodes_map_kind").on(t.mapId, t.kind),
    index("graph_nodes_repository_source").on(t.repositorySourceId),
    index("graph_nodes_assessment_target").on(t.assessmentTargetId),
    check("graph_nodes_kind", sql.raw(`kind IN (${sqlList(PROJECTED_NODE_KINDS)})`)),
    // A repository node always names the target it was assessed as, and that target's catalog source.
    check("graph_nodes_repository_target", sql`(${t.kind} = 'repository') = (${t.assessmentTargetId} IS NOT NULL)`),
    check("graph_nodes_repository_source", sql`${t.kind} <> 'repository' OR ${t.repositorySourceId} IS NOT NULL`),
    digestCheck("graph_nodes_document_digest", t.documentDigest),
    versionCheck("graph_nodes_projection_version", t.projectionVersion),
  ],
);

/** One edge of a Relationship Map, with its type, resolution state, rule, and evidence. */
export const graphEdges = sqliteTable(
  "graph_edges",
  {
    id: id(),
    mapId: integer("map_id")
      .notNull()
      .references(() => relationshipMaps.id, { onDelete: "restrict" }),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    edgeId: text("edge_id").notNull(),
    type: text("type", { enum: PROJECTED_EDGE_TYPES }).notNull(),
    state: text("state", { enum: PROJECTED_EDGE_STATES }).notNull(),
    fromNode: text("from_node").notNull(),
    toNode: text("to_node"),
    rule: text("rule").notNull(),
    basis: text("basis").notNull(),
    reason: text("reason"),
    evidence: text("evidence").notNull(),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
    // Projection version 2. Rows of version 1 leave these null until a rebuild;
    // a trigger requires them on every row of version 2 or later.
    referenceType: text("reference_type"),
    /** The edge's reference identifier, as a JSON object. */
    referenceIdentifier: text("reference_identifier"),
    kind: text("kind", { enum: EDGE_KINDS }),
  },
  (t) => [
    uniqueIndex("graph_edges_map_edge").on(t.mapId, t.edgeId),
    index("graph_edges_map_from").on(t.mapId, t.fromNode),
    index("graph_edges_map_to").on(t.mapId, t.toNode),
    index("graph_edges_map_type_state").on(t.mapId, t.type, t.state),
    index("graph_edges_map_kind_type").on(t.mapId, t.kind, t.type),
    check("graph_edges_type", sql.raw(`type IN (${sqlList(PROJECTED_EDGE_TYPES)})`)),
    check("graph_edges_state", sql.raw(`state IN (${sqlList(PROJECTED_EDGE_STATES)})`)),
    // Only an ambiguous edge lacks a single endpoint.
    check("graph_edges_to", sql`(${t.toNode} IS NULL) = (${t.state} = 'ambiguous')`),
    jsonArrayCheck("graph_edges_evidence", t.evidence),
    digestCheck("graph_edges_document_digest", t.documentDigest),
    versionCheck("graph_edges_projection_version", t.projectionVersion),
  ],
);

/** One candidate endpoint of an ambiguous edge. */
export const graphEdgeCandidates = sqliteTable(
  "graph_edge_candidates",
  {
    id: id(),
    mapId: integer("map_id")
      .notNull()
      .references(() => relationshipMaps.id, { onDelete: "restrict" }),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    edgeId: text("edge_id").notNull(),
    candidateNode: text("candidate_node").notNull(),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
  },
  (t) => [
    uniqueIndex("graph_edge_candidates_map_edge_node").on(t.mapId, t.edgeId, t.candidateNode),
    index("graph_edge_candidates_map_node").on(t.mapId, t.candidateNode),
    digestCheck("graph_edge_candidates_document_digest", t.documentDigest),
    check("graph_edge_candidates_projection_version", sql`${t.projectionVersion} >= 2`),
  ],
);

/** One evidence record of a Profile, so a location is found without parsing the document. */
export const evidenceIndex = sqliteTable(
  "evidence_index",
  {
    id: id(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => repositoryProfiles.id, { onDelete: "restrict" }),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    assessmentTargetId: integer("assessment_target_id")
      .notNull()
      .references(() => assessmentTargets.id, { onDelete: "restrict" }),
    evidenceId: text("evidence_id").notNull(),
    path: text("path").notNull(),
    locationKind: text("location_kind", { enum: EVIDENCE_LOCATION_KINDS }).notNull(),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    pointer: text("pointer"),
    pointerFormat: text("pointer_format"),
    detector: text("detector").notNull(),
    rule: text("rule").notNull(),
    contentDigest: text("content_digest").notNull(),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
  },
  (t) => [
    uniqueIndex("evidence_index_profile_evidence").on(t.profileId, t.evidenceId),
    index("evidence_index_assessment_evidence").on(t.assessmentId, t.evidenceId),
    check("evidence_index_location_kind", sql.raw(`location_kind IN (${sqlList(EVIDENCE_LOCATION_KINDS)})`)),
    check("evidence_index_lines", sql`(${t.locationKind} = 'lines') = (${t.lineStart} IS NOT NULL AND ${t.lineEnd} IS NOT NULL)`),
    check("evidence_index_pointer", sql`(${t.locationKind} = 'pointer') = (${t.pointer} IS NOT NULL)`),
    digestCheck("evidence_index_document_digest", t.documentDigest),
    versionCheck("evidence_index_projection_version", t.projectionVersion),
  ],
);

/** One concept's classification of one Profile's snapshot under one ontology release. */
export const conceptClassifications = sqliteTable(
  "concept_classifications",
  {
    id: id(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => repositoryProfiles.id, { onDelete: "restrict" }),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    releaseId: integer("release_id")
      .notNull()
      .references(() => ontologyReleases.id, { onDelete: "restrict" }),
    conceptKey: text("concept_key").notNull(),
    state: text("state", { enum: CLASSIFICATION_STATES }).notNull(),
    evidence: text("evidence").notNull(),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
  },
  (t) => [
    uniqueIndex("concept_classifications_profile_concept").on(t.profileId, t.releaseId, t.conceptKey),
    index("concept_classifications_release_concept").on(t.releaseId, t.conceptKey, t.state),
    check("concept_classifications_state", sql.raw(`state IN (${sqlList(CLASSIFICATION_STATES)})`)),
    jsonArrayCheck("concept_classifications_evidence", t.evidence),
    digestCheck("concept_classifications_document_digest", t.documentDigest),
    versionCheck("concept_classifications_projection_version", t.projectionVersion),
  ],
);

/** Which targets of an Assessment contributed to its projection, and which failed or were canceled. */
export const projectionCoverage = sqliteTable(
  "projection_coverage",
  {
    id: id(),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    assessmentTargetId: integer("assessment_target_id")
      .notNull()
      .references(() => assessmentTargets.id, { onDelete: "restrict" }),
    state: text("state", { enum: COVERAGE_STATES }).notNull(),
    reason: text("reason"),
    projectionVersion: integer("projection_version").notNull(),
  },
  (t) => [
    uniqueIndex("projection_coverage_assessment_target").on(t.assessmentId, t.assessmentTargetId),
    check("projection_coverage_state", sql.raw(`state IN (${sqlList(COVERAGE_STATES)})`)),
    versionCheck("projection_coverage_projection_version", t.projectionVersion),
  ],
);

/** A single row that marks a rebuild in progress; only then may projection rows be deleted. */
export const projectionState = sqliteTable(
  "projection_state",
  {
    id: integer("id").primaryKey(),
    rebuilding: integer("rebuilding", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [check("projection_state_single_row", sql`${t.id} = 1`), check("projection_state_rebuilding", sql`${t.rebuilding} IN (0, 1)`)],
);
