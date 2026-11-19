import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { runTargets, runs } from "./runs";
import { repositories } from "./repositories";
import { id, sqlList } from "./columns";
import { relationshipMaps, repositoryProfiles } from "./results";

// These lists mirror the Relationship Map contract in src/lib/relationships/schema.ts.
// Schema modules import nothing outside the schema, so a unit test keeps them equal.
export const PROJECTED_NODE_KINDS = ["repository", "package", "external_service", "out_of_scope_source", "unresolved_endpoint"] as const;
export const PROJECTED_EDGE_TYPES = ["package_dependency", "package_production", "composition", "iframe", "runtime_contract", "service_call"] as const;
export const PROJECTED_EDGE_STATES = ["resolved", "ambiguous", "unresolved", "out_of_scope"] as const;
export const EVIDENCE_LOCATION_KINDS = ["lines", "pointer", "entry"] as const;
/**
 * What an edge means for review, from projection version 2: a dependency on a
 * package no repository in the Run produces, a repository's production of its
 * own package, a repository's relationship to itself, or architecture.
 */
export const EDGE_KINDS = ["third_party", "own_package", "self", "architecture"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];


/*
 * The assessment projection: indexed, write-once copies of what immutable
 * Profile and Relationship Map documents hold. Every row names the document
 * digest and projection version that produced it. Rows are written in the
 * document's own transaction and removed only by a rebuild, which recreates
 * them from the documents.
 */

export const DEPENDENCY_FACT_KINDS = ["dependency", "produced"] as const;
export type DependencyFactKind = (typeof DEPENDENCY_FACT_KINDS)[number];

const digestCheck = (name: string, column: unknown) => check(name, sql`length(${column}) = 64`);
const versionCheck = (name: string, column: unknown) => check(name, sql`${column} > 0`);
const jsonArrayCheck = (name: string, column: unknown) => check(name, sql`json_valid(${column}) AND json_type(${column}) = 'array'`);

/** One declared or resolved direct dependency of one manifest in one Profile, or one package the Profile's repository produces. */
export const dependencyFacts = sqliteTable(
  "dependency_facts",
  {
    id: id(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => repositoryProfiles.id, { onDelete: "restrict" }),
    /** `dependency` for a declared or resolved dependency; `produced` for a package the repository publishes, its version in resolvedVersion. */
    kind: text("kind", { enum: DEPENDENCY_FACT_KINDS }).notNull(),
    manifest: text("manifest").notNull(),
    packageName: text("package_name").notNull(),
    /** The manifest field that declares it, such as dependencies; null when only a lockfile records it. */
    field: text("field"),
    specifier: text("specifier"),
    resolvedVersion: text("resolved_version"),
    state: text("state").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
  },
  (t) => [
    index("dependency_facts_profile_package").on(t.profileId, t.packageName),
    index("dependency_facts_kind_package").on(t.kind, t.packageName),
    index("dependency_facts_package_version").on(t.packageName, t.resolvedVersion),
    check("dependency_facts_package_name", sql`length(${t.packageName}) > 0`),
    check("dependency_facts_kind", sql.raw(`kind IN (${sqlList(DEPENDENCY_FACT_KINDS)})`)),
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
    runId: integer("assessment_id")
      .notNull()
      .references(() => runs.id, { onDelete: "restrict" }),
    nodeId: text("node_id").notNull(),
    kind: text("kind", { enum: PROJECTED_NODE_KINDS }).notNull(),
    label: text("label").notNull(),
    repositoryId: integer("repository_source_id").references(() => repositories.id, { onDelete: "restrict" }),
    runTargetId: integer("assessment_target_id").references(() => runTargets.id, { onDelete: "restrict" }),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
  },
  (t) => [
    uniqueIndex("graph_nodes_map_node").on(t.mapId, t.nodeId),
    index("graph_nodes_map_kind").on(t.mapId, t.kind),
    index("graph_nodes_repository_source").on(t.repositoryId),
    index("graph_nodes_assessment_target").on(t.runTargetId),
    check("graph_nodes_kind", sql.raw(`kind IN (${sqlList(PROJECTED_NODE_KINDS)})`)),
    // A repository node always names the target it was assessed as, and that target's catalog source.
    check("graph_nodes_repository_target", sql`(${t.kind} = 'repository') = (${t.runTargetId} IS NOT NULL)`),
    check("graph_nodes_repository_source", sql`${t.kind} <> 'repository' OR ${t.repositoryId} IS NOT NULL`),
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
    runId: integer("assessment_id")
      .notNull()
      .references(() => runs.id, { onDelete: "restrict" }),
    edgeId: text("edge_id").notNull(),
    type: text("type", { enum: PROJECTED_EDGE_TYPES }).notNull(),
    state: text("state", { enum: PROJECTED_EDGE_STATES }).notNull(),
    fromNode: text("from_node").notNull(),
    toNode: text("to_node"),
    rule: text("rule").notNull(),
    basis: text("basis").notNull(),
    reason: text("reason"),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
    // Projection version 2. Rows of version 1 leave these null until a rebuild;
    // a trigger requires them on every row of version 2 or later.
    referenceType: text("reference_type"),
    /** The edge's reference identifier, as a JSON object. */
    referenceIdentifier: text("reference_identifier", { mode: "json" }).$type<Record<string, string>>(),
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
    runId: integer("assessment_id")
      .notNull()
      .references(() => runs.id, { onDelete: "restrict" }),
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
    evidenceId: text("evidence_id").notNull(),
    path: text("path").notNull(),
    locationKind: text("location_kind", { enum: EVIDENCE_LOCATION_KINDS }).notNull(),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    pointer: text("pointer"),
    pointerFormat: text("pointer_format"),
    detector: text("detector").notNull(),
    rule: text("rule").notNull(),
    documentDigest: text("document_digest").notNull(),
    projectionVersion: integer("projection_version").notNull(),
  },
  (t) => [
    uniqueIndex("evidence_index_profile_evidence").on(t.profileId, t.evidenceId),
    check("evidence_index_location_kind", sql.raw(`location_kind IN (${sqlList(EVIDENCE_LOCATION_KINDS)})`)),
    check("evidence_index_lines", sql`(${t.locationKind} = 'lines') = (${t.lineStart} IS NOT NULL AND ${t.lineEnd} IS NOT NULL)`),
    check("evidence_index_pointer", sql`(${t.locationKind} = 'pointer') = (${t.pointer} IS NOT NULL)`),
    digestCheck("evidence_index_document_digest", t.documentDigest),
    versionCheck("evidence_index_projection_version", t.projectionVersion),
  ],
);
