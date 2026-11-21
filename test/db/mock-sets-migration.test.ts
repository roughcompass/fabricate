import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { buildRepository } from "../support/builders";
import { decidedPreparation, qualifyingVerdict } from "../support/applications";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";
import { queuedPreview } from "../support/previews";

/*
 * Migration 0059 (add-mock-sets, design decision 10, task 2.1): mock sets,
 * their rules, defaults, choices, import drafts, and the calls a capture saw
 * fail, with plain columns on preview_screenshots. It adds tables and
 * columns only, so existing screenshots keep their rows, with no set and no
 * failed calls.
 */

const BEFORE = "0058_saved_previews_and_session_presets";
const T0 = 1_795_000_000_000;
const DIGEST = "d".repeat(64);
const RESPONSE = '[{"status":200,"headers":[],"body":null,"latencyMs":0}]';

describe("mock sets migration", () => {
  let db: Db;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const all = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).all(...values);
  const get = <T>(statement: string, ...values: unknown[]) => db.$client.prepare(statement).get(...values) as T;
  const columns = (table: string) => (all(`select name from pragma_table_info('${table}')`) as { name: string }[]).map((column) => column.name);

  let orders: number;
  let screenshot: number;
  let sets = 0;
  const set = (name: string, nameKey = name.toLowerCase(), application = orders) => {
    sets++;
    run("insert into mock_sets (public_id, application_id, name, name_key, source, created_at, updated_at) values (?, ?, ?, ?, 'written', ?, ?)", `mks_${String(sets).padStart(16, "0")}`, application, name, nameKey, T0, T0);
    return get<{ id: number }>("select id from mock_sets where public_id = ?", `mks_${String(sets).padStart(16, "0")}`).id;
  };
  let rules = 0;
  const rule = (setId: number, values: { enabled?: number; responses?: string; bodyMode?: string; bodyDigest?: string | null; bodySize?: number | null; method?: string } = {}) => {
    rules++;
    run(
      "insert into mock_rules (public_id, set_id, position, enabled, method, pattern, body_mode, body_digest, body_size, responses, created_at, updated_at) values (?, ?, ?, ?, ?, '/v1/orders', ?, ?, ?, ?, ?, ?)",
      `mkr_${String(rules).padStart(16, "0")}`,
      setId,
      rules,
      values.enabled ?? 1,
      values.method ?? "GET",
      values.bodyMode ?? "ignore",
      values.bodyDigest ?? null,
      values.bodySize ?? null,
      values.responses ?? RESPONSE,
      T0,
      T0,
    );
  };

  beforeEach(() => {
    db = createTestDb(migrationFolderAt(BEFORE));
    const repository = buildRepository(db, { name: "orders-portal" });
    run("insert into demo_workspaces (key_digest, display_name, created_at, last_seen_at) values (?, 'Sam Rivera', ?, ?)", "a".repeat(64), T0, T0);
    const preparation = decidedPreparation(db, repository, [qualifyingVerdict(".")], undefined, undefined, { hooks: false });
    run(
      `insert into applications (public_id, slug, name, name_key, repository_source_id, package_dir, tracked_ref, latest_preparation_id, latest_commit_sha, latest_requested_at, created_at, updated_at)
       values ('app_0000000000000001', 'orders-portal', 'Orders portal', 'orders portal', ?, '.', 'refs/heads/main', ?, ?, ?, ?, ?)`,
      repository.id,
      preparation.id,
      preparation.commitSha,
      T0,
      T0,
      T0,
    );
    orders = get<{ id: number }>("select id from applications").id;
    const preview = get<{ id: number }>("select id from preview_builds where public_id = ?", queuedPreview(db, repository).publicId);
    run("insert into preview_screenshots (preview_id, artifact, state, directory, requested_at, captured_at, created_at, updated_at) values (?, 'out/1-a', 'ready', 'screenshots/1-a', ?, ?, ?, ?)", preview.id, T0, T0, T0, T0);
    migrateUpTo(db, "0059_mock_sets");
    screenshot = get<{ id: number }>("select id from preview_screenshots").id;
  });
  afterEach(() => db.$client.close());

  it("keeps existing screenshots, with no set and no failed calls, and adds only tables and plain columns", () => {
    expect(all("select state, directory, mock_set_public_id, mock_set_name, mock_set_revision, failed_calls, failures_dismissed_at from preview_screenshots")).toEqual([
      { state: "ready", directory: "screenshots/1-a", mock_set_public_id: null, mock_set_name: null, mock_set_revision: null, failed_calls: 0, failures_dismissed_at: null },
    ]);
    expect(columns("preview_screenshots").slice(-5)).toEqual(["mock_set_public_id", "mock_set_name", "mock_set_revision", "failed_calls", "failures_dismissed_at"]);
    for (const table of ["mock_sets", "mock_rules", "mock_set_defaults", "mock_set_choices", "mock_set_imports", "screenshot_failed_calls"]) expect(columns(table).length, table).toBeGreaterThan(0);
    expect(all("select * from pragma_foreign_key_check")).toEqual([]);
  });

  describe("rules", () => {
    it("rejects an enabled rule without a response, and keeps one turned off", () => {
      const happy = set("Happy path");
      expect(() => rule(happy, { responses: "[]" })).toThrow(/mock_rules_enabled/);
      rule(happy, { responses: "[]", enabled: 0 });
      expect(get<{ n: number }>("select count(*) as n from mock_rules").n).toBe(1);
    });

    it("rejects a body mode without its digest, and a digest without a body mode", () => {
      const happy = set("Happy path");
      expect(() => rule(happy, { bodyMode: "json" })).toThrow(/mock_rules_body/);
      expect(() => rule(happy, { bodyDigest: DIGEST, bodySize: 17 })).toThrow(/mock_rules_body/);
      rule(happy, { bodyMode: "json", bodyDigest: DIGEST, bodySize: 17 });
    });

    it.each([[99], [600], ["200"]])("rejects the status %j in any response", (status) => {
      const happy = set("Happy path");
      const responses = JSON.stringify([{ status: 200 }, { status }]);
      expect(() => rule(happy, { responses })).toThrow(/mock_rules_statuses/);
    });

    it("accepts statuses from 200 to 599 in each of 20 responses, and refuses a 21st", () => {
      const happy = set("Happy path");
      rule(happy, { responses: JSON.stringify(Array.from({ length: 20 }, (_, index) => ({ status: index % 2 ? 599 : 200 }))) });
      expect(() => rule(happy, { responses: JSON.stringify(Array.from({ length: 21 }, () => ({ status: 200 }))) })).toThrow(/mock_rules_responses/);
    });

    it("rejects a lowercase method, and accepts any method", () => {
      const happy = set("Happy path");
      expect(() => rule(happy, { method: "get" })).toThrow(/mock_rules_method/);
      rule(happy, { method: "*" });
    });
  });

  describe("sets", () => {
    it("rejects a duplicate name ignoring case in one application, and allows it in another", () => {
      set("Happy path");
      expect(() => set("happy path", "happy path")).toThrow(/UNIQUE constraint failed: mock_sets.application_id, mock_sets.name_key/);
      run(
        `insert into applications (public_id, slug, name, name_key, repository_source_id, package_dir, tracked_ref, latest_preparation_id, latest_commit_sha, latest_requested_at, created_at, updated_at)
         select 'app_0000000000000002', 'quotes-desk', 'Quotes desk', 'quotes desk', repository_source_id, 'desk', tracked_ref, latest_preparation_id, latest_commit_sha, latest_requested_at, created_at, updated_at from applications`,
      );
      set("Happy path", "happy path", get<{ id: number }>("select id from applications where slug = 'quotes-desk'").id);
    });

    it("deletes its rules, defaults, and choices with it, and every set with its application", () => {
      const happy = set("Happy path");
      rule(happy);
      run("insert into mock_set_defaults (application_id, mock_set_id) values (?, ?)", orders, happy);
      run("insert into mock_set_choices (workspace_id, application_id, mock_set_id) values (1, ?, ?)", orders, happy);
      run("delete from mock_sets where id = ?", happy);
      expect([get<{ n: number }>("select count(*) as n from mock_rules").n, get<{ n: number }>("select count(*) as n from mock_set_defaults").n, get<{ n: number }>("select count(*) as n from mock_set_choices").n]).toEqual([0, 0, 0]);
      set("Errors");
      run("delete from applications where id = ?", orders);
      expect(get<{ n: number }>("select count(*) as n from mock_sets").n).toBe(0);
    });
  });

  describe("defaults and choices", () => {
    it("requires a set for the application's default, and allows one row for it", () => {
      const happy = set("Happy path");
      expect(() => run("insert into mock_set_defaults (application_id, mock_set_id) values (?, null)", orders)).toThrow(/mock_set_defaults_application/);
      run("insert into mock_set_defaults (application_id, mock_set_id) values (?, ?)", orders, happy);
      expect(() => run("insert into mock_set_defaults (application_id, mock_set_id) values (?, ?)", orders, set("Errors"))).toThrow(/UNIQUE constraint failed: mock_set_defaults.application_id/);
    });

    it("rejects a second choice for one workspace, application, and view, the tracked branch or one saved preview", () => {
      const happy = set("Happy path");
      run("insert into mock_set_choices (workspace_id, application_id, mock_set_id) values (1, ?, ?)", orders, happy);
      // None is a choice too.
      expect(() => run("insert into mock_set_choices (workspace_id, application_id, mock_set_id) values (1, ?, null)", orders)).toThrow(/UNIQUE constraint failed: mock_set_choices.workspace_id, mock_set_choices.application_id/);
      run(
        `insert into application_previews (public_id, application_id, key, ref, latest_commit_sha, latest_outcome, latest_requested_at, created_at, updated_at)
         values ('apv_0000000000000001', ?, 'feature-new-nav', 'refs/heads/feature/new-nav', ?, 'building', ?, ?, ?)`,
        orders,
        "a".repeat(40),
        T0,
        T0,
        T0,
      );
      const preview = get<{ id: number }>("select id from application_previews").id;
      run("insert into mock_set_choices (workspace_id, application_id, application_preview_id, mock_set_id) values (1, ?, ?, null)", orders, preview);
      expect(() => run("insert into mock_set_choices (workspace_id, application_id, application_preview_id, mock_set_id) values (1, ?, ?, ?)", orders, preview, happy)).toThrow(/UNIQUE constraint failed: mock_set_choices.workspace_id, mock_set_choices.application_preview_id/);
      // A preview's own default, None, sits beside the application's.
      run("insert into mock_set_defaults (application_id, mock_set_id) values (?, ?)", orders, happy);
      run("insert into mock_set_defaults (application_id, application_preview_id, mock_set_id) values (?, ?, null)", orders, preview);
      run("delete from application_previews where id = ?", preview);
      expect(all("select application_preview_id from mock_set_choices union all select application_preview_id from mock_set_defaults")).toEqual([{ application_preview_id: null }, { application_preview_id: null }]);
    });
  });

  describe("failed calls and drafts", () => {
    it("keeps a failed call's kind and status together, up to 50 a screenshot, and deletes them with it", () => {
      const call = (position: number, kind: string, status: number | null) => run("insert into screenshot_failed_calls (screenshot_id, position, method, url, kind, status) values (?, ?, 'GET', 'https://api.orders.test/v1/rates', ?, ?)", screenshot, position, kind, status);
      call(0, "connect", null);
      call(1, "status", 503);
      call(2, "not_mocked", 501);
      expect(() => call(3, "status", null)).toThrow(/screenshot_failed_calls_status/);
      expect(() => call(3, "cors", 0)).toThrow(/screenshot_failed_calls_status/);
      expect(() => call(3, "timeout", null)).toThrow(/screenshot_failed_calls_kind/);
      expect(() => call(50, "connect", null)).toThrow(/screenshot_failed_calls_position/);
      run("delete from preview_screenshots");
      expect(get<{ n: number }>("select count(*) as n from screenshot_failed_calls").n).toBe(0);
    });

    it("expires a draft after it was made", () => {
      const draft = (created: number, expires: number) => run("insert into mock_set_imports (public_id, application_id, workspace_id, file_name, entry_count, created_at, expires_at) values ('mki_0000000000000001', ?, 1, 'orders-portal.har', 24, ?, ?)", orders, created, expires);
      expect(() => draft(T0, T0)).toThrow(/mock_set_imports_expiry/);
      draft(T0, T0 + 86_400_000);
      run("delete from demo_workspaces");
      expect(get<{ n: number }>("select count(*) as n from mock_set_imports").n).toBe(0);
    });
  });
});
