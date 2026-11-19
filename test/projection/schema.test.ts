import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { PROJECTED_EDGE_STATES, PROJECTED_EDGE_TYPES, PROJECTED_NODE_KINDS } from "@/lib/db/schema";
import { EDGE_TYPES, NODE_KINDS, RESOLUTION_STATES } from "@/lib/relationships/schema";
import { buildAssessment, buildRepository } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { PROJECTION_TABLES, count, pinnedRepository } from "../support/projection";
import { manifest } from "../support/profiles";
import { seedRun } from "../support/scenarios";

describe("projection schema", () => {
  it("mirrors the Relationship Map's node kinds, edge types, and resolution states", () => {
    expect(PROJECTED_NODE_KINDS).toEqual(NODE_KINDS);
    expect(PROJECTED_EDGE_TYPES).toEqual(EDGE_TYPES);
    expect(PROJECTED_EDGE_STATES).toEqual(RESOLUTION_STATES);
  });
});

describe("projection rows", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    const repositories = ["web", "client", "ui-a", "ui-b", "billing"].map((name) => buildRepository(db, { name }));
    const assessment = buildAssessment(db, { repositories });
    // Two repositories produce @acme/ui, so web's dependency on it is ambiguous.
    await seedRun(db, assessment, repositories, [
      pinnedRepository("web", { "@acme/client": "1.0.0", "@acme/ui": "2.0.0", react: "16.14.0" }),
      pinnedRepository("@acme/client", { react: "18.3.1" }),
      { "package.json": manifest({ name: "@acme/ui", version: "2.0.0" }) },
      { "package.json": manifest({ name: "@acme/ui", version: "2.1.0" }) },
      "failed",
    ]);
  });

  it("refuses updates in every projection table (Update refused)", () => {
    for (const table of PROJECTION_TABLES) {
      expect(count(db, table), table).toBeGreaterThan(0);
      expect(() => rawRun(db, `update ${table} set projection_version = 2`), table).toThrow(/written once/);
    }
  });

  it("joins every repository node to its catalog entry and assessment target", () => {
    const nodes = db.$client
      .prepare(
        `select node.label, source.name as source, target.source_name as target
         from graph_nodes node
         left join repository_sources source on source.id = node.repository_source_id
         left join assessment_targets target on target.id = node.assessment_target_id
         where node.kind = 'repository' order by node.label`,
      )
      .all();

    expect(nodes).toEqual([
      { label: "client", source: "client", target: "client" },
      { label: "ui-a", source: "ui-a", target: "ui-a" },
      { label: "ui-b", source: "ui-b", target: "ui-b" },
      { label: "web", source: "web", target: "web" },
    ]);
    expect(() => rawRun(db, "insert into graph_nodes (map_id, assessment_id, node_id, kind, label, document_digest, projection_version) select map_id, assessment_id, 'node_x', 'repository', 'x', document_digest, 1 from graph_nodes limit 1")).toThrow(/CHECK constraint failed/);
  });
});
