import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "@/lib/repositories/repository-records";
import type { Db } from "@/lib/db/client";
import { buildRepository } from "../support/builders";
import { decidedPreparation, qualifyingVerdict } from "../support/applications";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";
import { queuedPreview } from "../support/previews";

/*
 * Migration 0058 (restore-toolbar-tools-and-branch-previews, design decisions
 * 1, 5, and 8, and the migration plan): saved previews of an application's
 * branches and tags, session presets that belong to an application, each
 * workspace's choice of preset, and share links and threads that record the
 * saved preview they were made on. Existing share links and threads carry
 * over as the tracked branch's, with an empty view.
 */

const BEFORE = "0057_one_bitbucket_token_per_server";
const T0 = 1_795_000_000_000;
const COMMIT = "a".repeat(40);

describe("saved previews and session presets migration", () => {
  let db: Db;
  let repository: Repository;
  let other: Repository;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const all = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).all(...values);
  const get = <T>(statement: string, ...values: unknown[]) => db.$client.prepare(statement).get(...values) as T;
  const count = (table: string) => get<{ n: number }>(`select count(*) as n from ${table}`).n;
  const columns = (table: string) => (all(`select name from pragma_table_info('${table}')`) as { name: string }[]).map((column) => column.name);

  let applications = 0;
  /** Inserts an application of +owner+'s root package, a new Repository's by default, as onboarding leaves it, and returns its row id. */
  const application = (owner: Repository = buildRepository(db)) => {
    applications++;
    // Before the migration the applications' hooks would read tables that don't exist yet.
    const preparation = decidedPreparation(db, owner, [qualifyingVerdict(".")], undefined, undefined, { hooks: false });
    run(
      `insert into applications (public_id, slug, name, name_key, repository_source_id, package_dir, tracked_ref, latest_preparation_id, latest_commit_sha, latest_requested_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, '.', 'refs/heads/main', ?, ?, ?, ?, ?)`,
      `app_${String(applications).padStart(16, "0")}`,
      `application-${applications}`,
      `Application ${applications}`,
      `application ${applications}`,
      owner.id,
      preparation.id,
      preparation.commitSha,
      T0,
      T0,
      T0,
    );
    return get<{ id: number }>("select id from applications where public_id = ?", `app_${String(applications).padStart(16, "0")}`).id;
  };

  let saved = 0;
  /** Inserts a saved preview of +applicationId+ and returns its row id. */
  const savedPreview = (applicationId: number, values: { key?: string; ref?: string; current?: number | null; latest?: number | null; preparation?: number | null; commit?: string; outcome?: string; reasons?: string | null } = {}) => {
    saved++;
    run(
      `insert into application_previews (public_id, application_id, key, ref, current_preview_id, latest_preview_id, latest_preparation_id, latest_commit_sha, latest_outcome, latest_reasons, latest_requested_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `apv_${String(saved).padStart(16, "0")}`,
      applicationId,
      values.key ?? `feature-${saved}`,
      values.ref ?? `refs/heads/feature/${saved}`,
      values.current ?? null,
      values.latest ?? null,
      values.preparation ?? null,
      values.commit ?? COMMIT,
      values.outcome ?? "building",
      values.reasons ?? null,
      T0,
      T0,
      T0,
    );
    return get<{ id: number }>("select id from application_previews where public_id = ?", `apv_${String(saved).padStart(16, "0")}`).id;
  };

  const share = (applicationId: number, values: { digest?: string; preview?: number | null; ref?: string | null; view?: string } = {}) =>
    run(
      "insert into demo_shares (token_digest, application_id, view_workspace_id, commit_sha, route, application_preview_id, preview_ref, view, created_at) values (?, ?, 1, ?, '/accounts', ?, ?, ?, ?)",
      values.digest ?? Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64),
      applicationId,
      COMMIT,
      values.preview ?? null,
      values.ref ?? null,
      values.view ?? "{}",
      T0,
    );

  const thread = (applicationId: number, values: { preview?: number | null; ref?: string | null } = {}) =>
    run(
      "insert into demo_threads (public_id, application_id, view_workspace_id, route, commit_sha, application_preview_id, preview_ref, anchor, offset_x, offset_y, created_at) values (?, ?, 1, '/accounts', ?, ?, ?, '{}', 0.5, 0.5, ?)",
      `thr_${Math.random().toString(36).slice(2, 18).padEnd(16, "0")}`,
      applicationId,
      COMMIT,
      values.preview ?? null,
      values.ref ?? null,
      T0,
    );

  let presets = 0;
  const preset = (applicationId: number, values: { name?: string; nameKey?: string; entries?: string } = {}) => {
    presets++;
    const name = values.name ?? `Preset ${presets}`;
    run(
      "insert into session_presets (public_id, application_id, name, name_key, entries, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
      `ses_${String(presets).padStart(16, "0")}`,
      applicationId,
      name,
      values.nameKey ?? name.toLowerCase(),
      values.entries ?? '[{"store":"local","name":"desk:user","value":"admin"}]',
      T0,
      T0,
    );
    return get<{ id: number }>("select id from session_presets where public_id = ?", `ses_${String(presets).padStart(16, "0")}`).id;
  };

  let orders: number;

  beforeEach(() => {
    db = createTestDb(migrationFolderAt(BEFORE));
    repository = buildRepository(db, { name: "orders-portal" });
    other = buildRepository(db, { name: "quotes-desk" });
    // A workspace with a thread and a share link on the tracked branch, made before the migration.
    run("insert into demo_workspaces (key_digest, display_name, created_at, last_seen_at) values (?, 'Sam Rivera', ?, ?)", "a".repeat(64), T0, T0);
    orders = application(repository);
    run("insert into demo_threads (public_id, application_id, view_workspace_id, route, commit_sha, anchor, offset_x, offset_y, created_at) values ('thr_0000000000000001', ?, 1, '/accounts', ?, '{\"path\":\"#a\",\"tag\":\"a\",\"fingerprint\":\"\"}', 0.5, 0.5, ?)", orders, COMMIT, T0);
    run("insert into demo_comments (public_id, thread_id, author_workspace_id, author_name, body, created_at) values ('cmt_0000000000000001', 1, 1, 'Sam Rivera', 'Make this primary', ?)", T0);
    run("insert into demo_shares (token_digest, application_id, view_workspace_id, commit_sha, route, created_at) values (?, ?, 1, ?, '/accounts?tab=billing', ?)", "b".repeat(64), orders, COMMIT, T0);
    migrateUpTo(db, "0058_saved_previews_and_session_presets");
  });
  afterEach(() => db.$client.close());

  it("keeps existing threads, comments, and share links as the tracked branch's, with an empty view", () => {
    expect(all("select public_id, application_preview_id, preview_ref from demo_threads")).toEqual([{ public_id: "thr_0000000000000001", application_preview_id: null, preview_ref: null }]);
    expect(count("demo_comments")).toBe(1);
    expect(all("select route, application_preview_id, preview_ref, view from demo_shares")).toEqual([{ route: "/accounts?tab=billing", application_preview_id: null, preview_ref: null, view: "{}" }]);
    expect(all("select * from pragma_foreign_key_check")).toEqual([]);
    expect([count("application_previews"), count("session_presets"), count("session_preset_choices")]).toEqual([0, 0, 0]);
  });

  it("adds the saved preview and its ref to threads and shares, and a view to shares", () => {
    expect(columns("demo_threads")).toEqual(["id", "public_id", "application_id", "view_workspace_id", "route", "commit_sha", "application_preview_id", "preview_ref", "anchor", "offset_x", "offset_y", "status", "created_at", "resolved_at"]);
    expect(columns("demo_shares")).toEqual(["id", "token_digest", "application_id", "view_workspace_id", "commit_sha", "route", "application_preview_id", "preview_ref", "view", "created_at"]);
  });

  describe("saved previews", () => {
    it("rejects a ready outcome without a current build", () => {
      expect(() => savedPreview(orders, { outcome: "ready" })).toThrow(/application_previews_ready/);
    });

    it("rejects a duplicate key or ref in one application, and allows them in another", () => {
      savedPreview(orders, { key: "feature-new-nav", ref: "refs/heads/feature/new-nav" });
      expect(() => savedPreview(orders, { key: "feature-new-nav", ref: "refs/tags/feature/new-nav" })).toThrow(/UNIQUE constraint failed: application_previews.application_id, application_previews.key/);
      expect(() => savedPreview(orders, { key: "feature-new-nav-2", ref: "refs/heads/feature/new-nav" })).toThrow(/UNIQUE constraint failed: application_previews.application_id, application_previews.ref/);
      savedPreview(orders, { key: "feature-new-nav-2", ref: "refs/tags/feature/new-nav" });
      savedPreview(application(other), { key: "feature-new-nav", ref: "refs/heads/feature/new-nav" });
      expect(count("application_previews")).toBe(3);
    });

    it.each([["orders@main"], ["feature/new-nav"], ["Feature"], ["-nav"], ["nav-"], ["new--nav"], [""], ["x".repeat(61)]])("rejects the key %j", (key) => {
      expect(() => savedPreview(orders, { key })).toThrow(/CHECK constraint failed: application_previews_key/);
    });

    it("accepts a tag's key with dots", () => {
      savedPreview(orders, { key: "v1.1.0", ref: "refs/tags/v1.1.0" });
      expect(get<{ key: string }>("select key from application_previews").key).toBe("v1.1.0");
    });

    it.each([
      ["a short ref", { ref: "main" }, /application_previews_ref/],
      ["a ref outside branches and tags", { ref: "refs/pull/1/head" }, /application_previews_ref/],
      ["an unknown outcome", { outcome: "queued" }, /application_previews_latest_outcome/],
      ["a failure without reasons", { outcome: "failed" }, /application_previews_latest_reasons/],
      ["a short commit", { commit: "abc" }, /application_previews_latest_commit/],
    ])("rejects %s", (_label, values, error) => {
      expect(() => savedPreview(orders, values)).toThrow(error);
    });

    it("points only at previews and preparations of its application's Repository and package, the latest at its latest commit", () => {
      const preview = queuedPreview(db, repository);
      const own = get<{ id: number; preparation_id: number; commit_sha: string }>("select id, preparation_id, commit_sha from preview_builds where public_id = ?", preview.publicId);
      const elsewhere = get<{ id: number }>("select id from preview_builds where public_id = ?", queuedPreview(db, other).publicId);

      const kept = savedPreview(orders, { preparation: own.preparation_id, commit: own.commit_sha, latest: own.id });
      expect(() => savedPreview(orders, { preparation: own.preparation_id, commit: own.commit_sha, latest: elsewhere.id })).toThrow(/builds are previews of the application's Repository and package/);
      expect(() => savedPreview(orders, { preparation: own.preparation_id, commit: "e".repeat(40) })).toThrow(/builds are previews/);
      expect(() => run("update application_previews set current_preview_id = ? where id = ?", elsewhere.id, kept)).toThrow(/builds are previews/);
      run("update application_previews set current_preview_id = ?, latest_outcome = 'ready' where id = ?", own.id, kept);

      // A build a saved preview uses can't be removed under it.
      expect(() => run("delete from preview_builds where id = ?", own.id)).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("keeps its application, key, and ref", () => {
      const kept = savedPreview(orders);
      expect(() => run("update application_previews set key = 'renamed' where id = ?", kept)).toThrow(/keeps its application, key, and ref/);
      expect(() => run("update application_previews set ref = 'refs/heads/other' where id = ?", kept)).toThrow(/keeps its application, key, and ref/);
      expect(() => run("update application_previews set application_id = ? where id = ?", application(), kept)).toThrow(/keeps its application, key, and ref/);
      run("update application_previews set remote_missing_at = ? where id = ?", T0, kept);
    });

    it("is deleted with its application", () => {
      const doomed = application();
      savedPreview(doomed);
      run("delete from applications where id = ?", doomed);
      expect(count("application_previews")).toBe(0);
    });
  });

  describe("share links and threads", () => {
    it("rejects a view that isn't a JSON object", () => {
      share(orders, { view: '{"theme":{"mode":"dark"}}' });
      for (const view of ["[]", '"dark"', "not json", "null"]) expect(() => share(orders, { view })).toThrow(/demo_shares_view/);
    });

    it("records a saved preview only with its ref, and only one of its own application's", () => {
      const preview = savedPreview(orders, { ref: "refs/heads/feature/new-nav" });
      share(orders, { preview, ref: "refs/heads/feature/new-nav" });
      thread(orders, { preview, ref: "refs/heads/feature/new-nav" });
      expect(() => share(orders, { preview })).toThrow(/demo_shares_preview_ref/);
      expect(() => thread(orders, { preview })).toThrow(/demo_threads_preview_ref/);
      expect(() => share(orders, { ref: "feature/new-nav" })).toThrow(/demo_shares_preview_ref/);
      const quotes = application(other);
      expect(() => share(quotes, { preview, ref: "refs/heads/feature/new-nav" })).toThrow(/saved preview is one of its application's/);
      expect(() => thread(quotes, { preview, ref: "refs/heads/feature/new-nav" })).toThrow(/saved preview is one of its application's/);
    });

    it("keeps share links and threads, with the ref, when their saved preview is removed", () => {
      const preview = savedPreview(orders, { ref: "refs/heads/fix/totals" });
      share(orders, { preview, ref: "refs/heads/fix/totals" });
      thread(orders, { preview, ref: "refs/heads/fix/totals" });
      run("delete from application_previews where id = ?", preview);
      expect(all("select application_preview_id, preview_ref from demo_shares where preview_ref is not null")).toEqual([{ application_preview_id: null, preview_ref: "refs/heads/fix/totals" }]);
      expect(all("select application_preview_id, preview_ref from demo_threads where preview_ref is not null")).toEqual([{ application_preview_id: null, preview_ref: "refs/heads/fix/totals" }]);
    });
  });

  describe("session presets", () => {
    it("rejects a duplicate name in one application, ignoring case by its key, and allows it in another", () => {
      preset(orders, { name: "Admin user", nameKey: "admin user" });
      expect(() => preset(orders, { name: "ADMIN USER", nameKey: "admin user" })).toThrow(/UNIQUE constraint failed: session_presets.application_id, session_presets.name_key/);
      preset(application(other), { name: "Admin user", nameKey: "admin user" });
    });

    it.each([
      ["no entries", { entries: "[]" }, /session_presets_entries/],
      ["51 entries", { entries: JSON.stringify(Array.from({ length: 51 }, (_, index) => ({ store: "local", name: `k${index}`, value: "v" }))) }, /session_presets_entries/],
      ["entries that aren't an array", { entries: '{"store":"local"}' }, /session_presets_entries/],
      ["a blank name", { name: "  " }, /session_presets_name/],
      ["a name of 61 characters", { name: "x".repeat(61) }, /session_presets_name/],
    ])("rejects %s", (_label, values, error) => {
      expect(() => preset(orders, values)).toThrow(error);
    });

    it("keeps a preset's application", () => {
      const kept = preset(orders);
      expect(() => run("update session_presets set application_id = ? where id = ?", application(), kept)).toThrow(/keeps its application/);
      run("update session_presets set name = 'Renamed', name_key = 'renamed', updated_by_name = 'Sam Rivera', lock_version = 1 where id = ?", kept);
    });

    it("holds one choice per workspace and application, of that application's own presets", () => {
      const admin = preset(orders);
      const flag = preset(orders);
      run("insert into session_preset_choices (workspace_id, application_id, preset_id) values (1, ?, ?)", orders, admin);
      expect(() => run("insert into session_preset_choices (workspace_id, application_id, preset_id) values (1, ?, ?)", orders, flag)).toThrow(/UNIQUE constraint failed: session_preset_choices.workspace_id, session_preset_choices.application_id/);
      run("update session_preset_choices set preset_id = ? where workspace_id = 1", flag);
      const quotes = application(other);
      expect(() => run("insert into session_preset_choices (workspace_id, application_id, preset_id) values (1, ?, ?)", quotes, admin)).toThrow(/chosen preset is one of the application's/);
    });

    it("clears every workspace's choice of a deleted preset, and deletes presets and choices with their application", () => {
      run("insert into demo_workspaces (key_digest, created_at, last_seen_at) values (?, ?, ?)", "c".repeat(64), T0, T0);
      const admin = preset(orders);
      const kept = preset(orders);
      run("insert into session_preset_choices (workspace_id, application_id, preset_id) values (1, ?, ?), (2, ?, ?)", orders, admin, orders, admin);
      run("delete from session_presets where id = ?", admin);
      expect(count("session_preset_choices")).toBe(0);

      run("insert into session_preset_choices (workspace_id, application_id, preset_id) values (1, ?, ?)", orders, kept);
      run("delete from applications where id = ?", orders);
      expect([count("session_presets"), count("session_preset_choices")]).toEqual([0, 0]);
    });

    it("deletes a workspace's choices with it, and keeps the application's presets", () => {
      const admin = preset(orders);
      run("insert into session_preset_choices (workspace_id, application_id, preset_id) values (1, ?, ?)", orders, admin);
      run("delete from demo_workspaces where id = 1");
      expect([count("session_presets"), count("session_preset_choices")]).toEqual([1, 0]);
    });
  });
});
