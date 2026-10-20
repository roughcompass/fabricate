import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Db, MIGRATIONS_FOLDER, migrateDatabase, openDatabase } from "@/lib/db/client";
import { createTestDb, rawRun } from "../support/db";

/*
 * Saved experience versions (add-portal-experience-editor task 1.4): versions
 * are numbered in order per Portal, never changed or deleted, and the history
 * rebuild that admits experience_saved keeps every earlier event and stays
 * append-only.
 */

function migrationFolderAt(tag: string): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-experience-migrations-"));
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { idx: number; tag: string }[] };
  const selected = journal.entries.find((entry) => entry.tag === tag)!;
  for (const entry of journal.entries.filter((candidate) => candidate.idx > selected.idx)) fs.rmSync(path.join(folder, `${entry.tag}.sql`), { force: true });
  journal.entries = journal.entries.filter((entry) => entry.idx <= selected.idx);
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}

const portal = (db: Db, id: number) => {
  rawRun(db, "insert into portals (id, public_id, label, label_key, created_at) values (?, ?, ?, ?, ?)", id, `ptl_${id}`, `Portal ${id}`, `portal ${id}`, Date.now());
  rawRun(db, "insert into onboarding_events (subject, portal_id, event, to_lifecycle, actor, attribution, occurred_at) values ('portal', ?, 'created', 'prototype', 'Ana', 'unverified', ?)", id, Date.now());
};
const version = (db: Db, portalId: number, number: number, publicId = `pxv_${portalId}_${number}`) =>
  rawRun(db, "insert into portal_experience_versions (public_id, portal_id, number, document, change_count, changes, actor, attribution, created_at) values (?, ?, ?, '{}', 1, '[]', 'Ana', 'unverified', ?)", publicId, portalId, number, Date.now());

describe("portal experience versions", () => {
  let db: Db;
  afterEach(() => db.$client.close());

  it("numbers versions 1, 2, 3 per Portal, and refuses a gap or a repeat", () => {
    db = createTestDb();
    portal(db, 1);
    portal(db, 2);
    version(db, 1, 1);
    version(db, 1, 2);
    version(db, 2, 1);
    expect(() => version(db, 1, 4)).toThrow(/numbered in order/);
    expect(() => version(db, 1, 2, "pxv_dup")).toThrow(/numbered in order|UNIQUE/);
  });

  it("never changes or deletes a version, and checks its document and public id", () => {
    db = createTestDb();
    portal(db, 1);
    version(db, 1, 1);
    expect(() => rawRun(db, "update portal_experience_versions set change_count = 2")).toThrow(/never changed/);
    expect(() => rawRun(db, "delete from portal_experience_versions")).toThrow(/cannot be deleted/);
    expect(() => rawRun(db, "insert into portal_experience_versions (public_id, portal_id, number, document, change_count, changes, actor, attribution, created_at) values ('pxv_x', 1, 2, 'not json', 1, '[]', 'Ana', 'unverified', 0)")).toThrow(/CHECK/);
    expect(() => rawRun(db, "insert into portal_experience_versions (public_id, portal_id, number, document, change_count, changes, actor, attribution, created_at) values ('nope', 1, 2, '{}', 1, '[]', 'Ana', 'unverified', 0)")).toThrow(/CHECK/);
  });

  it("accepts experience_saved in the history, which stays append-only", () => {
    db = createTestDb();
    portal(db, 1);
    rawRun(db, "insert into onboarding_events (subject, portal_id, event, detail, actor, attribution, occurred_at) values ('portal', 1, 'experience_saved', 'Saved version 1', 'Ana', 'unverified', ?)", Date.now());
    expect(() => rawRun(db, "update onboarding_events set actor = 'Cy'")).toThrow(/never changed/);
    expect(() => rawRun(db, "delete from onboarding_events")).toThrow(/cannot be deleted/);
  });

  it("keeps every event recorded before the rebuild", () => {
    const before = migrationFolderAt("0034_de_web_initiative");
    db = openDatabase(":memory:");
    migrateDatabase(db, before);
    portal(db, 7);
    rawRun(db, "insert into onboarding_events (subject, portal_id, event, detail, actor, attribution, occurred_at) values ('portal', 7, 'menu_changed', 'Added Payees at /payees', 'Ana', 'unverified', ?)", Date.now());
    migrateDatabase(db, MIGRATIONS_FOLDER);
    expect(db.$client.prepare("select event, detail from onboarding_events where portal_id = 7 order by id").all()).toEqual([
      { event: "created", detail: null },
      { event: "menu_changed", detail: "Added Payees at /payees" },
    ]);
    fs.rmSync(before, { recursive: true, force: true });
  });
});
