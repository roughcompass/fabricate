import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { PROJECTION_VERSION } from "@/lib/projection/project";
import { rebuildProjection } from "@/lib/projection/rebuild";
import { createTestDb, rawRun } from "../support/db";
import { count, projectionRows } from "../support/projection";
import { seedMapStates } from "../support/scenarios";

interface Edge {
  type: string;
  state: string;
  rule: string;
  kind: string;
  reference_type: string;
  reference_identifier: string;
  edge_id: string;
  from_label: string;
  to_label: string | null;
}

const edges = (db: Db): Edge[] =>
  db.$client
    .prepare(
      `select edge.*, origin.label as from_label, target.label as to_label
       from graph_edges edge
       join graph_nodes origin on origin.map_id = edge.map_id and origin.node_id = edge.from_node
       left join graph_nodes target on target.map_id = edge.map_id and target.node_id = edge.to_node`,
    )
    .all() as Edge[];

describe("projection version 2", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedMapStates(db);
  });

  it("records each edge's reference and kind", () => {
    const all = edges(db);
    const dependency = (name: string) => all.find((edge) => edge.type === "package_dependency" && JSON.parse(edge.reference_identifier).name === name)!;

    expect(PROJECTION_VERSION).toBe(3);
    expect(dependency("left-pad")).toMatchObject({ kind: "third_party", state: "unresolved", rule: "package.unresolved", reference_type: "package", to_label: "left-pad" });
    expect(dependency("@acme/client")).toMatchObject({ kind: "architecture", state: "resolved", to_label: "client" });
    expect(dependency("legacy-ui")).toMatchObject({ kind: "architecture", state: "out_of_scope", to_label: "legacy-ui" });
    const productions = all.filter((edge) => edge.type === "package_production");
    expect(productions.length).toBeGreaterThan(0);
    for (const production of productions) expect(production.kind).toBe("own_package");
  });

  it("records an ambiguous edge's candidates", () => {
    const ambiguous = edges(db).find((edge) => edge.state === "ambiguous")!;
    const candidates = db.$client
      .prepare("select node.label from graph_edge_candidates candidate join graph_nodes node on node.map_id = candidate.map_id and node.node_id = candidate.candidate_node where candidate.edge_id = ? order by node.label")
      .all(ambiguous.edge_id);

    expect(JSON.parse(ambiguous.reference_identifier)).toEqual({ name: "@acme/ui" });
    expect(ambiguous.to_label).toBeNull();
    expect(candidates).toEqual([{ label: "ui-a" }, { label: "ui-b" }]);
  });

  it("refuses updates to candidates", () => {
    expect(count(db, "graph_edge_candidates")).toBeGreaterThan(0);
    expect(() => rawRun(db, "update graph_edge_candidates set candidate_node = 'x'")).toThrow(/written once/);
  });

  it("refuses an edge of version 2 without its reference and kind", () => {
    expect(() => rawRun(db, "insert into graph_edges (map_id, assessment_id, edge_id, type, state, from_node, to_node, rule, basis, evidence, document_digest, projection_version) select map_id, assessment_id, 'edge_x', type, state, from_node, to_node, rule, basis, evidence, document_digest, 2 from graph_edges limit 1")).toThrow(/records its reference and kind/);
  });

  it("rebuilds rows written at version 1 into the same version 2 rows, every time", () => {
    const current = projectionRows(db);
    // Turn the stored edges back into version 1 rows, as the previous release wrote them.
    rawRun(db, "create temp table version_1 as select * from graph_edges");
    rawRun(db, "delete from graph_edge_candidates");
    rawRun(db, "delete from graph_edges");
    rawRun(
      db,
      `insert into graph_edges (map_id, assessment_id, edge_id, type, state, from_node, to_node, rule, basis, reason, evidence, document_digest, projection_version)
       select map_id, assessment_id, edge_id, type, state, from_node, to_node, rule, basis, reason, evidence, document_digest, 1 from version_1`,
    );
    expect(count(db, "graph_edges", "projection_version = 1 and kind is null")).toBe(count(db, "graph_edges"));

    rebuildProjection(db);
    const first = projectionRows(db);
    rebuildProjection(db);

    expect(projectionRows(db)).toEqual(first);
    expect(first).toEqual(current);
  });
});
