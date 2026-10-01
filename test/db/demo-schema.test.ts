import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, MIGRATIONS_FOLDER, migrateDatabase, openDatabase } from "@/lib/db/client";
import { createTestDb, rawRun } from "../support/db";

const DEMO_TABLES = ["demo_applications", "demo_comments", "demo_shares", "demo_threads", "demo_workspaces"];
const DEMO_MIGRATIONS = ["0013_demo", "0014_demo_origin"];
const DIGEST = "a".repeat(64);

function tables(db: Db): string[] {
  return (db.$client.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name").all() as { name: string }[]).map((row) => row.name);
}

function count(db: Db, table: string): number {
  return (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
}

// Template demo tables (design.md, decision 4): separate from product data,
// owned by an anonymous workspace, and removed with it.
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
  const application = (workspaceId: number, fields: { publicId?: string; environment?: string; project?: string | null; repository?: string | null } = {}) => {
    rawRun(
      db,
      "insert into demo_applications (public_id, workspace_id, template_slug, name, environment, bitbucket_project, bitbucket_repository, created_at) values (?, ?, 'market-watch', 'Market watch', ?, ?, ?, 0)",
      fields.publicId ?? "app_0000000000000001",
      workspaceId,
      fields.environment ?? "sandbox",
      fields.project ?? null,
      fields.repository ?? null,
    );
    return (db.$client.prepare("select id from demo_applications where public_id = ?").get(fields.publicId ?? "app_0000000000000001") as { id: number }).id;
  };

  it("adds exactly the demo tables on top of the product schema and leaves product tables unchanged", () => {
    // Migrate a copy of drizzle/ without the demo migration to get the product schema alone.
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-migrations-"));
    try {
      fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
      const journalFile = path.join(folder, "meta", "_journal.json");
      const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
      const demo = journal.entries.filter((entry) => DEMO_MIGRATIONS.includes(entry.tag));
      expect(demo.map((entry) => entry.tag)).toEqual(DEMO_MIGRATIONS);
      journal.entries = journal.entries.filter((entry) => !DEMO_MIGRATIONS.includes(entry.tag));
      fs.writeFileSync(journalFile, JSON.stringify(journal));
      for (const tag of DEMO_MIGRATIONS) fs.rmSync(path.join(folder, `${tag}.sql`));

      const product = openDatabase(":memory:");
      migrateDatabase(product, folder);
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

  it("declares no foreign key from a demo table to a product table, or from a product table to a demo table", () => {
    for (const table of tables(db)) {
      const references = (db.$client.prepare(`pragma foreign_key_list(${table})`).all() as { table: string }[]).map((row) => row.table);
      for (const target of references) expect(table.startsWith("demo_"), `${table} -> ${target}`).toBe(target.startsWith("demo_"));
    }
  });

  it("requires BitBucket details exactly for dev environment applications", () => {
    const owner = workspace();
    expect(() => application(owner, { environment: "dev" })).toThrow(/CHECK constraint failed: demo_applications_bitbucket/);
    expect(() => application(owner, { environment: "sandbox", project: "PAY", repository: "payee-portal" })).toThrow(/demo_applications_bitbucket/);
    expect(() => application(owner, { environment: "dev", project: "PAY", repository: "payee-portal" })).not.toThrow();
  });

  it("records where each application came from, and allows imports only in dev environments", () => {
    const owner = workspace();
    const app = application(owner);
    expect(db.$client.prepare("select origin from demo_applications where id = ?").get(app)).toEqual({ origin: "template" });
    const imported = (environment: string, project: string | null, repository: string | null, origin: string, publicId: string) =>
      rawRun(
        db,
        "insert into demo_applications (public_id, workspace_id, template_slug, name, environment, bitbucket_project, bitbucket_repository, origin, created_at) values (?, ?, 'payments-workspace', 'Payee hub', ?, ?, ?, ?, 0)",
        publicId,
        owner,
        environment,
        project,
        repository,
        origin,
      );
    expect(() => imported("dev", "PAY", "payee-hub", "import", "app_0000000000000002")).not.toThrow();
    expect(() => imported("sandbox", null, null, "import", "app_0000000000000003")).toThrow(/CHECK constraint failed/);
    expect(() => imported("dev", "PAY", "card-controls", "fork", "app_0000000000000004")).toThrow(/CHECK constraint failed/);
  });

  it("marks applications created before the origin migration as coming from templates", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-migrations-"));
    try {
      fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
      const journalFile = path.join(folder, "meta", "_journal.json");
      const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
      journal.entries = journal.entries.filter((entry) => entry.tag !== "0014_demo_origin");
      fs.writeFileSync(journalFile, JSON.stringify(journal));
      fs.rmSync(path.join(folder, "0014_demo_origin.sql"));

      const earlier = openDatabase(":memory:");
      migrateDatabase(earlier, folder);
      rawRun(earlier, "insert into demo_workspaces (key_digest, created_at, last_seen_at) values (?, 0, 0)", DIGEST);
      rawRun(earlier, "insert into demo_applications (public_id, workspace_id, template_slug, name, environment, bitbucket_project, bitbucket_repository, created_at) values ('app_0000000000000001', 1, 'payments-workspace', 'Payee portal', 'dev', 'PAY', 'payee-portal', 0)");
      migrateDatabase(earlier, MIGRATIONS_FOLDER);
      expect(earlier.$client.prepare("select origin from demo_applications").all()).toEqual([{ origin: "template" }]);
      earlier.$client.close();
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("rejects a second dev application for the same repository in one workspace, but not in another", () => {
    const first = workspace();
    const second = workspace("b".repeat(64));
    application(first, { publicId: "app_0000000000000001", environment: "dev", project: "PAY", repository: "payee-portal" });

    expect(() => application(first, { publicId: "app_0000000000000002", environment: "dev", project: "PAY", repository: "payee-portal" })).toThrow(/UNIQUE constraint failed/);
    expect(() => application(second, { publicId: "app_0000000000000003", environment: "dev", project: "PAY", repository: "payee-portal" })).not.toThrow();
  });

  it("targets a thread at exactly one of an application or a reference deployment", () => {
    const owner = workspace();
    const app = application(owner);
    const insert = (applicationId: number | null, referenceSlug: string | null, publicId: string) =>
      rawRun(
        db,
        "insert into demo_threads (public_id, application_id, reference_slug, view_workspace_id, route, member, member_version, anchor, offset_x, offset_y, created_at) values (?, ?, ?, ?, 'watch', 'watchlist', '1.8.0', 'filter', 0.5, 0.5, 0)",
        publicId,
        applicationId,
        referenceSlug,
        owner,
      );

    expect(() => insert(null, null, "thr_0000000000000001")).toThrow(/demo_threads_target/);
    expect(() => insert(app, "market-watch", "thr_0000000000000002")).toThrow(/demo_threads_target/);
    expect(() => insert(app, null, "thr_0000000000000003")).not.toThrow();
    expect(() => insert(null, "market-watch", "thr_0000000000000004")).not.toThrow();
  });

  it("removes everything a workspace owns when it is deleted, keeping replies it wrote elsewhere", () => {
    const owner = workspace();
    const visitor = workspace("b".repeat(64));
    const app = application(owner);
    rawRun(
      db,
      "insert into demo_threads (public_id, application_id, view_workspace_id, route, member, member_version, anchor, offset_x, offset_y, created_at) values ('thr_0000000000000001', ?, ?, 'watch', 'watchlist', '1.8.0', 'filter', 0.5, 0.5, 0)",
      app,
      owner,
    );
    const thread = (db.$client.prepare("select id from demo_threads").get() as { id: number }).id;
    rawRun(db, "insert into demo_comments (public_id, thread_id, author_workspace_id, author_name, body, created_at) values ('cmt_0000000000000001', ?, ?, 'Sam', 'Ship v2', 0)", thread, owner);
    rawRun(db, "insert into demo_shares (token_digest, application_id, view_workspace_id, state, created_at) values (?, ?, ?, '{}', 0)", DIGEST, app, owner);

    // A visitor's reply on the owner's thread survives the visitor's reset.
    rawRun(db, "insert into demo_comments (public_id, thread_id, author_workspace_id, author_name, body, created_at) values ('cmt_0000000000000002', ?, ?, 'Robin', 'Agreed', 1)", thread, visitor);
    rawRun(db, "delete from demo_workspaces where id = ?", visitor);
    expect(count(db, "demo_comments")).toBe(2);
    expect(db.$client.prepare("select author_workspace_id as author from demo_comments where public_id = 'cmt_0000000000000002'").get()).toEqual({ author: null });

    rawRun(db, "delete from demo_workspaces where id = ?", owner);
    for (const table of DEMO_TABLES) expect(count(db, table), table).toBe(0);
  });

  it("rejects malformed hint state, share state, and comments", () => {
    const owner = workspace();
    expect(() => rawRun(db, "update demo_workspaces set hints = '[]' where id = ?", owner)).toThrow(/demo_workspaces_hints/);
    expect(() => rawRun(db, "insert into demo_shares (token_digest, reference_slug, view_workspace_id, state, created_at) values (?, 'market-watch', ?, 'nope', 0)", DIGEST, owner)).toThrow(
      /demo_shares_state/,
    );
    const app = application(owner);
    rawRun(
      db,
      "insert into demo_threads (public_id, application_id, view_workspace_id, route, member, member_version, anchor, offset_x, offset_y, created_at) values ('thr_0000000000000001', ?, ?, 'watch', 'watchlist', '1.8.0', 'filter', 0.5, 0.5, 0)",
      app,
      owner,
    );
    const thread = (db.$client.prepare("select id from demo_threads").get() as { id: number }).id;
    expect(() => rawRun(db, "insert into demo_comments (public_id, thread_id, author_name, body, created_at) values ('cmt_0000000000000001', ?, 'Sam', ?, 0)", thread, "x".repeat(2001))).toThrow(
      /demo_comments_body/,
    );
  });
});
