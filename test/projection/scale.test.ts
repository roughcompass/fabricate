import { beforeAll, describe, expect, it } from "vitest";
import type { Assessment } from "@/lib/assessments/assessment-records";
import type { Db } from "@/lib/db/client";
import { evidenceLocationQuery, nodeEdgesQuery, resolvingQuery } from "@/lib/projection/queries";
import { mapOf } from "@/lib/relationships/map-records";
import { createTestDb } from "../support/db";
import { seedLargeRun } from "../support/large-run";
import { PROJECTION_TABLES, count } from "../support/projection";

interface Plan {
  detail: string;
}

/** SQLite's plan for a query, one line per step. */
function planOf(db: Db, query: { toSQL(): { sql: string; params: unknown[] } }): string[] {
  const { sql, params } = query.toSQL();
  return (db.$client.prepare(`explain query plan ${sql}`).all(...params) as Plan[]).map((step) => step.detail);
}

/** Every step that reads a projection table must search an index, never scan the table. */
function expectIndexed(plan: string[]) {
  const steps = plan.filter((detail) => PROJECTION_TABLES.some((table) => new RegExp(`\\b${table}\\b`).test(detail)));
  expect(steps.length, plan.join("\n")).toBeGreaterThan(0);
  for (const step of steps) expect(step, plan.join("\n")).toMatch(/^SEARCH \w+ USING (COVERING )?INDEX /);
}

describe("projection at Run scale", () => {
  let db: Db;
  let assessment: Assessment;

  beforeAll(async () => {
    db = createTestDb();
    ({ assessment } = await seedLargeRun(db, 500));
  }, 120_000);

  it("projects every repository of a 500-repository Run", () => {
    expect(count(db, "graph_nodes", "kind = 'repository'")).toBe(500);
    expect(count(db, "graph_nodes", "kind = 'repository' and repository_source_id is not null")).toBe(500);
    // Every repository depends on react, all but the first on the one before it, and all but the
    // first two on the one at half its index; for repo-002 that's repo-001 again.
    expect(count(db, "dependency_facts")).toBe(500 + 499 + 498 - 1);
  });

  it("answers each projection query from an index", () => {
    const map = mapOf(db, assessment.id)!;
    const node = (db.$client.prepare("select node_id from graph_nodes where map_id = ? and label = 'repo-250'").get(map.id) as { node_id: string }).node_id;
    const evidence = (db.$client.prepare("select evidence_id from evidence_index limit 1").get() as { evidence_id: string }).evidence_id;

    expectIndexed(planOf(db, resolvingQuery(db, assessment.id, "react")));
    expectIndexed(planOf(db, evidenceLocationQuery(db, assessment.id, evidence)));
    expectIndexed(planOf(db, nodeEdgesQuery(db, map.id, node, { direction: "outgoing" })));
    expectIndexed(planOf(db, nodeEdgesQuery(db, map.id, node, { direction: "incoming", states: ["resolved"] })));
    expectIndexed(planOf(db, nodeEdgesQuery(db, map.id, node, { direction: "both", types: ["package_dependency"] })));
  });
});
