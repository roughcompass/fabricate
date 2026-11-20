import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";
import { EXPORT_ORDERS, commitOf, viewedApplicationIn } from "../support/views";

/*
 * Migration 0056 (add-applications, design decision 7, and the migration
 * plan): comment threads and share links belong to applications. A thread
 * records the route, the commit, and the element's anchor; a share link the
 * commit and the route. The template demo's threads, comments, share links,
 * and session profiles go, and workspaces stay with their names and hints.
 */

const T0 = 1_795_000_000_000;

describe("comments and shares for applications migration", () => {
  let db: Db;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const all = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).all(...values);
  const count = (table: string) => (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  const columns = (table: string) => (all(`select name from pragma_table_info('${table}')`) as { name: string }[]).map((column) => column.name);
  const tables = () => (all("select name from sqlite_master where type = 'table' and name like 'demo_%' order by name") as { name: string }[]).map((row) => row.name);

  beforeEach(() => {
    db = createTestDb(migrationFolderAt("0055_enrollments_and_build_history"));
    // A workspace with a name and hints, its thread and comment on a template, its share link, and its session profile.
    run("insert into demo_workspaces (key_digest, display_name, hints, created_at, last_seen_at) values (?, 'Sam Rivera', '{\"off\":true}', ?, ?)", "a".repeat(64), T0, T0);
    run("insert into demo_threads (public_id, reference_slug, view_workspace_id, route, member, member_version, anchor, offset_x, offset_y, created_at) values ('thr_0000000000000001', 'payments-workspace', 1, 'payees', 'payee-list', '1.4.2', 'pay-lumen', 0.5, 0.5, ?)", T0);
    run("insert into demo_comments (public_id, thread_id, author_workspace_id, author_name, body, created_at) values ('cmt_0000000000000001', 1, 1, 'Sam Rivera', 'Make this primary', ?)", T0);
    run("insert into demo_shares (token_digest, reference_slug, view_workspace_id, state, created_at) values (?, 'payments-workspace', 1, '{}', ?)", "b".repeat(64), T0);
    run("insert into demo_profiles (public_id, workspace_id, name, name_key, persona, region, created_at, updated_at) values ('dpf_0000000000000001', 1, 'Priya Shah', 'priya shah', 'Approver', 'Mumbai', ?, ?)", T0, T0);
    migrateUpTo(db, "0056_comments_and_shares_for_applications");
  });
  afterEach(() => db.$client.close());

  it("deletes the template demo's threads, comments, and share links, drops session profiles, and keeps workspaces", () => {
    expect(tables()).toEqual(["demo_comments", "demo_shares", "demo_threads", "demo_workspaces"]);
    expect([count("demo_threads"), count("demo_comments"), count("demo_shares")]).toEqual([0, 0, 0]);
    expect(all("select display_name, hints from demo_workspaces")).toEqual([{ display_name: "Sam Rivera", hints: '{"off":true}' }]);
  });

  it("gives threads an application, route, commit, and anchor, and shares an application, commit, and route", () => {
    expect(columns("demo_threads")).toEqual(["id", "public_id", "application_id", "view_workspace_id", "route", "commit_sha", "anchor", "offset_x", "offset_y", "status", "created_at", "resolved_at"]);
    expect(columns("demo_shares")).toEqual(["id", "token_digest", "application_id", "view_workspace_id", "commit_sha", "route", "created_at"]);
  });

  it("keeps a thread's commit, route, and anchor well formed, and deletes threads and shares with their application", () => {
    const orders = viewedApplicationIn(db, undefined, { hooks: false });
    const thread = (route: string, commit: string, anchor: string) => run("insert into demo_threads (public_id, application_id, view_workspace_id, route, commit_sha, anchor, offset_x, offset_y, created_at) values (?, ?, 1, ?, ?, ?, 0.5, 0.5, ?)", `thr_${Math.random().toString(36).slice(2, 18)}`, orders.id, route, commit, anchor, T0);
    thread("/accounts", commitOf("a"), JSON.stringify(EXPORT_ORDERS));
    expect(() => thread("accounts", commitOf("a"), JSON.stringify(EXPORT_ORDERS))).toThrow(/demo_threads_route/);
    expect(() => thread("/accounts", "main", JSON.stringify(EXPORT_ORDERS))).toThrow(/demo_threads_commit_sha/);
    expect(() => thread("/accounts", commitOf("a"), "[]")).toThrow(/demo_threads_anchor/);
    run("insert into demo_shares (token_digest, application_id, view_workspace_id, commit_sha, route, created_at) values (?, ?, 1, ?, '/accounts', ?)", "c".repeat(64), orders.id, commitOf("a"), T0);
    expect(() => run("insert into demo_shares (token_digest, application_id, view_workspace_id, commit_sha, route, created_at) values (?, ?, 1, ?, '/', ?)", "d".repeat(64), orders.id, "nope", T0)).toThrow(/demo_shares_commit_sha/);

    run("delete from applications where id = ?", orders.id);
    expect([count("demo_threads"), count("demo_shares")]).toEqual([0, 0]);
  });
});
