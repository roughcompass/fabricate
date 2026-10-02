import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { PROJECTION_VERSION } from "@/lib/projection/project";
import { rebuildProjection } from "@/lib/projection/rebuild";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { manifest } from "../support/profiles";
import { count, projectionRows } from "../support/projection";
import { seedAssessment } from "../support/scenarios";

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

/** The map the e2e suite seeds: resolved, ambiguous, unresolved, and out-of-scope edges, and one coverage gap. */
async function seedMap(db: Db) {
  const names = ["web", "client", "ui-a", "ui-b", "billing"];
  const sources = names.map((name) => buildSource(db, { name }));
  buildSource(db, { name: "legacy-ui" }); // in the catalog, outside the scope
  const initiative = buildInitiative(db, { name: "Fleet assessment", sources });
  return seedAssessment(db, initiative, sources, [
    {
      "package.json": manifest({ name: "web", version: "1.0.0", private: true, dependencies: { "@acme/client": "^1.0.0", "@acme/ui": "^2.0.0", "left-pad": "^1.3.0", "legacy-ui": "^0.1.0" } }),
      "src/payments.ts": 'export const charge = () => fetch("https://payments.invalid/v1/charges", { method: "POST" });\n',
    },
    { "package.json": manifest({ name: "@acme/client", version: "1.0.0" }) },
    { "package.json": manifest({ name: "@acme/ui", version: "2.0.0" }) },
    { "package.json": manifest({ name: "@acme/ui", version: "2.1.0" }) },
    "failed",
  ]);
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
    await seedMap(db);
  });

  it("records each edge's reference and kind", () => {
    const all = edges(db);
    const dependency = (name: string) => all.find((edge) => edge.type === "package_dependency" && JSON.parse(edge.reference_identifier).name === name)!;

    expect(PROJECTION_VERSION).toBe(2);
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

  it("refuses updates to candidates, and deletes outside a rebuild", () => {
    expect(count(db, "graph_edge_candidates")).toBeGreaterThan(0);
    expect(() => rawRun(db, "update graph_edge_candidates set candidate_node = 'x'")).toThrow(/written once/);
    expect(() => rawRun(db, "delete from graph_edge_candidates")).toThrow(/only by a rebuild/);
  });

  it("refuses an edge of version 2 without its reference and kind", () => {
    expect(() => rawRun(db, "insert into graph_edges (map_id, assessment_id, edge_id, type, state, from_node, to_node, rule, basis, evidence, document_digest, projection_version) select map_id, assessment_id, 'edge_x', type, state, from_node, to_node, rule, basis, evidence, document_digest, 2 from graph_edges limit 1")).toThrow(/records its reference and kind/);
  });

  it("rebuilds rows written at version 1 into the same version 2 rows, every time", () => {
    const current = projectionRows(db);
    // Turn the stored edges back into version 1 rows, as the previous release wrote them.
    rawRun(db, "update projection_state set rebuilding = 1");
    rawRun(db, "create temp table version_1 as select * from graph_edges");
    rawRun(db, "delete from graph_edge_candidates");
    rawRun(db, "delete from graph_edges");
    rawRun(
      db,
      `insert into graph_edges (map_id, assessment_id, edge_id, type, state, from_node, to_node, rule, basis, reason, evidence, document_digest, projection_version)
       select map_id, assessment_id, edge_id, type, state, from_node, to_node, rule, basis, reason, evidence, document_digest, 1 from version_1`,
    );
    rawRun(db, "update projection_state set rebuilding = 0");
    expect(count(db, "graph_edges", "projection_version = 1 and kind is null")).toBe(count(db, "graph_edges"));

    rebuildProjection(db);
    const first = projectionRows(db);
    rebuildProjection(db);

    expect(projectionRows(db)).toEqual(first);
    expect(first).toEqual(current);
  });
});
