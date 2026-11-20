import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, MIGRATIONS_FOLDER } from "@/lib/db/client";
import { createTestDb, migrateToLatest, rawRun } from "../support/db";
import { EXPORT_ORDERS, commitOf, viewedApplicationIn } from "../support/views";

const DEMO_TABLES = ["demo_comments", "demo_shares", "demo_threads", "demo_workspaces"];
const DEMO_MIGRATIONS = ["0013_demo", "0014_demo_origin", "0015_demo_profiles", "0033_demo_imports_removed", "0037_demo_applications_removed", "0056_comments_and_shares_for_applications"];
const DIGEST = "a".repeat(64);

function tables(db: Db): string[] {
  return (db.$client.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name").all() as { name: string }[]).map((row) => row.name);
}

function count(db: Db, table: string): number {
  return (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
}

// Workspace tables (template-demo/demo-mode spec): owned by an anonymous
// workspace and removed with it. Since add-applications (design decision 7)
// their threads and share links belong to applications, removed with them
// too; nothing else references or is referenced by them.
describe("demo schema", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => db.$client.close());

  const workspace = (key = DIGEST) => {
    rawRun(db, "insert into demo_workspaces (key_digest, created_at, last_seen_at) values (?, 0, 0)", key);
    return (db.$client.prepare("select id from demo_workspaces where key_digest = ?").get(key) as { id: number }).id;
  };
  const thread = (workspaceId: number, publicId = "thr_0000000000000001") => {
    rawRun(
      db,
      "insert into demo_threads (public_id, application_id, view_workspace_id, route, commit_sha, anchor, offset_x, offset_y, created_at) values (?, ?, ?, '/accounts', ?, ?, 0.5, 0.5, 0)",
      publicId,
      viewedApplicationIn(db).id,
      workspaceId,
      commitOf("a"),
      JSON.stringify(EXPORT_ORDERS),
    );
    return (db.$client.prepare("select id from demo_threads where public_id = ?").get(publicId) as { id: number }).id;
  };
  const share = (workspaceId: number, digest = DIGEST, route = "/accounts") =>
    rawRun(db, "insert into demo_shares (token_digest, application_id, view_workspace_id, commit_sha, route, created_at) values (?, ?, ?, ?, ?, 0)", digest, viewedApplicationIn(db).id, workspaceId, commitOf("a"), route);

  it("adds exactly the demo tables on top of the product schema and leaves product tables unchanged", () => {
    // Migrate a copy of drizzle/ without the demo migration to get the product schema alone.
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-registry-migrations-"));
    try {
      fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
      const journalFile = path.join(folder, "meta", "_journal.json");
      const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
      const demo = journal.entries.filter((entry) => DEMO_MIGRATIONS.includes(entry.tag));
      expect(demo.map((entry) => entry.tag)).toEqual(DEMO_MIGRATIONS);
      journal.entries = journal.entries.filter((entry) => !DEMO_MIGRATIONS.includes(entry.tag));
      fs.writeFileSync(journalFile, JSON.stringify(journal));
      for (const tag of DEMO_MIGRATIONS) fs.rmSync(path.join(folder, `${tag}.sql`));

      const product = createTestDb(folder);
      const before = tables(product);
      const schemaOf = (handle: Db) =>
        handle.$client.prepare("select name, sql from sqlite_master where name not like 'demo_%' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name").all();
      const productSchema = schemaOf(product);
      product.$client.close();

      expect(tables(db).filter((table) => !before.includes(table))).toEqual(DEMO_TABLES);
      expect(schemaOf(db)).toEqual(productSchema);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("refers only to workspaces and applications, and no product table refers to a workspace table", () => {
    for (const table of tables(db)) {
      const references = (db.$client.prepare(`pragma foreign_key_list(${table})`).all() as { table: string }[]).map((row) => row.table);
      for (const target of references) {
        if (table.startsWith("demo_")) expect(target.startsWith("demo_") || target === "applications", `${table} -> ${target}`).toBe(true);
        else expect(target.startsWith("demo_"), `${table} -> ${target}`).toBe(false);
      }
    }
  });

  it("puts every thread and share link on an application", () => {
    const owner = workspace();
    expect(() =>
      rawRun(db, "insert into demo_threads (public_id, view_workspace_id, route, commit_sha, anchor, offset_x, offset_y, created_at) values ('thr_0000000000000001', ?, '/', ?, '{}', 0.5, 0.5, 0)", owner, commitOf("a")),
    ).toThrow(/NOT NULL constraint failed: demo_threads.application_id/);
    expect(() => rawRun(db, "insert into demo_shares (token_digest, view_workspace_id, commit_sha, route, created_at) values (?, ?, ?, '/', 0)", DIGEST, owner, commitOf("a"))).toThrow(/NOT NULL constraint failed: demo_shares.application_id/);
    expect(() => thread(owner)).not.toThrow();
  });

  it("removes visitors' deployments (migration 0037), then every template's threads, comments, and share links (migration 0056)", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-registry-migrations-"));
    try {
      fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
      const journalFile = path.join(folder, "meta", "_journal.json");
      // A database from before 0037 has none of it.
      const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { idx: number; tag: string }[] };
      const removal = journal.entries.find((entry) => entry.tag === "0037_demo_applications_removed")!.idx;
      for (const entry of journal.entries.filter((candidate) => candidate.idx >= removal)) fs.rmSync(path.join(folder, `${entry.tag}.sql`));
      journal.entries = journal.entries.filter((entry) => entry.idx < removal);
      fs.writeFileSync(journalFile, JSON.stringify(journal));

      const earlier = createTestDb(folder);
      rawRun(earlier, "insert into demo_workspaces (key_digest, created_at, last_seen_at) values (?, 0, 0)", DIGEST);
      rawRun(earlier, "insert into demo_applications (public_id, workspace_id, template_slug, name, environment, created_at) values ('app_0000000000000001', 1, 'market-watch', 'Desk', 'sandbox', 0)");
      const insertThread = (publicId: string, applicationId: number | null, referenceSlug: string | null) =>
        rawRun(
          earlier,
          "insert into demo_threads (public_id, application_id, reference_slug, view_workspace_id, route, member, member_version, anchor, offset_x, offset_y, created_at) values (?, ?, ?, 1, 'watch', 'watchlist', '1.8.0', 'filter', 0.5, 0.5, 0)",
          publicId,
          applicationId,
          referenceSlug,
        );
      insertThread("thr_0000000000000001", 1, null);
      insertThread("thr_0000000000000002", null, "market-watch");
      rawRun(earlier, "insert into demo_comments (public_id, thread_id, author_name, body, created_at) values ('cmt_0000000000000001', 1, 'Sam', 'On the deployment', 0)");
      rawRun(earlier, "insert into demo_comments (public_id, thread_id, author_name, body, created_at) values ('cmt_0000000000000002', 2, 'Sam', 'On the reference', 0)");
      rawRun(earlier, "insert into demo_shares (token_digest, application_id, view_workspace_id, state, created_at) values (?, 1, 1, '{}', 0)", "a".repeat(64));
      rawRun(earlier, "insert into demo_shares (token_digest, reference_slug, view_workspace_id, state, created_at) values (?, 'market-watch', 1, '{}', 0)", "b".repeat(64));

      migrateToLatest(earlier);
      expect(tables(earlier)).not.toContain("demo_applications");
      expect([count(earlier, "demo_threads"), count(earlier, "demo_comments"), count(earlier, "demo_shares"), count(earlier, "demo_workspaces")]).toEqual([0, 0, 0, 1]);
      earlier.$client.close();
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("removes everything a workspace owns when it is deleted, keeping replies it wrote elsewhere", () => {
    const owner = workspace();
    const visitor = workspace("b".repeat(64));
    const owned = thread(owner);
    rawRun(db, "insert into demo_comments (public_id, thread_id, author_workspace_id, author_name, body, created_at) values ('cmt_0000000000000001', ?, ?, 'Sam', 'Ship v2', 0)", owned, owner);
    share(owner);

    // A visitor's reply on the owner's thread survives the visitor's reset.
    rawRun(db, "insert into demo_comments (public_id, thread_id, author_workspace_id, author_name, body, created_at) values ('cmt_0000000000000002', ?, ?, 'Robin', 'Agreed', 1)", owned, visitor);
    rawRun(db, "delete from demo_workspaces where id = ?", visitor);
    expect(count(db, "demo_comments")).toBe(2);
    expect(db.$client.prepare("select author_workspace_id as author from demo_comments where public_id = 'cmt_0000000000000002'").get()).toEqual({ author: null });

    rawRun(db, "delete from demo_workspaces where id = ?", owner);
    for (const table of DEMO_TABLES) expect(count(db, table), table).toBe(0);
  });

  it("rejects malformed hint state, share routes, and comments", () => {
    const owner = workspace();
    expect(() => rawRun(db, "update demo_workspaces set hints = '[]' where id = ?", owner)).toThrow(/demo_workspaces_hints/);
    expect(() => share(owner, DIGEST, "accounts")).toThrow(/demo_shares_route/);
    const owned = thread(owner);
    expect(() => rawRun(db, "insert into demo_comments (public_id, thread_id, author_name, body, created_at) values ('cmt_0000000000000001', ?, 'Sam', ?, 0)", owned, "x".repeat(2001))).toThrow(
      /demo_comments_body/,
    );
  });
});
