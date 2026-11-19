import { describe, expect, it } from "vitest";
import { createTestDb, migrateToLatest } from "../support/db";
import { migrationFolderAt } from "../support/migrations";

/*
 * Migration 0045 (prune-and-consolidate-code, task 4.3): three columns that
 * nothing reads go, with the trigger that guarded one of them. Rows keep
 * every other value.
 */

const T0 = 1_790_000_000_000;

describe("unread columns migration", () => {
  it("drops the columns and their trigger, and keeps each row's other values", () => {
    const db = createTestDb(migrationFolderAt("0044_salt_patterns_removed"));
    const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
    run("insert into initiatives (public_id, name, selection_mode, created_at, updated_at) values ('ini_fleet00000000000', 'Fleet', 'all', ?, ?)", T0, T0);
    run(
      "insert into assessments (public_id, initiative_id, launch_token, detector_release, configuration, configuration_digest, profile_schema_version, relationship_schema_version, evaluation_releases, created_at, updated_at) select 'asm_0000000000000001', id, '4a6e3b0c-6a43-4e0f-9a59-000000000001', 'r1', '{}', ?, 2, 1, '[]', ?, ? from initiatives where public_id = 'ini_fleet00000000000'",
      "d".repeat(64),
      T0,
      T0,
    );

    migrateToLatest(db);

    const columns = (table: string) => (db.$client.prepare(`select name from pragma_table_info('${table}')`).all() as { name: string }[]).map((column) => column.name);
    expect(columns("assessments")).not.toContain("evaluation_releases");
    expect(columns("evidence_index")).not.toContain("content_digest");
    expect(columns("graph_nodes")).not.toContain("commit_sha");
    expect(db.$client.prepare("select name from sqlite_master where name = 'assessments_evaluation_releases_fixed'").all()).toEqual([]);
    expect(db.$client.prepare("select public_id, detector_release, state from assessments").all()).toEqual([{ public_id: "asm_0000000000000001", detector_release: "r1", state: "queued" }]);
  });
});
