import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb } from "../support/db";
import { seedLargeRun } from "../support/large-run";
import { count } from "../support/projection";

describe("projection at Run scale", () => {
  let db: Db;

  beforeAll(async () => {
    db = createTestDb();
    await seedLargeRun(db, 500);
  }, 120_000);

  it("projects every repository of a 500-repository Run", () => {
    expect(count(db, "graph_nodes", "kind = 'repository'")).toBe(500);
    expect(count(db, "graph_nodes", "kind = 'repository' and repository_source_id is not null")).toBe(500);
    // Every repository depends on react, all but the first on the one before it, and all but the
    // first two on the one at half its index; for repo-002 that's repo-001 again.
    expect(count(db, "dependency_facts")).toBe(500 + 499 + 498 - 1);
  });
});
