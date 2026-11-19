import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb } from "../support/db";
import { migrationFolderAt } from "../support/migrations";

/*
 * Migration 0050 (establish-frontend-registry, task 4.2): Reference Catalog
 * entries are stored once under a unique digest, and a trigger refuses any
 * change to or deletion of a stored entry.
 */

const DIGEST = "a".repeat(64);
const DOCUMENT = '{"id":"salt","kind":"design_system","version":"1.75.0"}';

describe("catalog_entries migration", () => {
  let db: Db;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const insert = (digest = DIGEST, overrides: Record<string, unknown> = {}) => {
    const row = { kind: "design_system", entry_id: "salt", version: "1.75.0", format_version: 1, digest, document: DOCUMENT, built_at: 1_790_000_000_000, sources: '[{"name":"@salt-ds/core","version":"1.75.0","sections":["components"]}]', packages: '[{"name":"@salt-ds/core","version":"1.75.0"}]', build_job_id: null, created_at: 1_790_000_000_000, ...overrides };
    const columns = Object.keys(row);
    return run(`insert into catalog_entries (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`, ...Object.values(row));
  };

  beforeEach(() => {
    db = createTestDb(migrationFolderAt("0050_catalog_entries"));
  });

  it("stores an entry, and refuses a second entry with its digest", () => {
    insert();
    expect(() => insert()).toThrow(/UNIQUE constraint failed: catalog_entries.digest/);
    insert("b".repeat(64));
    expect(db.$client.prepare("select count(*) as count from catalog_entries").get()).toEqual({ count: 2 });
  });

  it("rejects any update to a stored entry", () => {
    insert();
    expect(() => run("update catalog_entries set document = ? where digest = ?", '{"tampered":true}', DIGEST)).toThrow(/Reference Catalog entries are immutable/);
    expect(() => run("update catalog_entries set version = '1.76.0'")).toThrow(/immutable/);
    expect(db.$client.prepare("select version, document from catalog_entries").get()).toEqual({ version: "1.75.0", document: DOCUMENT });
  });

  it("rejects deleting a stored entry", () => {
    insert();
    expect(() => run("delete from catalog_entries where digest = ?", DIGEST)).toThrow(/retained and cannot be deleted/);
    expect(db.$client.prepare("select count(*) as count from catalog_entries").get()).toEqual({ count: 1 });
  });

  it("checks the kind, digest, document, sources, and packages", () => {
    expect(() => insert("c".repeat(64), { kind: "theme" })).toThrow(/catalog_entries_kind/);
    expect(() => insert("C".repeat(64))).toThrow(/catalog_entries_digest/);
    expect(() => insert("d".repeat(63))).toThrow(/catalog_entries_digest/);
    expect(() => insert("e".repeat(64), { document: "[]" })).toThrow(/catalog_entries_document/);
    expect(() => insert("e".repeat(64), { sources: "{}" })).toThrow(/catalog_entries_sources/);
    expect(() => insert("e".repeat(64), { packages: "[]" })).toThrow(/catalog_entries_packages/);
    expect(() => insert("e".repeat(64), { entry_id: "Salt UI" })).toThrow(/catalog_entries_entry_id/);
    expect(() => insert("e".repeat(64), { build_job_id: 99 })).toThrow(/FOREIGN KEY/);
  });
});
