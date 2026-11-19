import { describe, expect, it } from "vitest";
import { createTestDb, migrateToLatest } from "../support/db";
import { migrationFolderAt } from "../support/migrations";

/*
 * Migration 0046 (prune-and-consolidate-code, design decision 11): each
 * Standard's draft moves into its draft columns, keeping its document, lock
 * version, save time, and the Release it revises, and the drafts table goes.
 */

const T0 = 1_790_000_000_000;

describe("standard drafts migration", () => {
  it("copies every draft into its Standard and leaves a Standard without one empty", () => {
    const db = createTestDb(migrationFolderAt("0045_unread_columns_removed"));
    const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
    for (const [index, name] of ["Frontend", "Services", "Security"].entries()) {
      run("insert into standards (public_id, name, purpose, lock_version, created_at, updated_at) values (?, ?, 'Purpose', ?, ?, ?)", `std_${name.toLowerCase().padEnd(16, "0")}`, name, index, T0, T0);
    }
    // Services has a published Release, and its draft revises it; Security has no draft.
    run(
      "insert into standard_releases (public_id, standard_id, version, document_schema_version, document, digest, profile_schema_versions, relationship_schema_versions, draft_lock_version, published_at, created_at) values ('rel_services00000000', 2, 1, 1, '{}', ?, '[1]', '[1]', 3, ?, ?)",
      "e".repeat(64),
      T0,
      T0,
    );
    run("insert into standard_drafts (standard_id, document, lock_version, created_at, updated_at) values (1, '{\"controls\":[]}', 4, ?, ?)", T0, T0 + 1_000);
    run("insert into standard_drafts (standard_id, based_on_release_id, document, lock_version, created_at, updated_at) values (2, 1, '{\"controls\":[{\"key\":\"a\"}]}', 0, ?, ?)", T0, T0 + 2_000);

    migrateToLatest(db);

    expect(db.$client.prepare("select name, lock_version, draft_document, draft_lock_version, draft_saved_at, draft_based_on_release_id from standards order by id").all()).toEqual([
      { name: "Frontend", lock_version: 0, draft_document: '{"controls":[]}', draft_lock_version: 4, draft_saved_at: T0 + 1_000, draft_based_on_release_id: null },
      { name: "Services", lock_version: 1, draft_document: '{"controls":[{"key":"a"}]}', draft_lock_version: 0, draft_saved_at: T0 + 2_000, draft_based_on_release_id: 1 },
      { name: "Security", lock_version: 2, draft_document: null, draft_lock_version: null, draft_saved_at: null, draft_based_on_release_id: null },
    ]);
    expect(db.$client.prepare("select name from sqlite_master where name = 'standard_drafts'").all()).toEqual([]);
    expect(db.$client.prepare("select * from pragma_foreign_key_check").all()).toEqual([]);
    expect(() => run("update standards set public_id = 'std_other00000000000' where id = 1")).toThrow(/public identity/);
  });
});
