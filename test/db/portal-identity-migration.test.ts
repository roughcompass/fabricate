import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, MIGRATIONS_FOLDER, migrateDatabase, openDatabase } from "@/lib/db/client";
import { createTestDb, rawRun } from "../support/db";

/*
 * Portal platform, slug, and description (add-portal-switcher tasks 1.2 and
 * 1.3): the columns and their checks, one Portal per slug, platform and slug
 * fixed once recorded, and slugs backfilled for Portals onboarded before the
 * migration.
 */

const BEFORE_PORTAL_IDENTITY = "0030_evaluation_releases";

function migrationFolderAt(tag: string): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-portal-identity-migrations-"));
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { idx: number; tag: string }[] };
  const selected = journal.entries.find((entry) => entry.tag === tag);
  if (!selected) throw new Error(`Migration ${tag} does not exist`);
  for (const entry of journal.entries.filter((candidate) => candidate.idx > selected.idx)) fs.rmSync(path.join(folder, `${entry.tag}.sql`), { force: true });
  journal.entries = journal.entries.filter((entry) => entry.idx <= selected.idx);
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}

let nextId = 900;
/** A Portal row as it stood before the migration, with a Draft revision when +onboarded+. */
function insertPortal(db: Db, label: string, onboarded = true): number {
  const id = (nextId += 1);
  const now = Date.now();
  rawRun(db, "insert into portals (id, public_id, label, label_key, created_at) values (?, ?, ?, ?, ?)", id, `ptl_${id}`, label, label.toLowerCase(), now);
  if (onboarded) rawRun(db, "insert into portal_revisions (number, document, created_by, created_at, updated_at, portal_id) values (1, '{}', 'Ana', ?, ?, ?)", now, now, id);
  return id;
}

const slugOf = (db: Db, id: number) => (db.$client.prepare("select slug from portals where id = ?").get(id) as { slug: string | null }).slug;

describe("portal identity columns", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => db.$client.close());

  it("adds platform, slug, and description to portals", () => {
    const columns = (db.$client.prepare("select name from pragma_table_info('portals')").all() as { name: string }[]).map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining(["platform", "slug", "description"]));
  });

  it("keeps a slug to one Portal", () => {
    const first = insertPortal(db, "Markets");
    const second = insertPortal(db, "Other Markets");
    rawRun(db, "update portals set slug = 'markets' where id = ?", first);
    expect(() => rawRun(db, "update portals set slug = 'markets' where id = ?", second)).toThrow(/UNIQUE/);
  });

  it.each(["kiosk", "Web"])("refuses the platform %s", (platform) => {
    const id = insertPortal(db, "Kiosk");
    expect(() => rawRun(db, "update portals set platform = ? where id = ?", platform, id)).toThrow(/CHECK/);
  });

  it.each(["markets2", "my-portal", "Markets", ""])("refuses the slug %j", (slug) => {
    const id = insertPortal(db, "Slugs");
    expect(() => rawRun(db, "update portals set slug = ? where id = ?", slug, id)).toThrow(/CHECK/);
  });

  it("refuses a description over 500 characters", () => {
    const id = insertPortal(db, "Long");
    expect(() => rawRun(db, "update portals set description = ? where id = ?", "x".repeat(501), id)).toThrow(/CHECK/);
  });

  it("fixes the platform and slug once recorded", () => {
    const id = insertPortal(db, "Fixed");
    rawRun(db, "update portals set platform = 'web', slug = 'fixed' where id = ?", id);
    expect(() => rawRun(db, "update portals set platform = 'mobile' where id = ?", id)).toThrow(/keeps its platform and slug/);
    expect(() => rawRun(db, "update portals set slug = 'other' where id = ?", id)).toThrow(/keeps its platform and slug/);
    expect(() => rawRun(db, "update portals set slug = null where id = ?", id)).toThrow(/keeps its platform and slug/);
  });
});

describe("slug backfill", () => {
  let db: Db;
  let migrations: string;
  beforeEach(() => {
    migrations = migrationFolderAt(BEFORE_PORTAL_IDENTITY);
    db = openDatabase(":memory:");
    migrateDatabase(db, migrations);
  });
  afterEach(() => {
    db.$client.close();
    fs.rmSync(migrations, { recursive: true, force: true });
  });

  it("derives slugs for onboarded Portals and leaves collisions, empty derivations, and claim-only Portals unset", () => {
    const access = insertPortal(db, "Access");
    const cafe = insertPortal(db, "Café Desk");
    const markets = insertPortal(db, "Markets");
    const marketsTwo = insertPortal(db, "Markets 2");
    const numbers = insertPortal(db, "2026");
    const claimOnly = insertPortal(db, "Lending", false);

    migrateDatabase(db, MIGRATIONS_FOLDER);

    expect(slugOf(db, access)).toBe("access");
    expect(slugOf(db, cafe)).toBe("cafedesk");
    expect(slugOf(db, markets)).toBeNull();
    expect(slugOf(db, marketsTwo)).toBeNull();
    expect(slugOf(db, numbers)).toBeNull();
    expect(slugOf(db, claimOnly)).toBeNull();
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it("is idempotent", () => {
    const access = insertPortal(db, "Access");
    migrateDatabase(db, MIGRATIONS_FOLDER);
    migrateDatabase(db, MIGRATIONS_FOLDER);
    expect(slugOf(db, access)).toBe("access");
  });
});
