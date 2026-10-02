import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { PROJECTED_EDGE_STATES, PROJECTED_EDGE_TYPES, PROJECTED_NODE_KINDS } from "@/lib/db/schema";
import { EDGE_TYPES, NODE_KINDS, RESOLUTION_STATES } from "@/lib/relationships/schema";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { PROJECTION_TABLES, count, pinnedRepository } from "../support/projection";
import { manifest } from "../support/profiles";
import { seedAssessment } from "../support/scenarios";

const insertRelease = (db: Db) => {
  rawRun(db, "insert into ontology_releases (public_id, number, commit_sha, document, digest, imported_at) values (?, 1, ?, '{}', ?, ?)", "olr_aaaaaaaaaaaaaaaa", "a".repeat(40), "b".repeat(64), Date.now());
  rawRun(db, "insert into ontology_concepts (release_id, concept_key, kind, label, lifecycle, owner, document) values (1, 'portal/access', 'portal', 'Access', 'adopt', 'Access platform team', '{}')");
};

describe("projection schema", () => {
  it("mirrors the Relationship Map's node kinds, edge types, and resolution states", () => {
    expect(PROJECTED_NODE_KINDS).toEqual(NODE_KINDS);
    expect(PROJECTED_EDGE_TYPES).toEqual(EDGE_TYPES);
    expect(PROJECTED_EDGE_STATES).toEqual(RESOLUTION_STATES);
  });
});

describe("ontology releases", () => {
  it("refuses to change or delete an imported release or its concepts", () => {
    const db = createTestDb();
    insertRelease(db);

    expect(() => rawRun(db, "update ontology_releases set number = 2")).toThrow(/never changes/);
    expect(() => rawRun(db, "delete from ontology_releases")).toThrow(/retained/);
    expect(() => rawRun(db, "update ontology_concepts set label = 'Access portal'")).toThrow(/never changes/);
    expect(() => rawRun(db, "delete from ontology_concepts")).toThrow(/retained/);
  });
});

describe("projection rows", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    const sources = ["web", "client", "ui-a", "ui-b", "billing"].map((name) => buildSource(db, { name }));
    const initiative = buildInitiative(db, { sources });
    // Two repositories produce @acme/ui, so web's dependency on it is ambiguous.
    await seedAssessment(db, initiative, sources, [
      pinnedRepository("web", { "@acme/client": "1.0.0", "@acme/ui": "2.0.0", react: "16.14.0" }),
      pinnedRepository("@acme/client", { react: "18.3.1" }),
      { "package.json": manifest({ name: "@acme/ui", version: "2.0.0" }) },
      { "package.json": manifest({ name: "@acme/ui", version: "2.1.0" }) },
      "failed",
    ]);
    insertRelease(db);
    rawRun(db, "insert into concept_classifications (profile_id, assessment_id, release_id, concept_key, state, evidence, document_digest, projection_version) select id, assessment_id, 1, 'portal/access', 'not_applicable', '[]', digest, 1 from repository_profiles limit 1");
  });

  it("refuses updates, and deletes outside a rebuild, in every projection table (Update refused)", () => {
    for (const table of PROJECTION_TABLES) {
      expect(count(db, table), table).toBeGreaterThan(0);
      expect(() => rawRun(db, `update ${table} set projection_version = 2`), table).toThrow(/written once/);
      expect(() => rawRun(db, `delete from ${table}`), table).toThrow(/only by a rebuild/);
    }
    expect(() => rawRun(db, "delete from projection_state")).toThrow(/kept/);
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
