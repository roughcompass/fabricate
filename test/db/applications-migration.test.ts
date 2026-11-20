import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "@/lib/repositories/repository-records";
import type { Db } from "@/lib/db/client";
import { buildRepository } from "../support/builders";
import { decidedPreparation, qualifyingVerdict } from "../support/applications";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";
import { queuedPreview } from "../support/previews";

/*
 * Migration 0054 (add-applications, design decisions 1 and 4): applications,
 * one per Repository and package, each with a unique slug and a name unique
 * ignoring case, pointing at previews of its own Repository and package; and
 * one screenshot row per preview.
 */

const BEFORE = "0053_adoption_snapshots";
const T0 = 1_795_000_000_000;

describe("applications migration", () => {
  let db: Db;
  let repository: Repository;
  let other: Repository;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const count = (table: string) => (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  const id = (table: string, publicId: string) => (db.$client.prepare(`select id from ${table} where public_id = ?`).get(publicId) as { id: number }).id;

  beforeEach(() => {
    // Repositories registered before the migration carry over untouched.
    db = createTestDb(migrationFolderAt(BEFORE));
    repository = buildRepository(db, { name: "spa-orders" });
    other = buildRepository(db, { name: "spa-admin" });
    migrateUpTo(db, "0054_applications");
  });
  afterEach(() => db.$client.close());

  let applications = 0;
  /** Inserts an application of +values.repository+'s package, building from the preparation +values.preparation+ of its latest commit. */
  const insert = (values: { name?: string; nameKey?: string; slug?: string; repository?: Repository; packageDir?: string; trackedRef?: string; preparation?: number; commit?: string; current?: number | null; latest?: number | null; outcome?: string; reasons?: string | null }) => {
    applications++;
    const owner = values.repository ?? repository;
    const prepared = values.preparation === undefined ? decidedPreparation(db, owner, [qualifyingVerdict(values.packageDir ?? ".")], undefined, undefined, { hooks: false }) : null;
    const name = values.name ?? `Application ${applications}`;
    run(
      `insert into applications (public_id, slug, name, name_key, repository_source_id, package_dir, tracked_ref, current_preview_id, latest_preview_id, latest_preparation_id, latest_commit_sha, latest_outcome, latest_reasons, latest_requested_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `app_${String(applications).padStart(16, "0")}`,
      values.slug ?? `application-${applications}`,
      name,
      values.nameKey ?? name.toLowerCase(),
      owner.id,
      values.packageDir ?? ".",
      values.trackedRef ?? "refs/heads/main",
      values.current ?? null,
      values.latest ?? null,
      values.preparation ?? prepared!.id,
      values.commit ?? prepared?.commitSha ?? "a".repeat(40),
      values.outcome ?? "building",
      values.reasons ?? null,
      T0,
      T0,
      T0,
    );
    return `app_${String(applications).padStart(16, "0")}`;
  };

  it("keeps existing Repositories and starts with no applications or screenshots", () => {
    expect(count("repository_sources")).toBe(2);
    expect(count("applications")).toBe(0);
    expect(count("preview_screenshots")).toBe(0);
  });

  it("rejects a duplicate name in different case, by its key", () => {
    insert({ name: "Orders portal", nameKey: "orders portal" });
    expect(() => insert({ name: "orders portal", nameKey: "orders portal", packageDir: "apps/admin" })).toThrow(/UNIQUE constraint failed: applications.name_key/);
  });

  it("rejects a second application of the same Repository and package, and allows another package or Repository", () => {
    insert({ packageDir: "apps/web" });
    expect(() => insert({ packageDir: "apps/web" })).toThrow(/UNIQUE constraint failed: applications.repository_source_id, applications.package_dir/);
    insert({ packageDir: "apps/admin" });
    insert({ repository: other, packageDir: "apps/web" });
    expect(count("applications")).toBe(3);
  });

  it("rejects a duplicate slug", () => {
    insert({ slug: "orders-portal" });
    expect(() => insert({ slug: "orders-portal", packageDir: "apps/admin" })).toThrow(/UNIQUE constraint failed: applications.slug/);
  });

  it.each([["new"], ["Orders"], ["-orders"], ["orders-"], ["orders--portal"], ["orders portal"], [""]])("rejects the slug %j", (slug) => {
    expect(() => insert({ slug })).toThrow(/CHECK constraint failed: applications_slug/);
  });

  it.each([
    ["a tag as the tracked ref", { trackedRef: "refs/tags/v1" }, /applications_tracked_ref/],
    ["a short tracked ref", { trackedRef: "main" }, /applications_tracked_ref/],
    ["a blank name", { name: "  " }, /applications_name/],
    ["an unknown outcome", { outcome: "queued" }, /applications_latest_outcome/],
    ["a failure without reasons", { outcome: "failed" }, /applications_latest_reasons/],
    ["reasons while building", { reasons: '[{"text":"no"}]' }, /applications_latest_reasons/],
    ["a ready outcome without a current build", { outcome: "ready" }, /applications_ready/],
    ["a package directory outside the repository", { packageDir: "../web" }, /applications_package_dir/],
  ])("rejects %s", (_label, values, error) => {
    expect(() => insert(values)).toThrow(error);
  });

  it("points only at previews and preparations of its own Repository and package, and the latest at its latest commit", () => {
    const preview = queuedPreview(db, repository, "standalone", { hooks: false });
    const previewId = id("preview_builds", preview.publicId);
    const elsewhere = queuedPreview(db, other, "standalone", { hooks: false });
    const preparation = (db.$client.prepare("select id, commit_sha from preview_preparations where id = (select preparation_id from preview_builds where public_id = ?)").get(preview.publicId) as { id: number; commit_sha: string });

    // Building its latest commit's preview: allowed.
    const own = insert({ preparation: preparation.id, commit: preparation.commit_sha, latest: previewId });
    expect(() => insert({ preparation: preparation.id, commit: preparation.commit_sha, latest: id("preview_builds", elsewhere.publicId), packageDir: "apps/x" })).toThrow(/builds are previews of the application's Repository and package/);
    expect(() => insert({ preparation: preparation.id, commit: "e".repeat(40), packageDir: "apps/y" })).toThrow(/builds are previews/);
    expect(() => run("update applications set current_preview_id = ? where public_id = ?", id("preview_builds", elsewhere.publicId), own)).toThrow(/builds are previews/);

    // Its address, Repository, and package stay.
    expect(() => run("update applications set slug = 'renamed' where public_id = ?", own)).toThrow(/keeps its slug, Repository, and package/);
    expect(() => run("update applications set package_dir = 'apps/web' where public_id = ?", own)).toThrow(/keeps its slug, Repository, and package/);
    run("update applications set name = 'Renamed', name_key = 'renamed' where public_id = ?", own);
  });

  it("keeps a preview an application uses from being removed, and one screenshot per preview", () => {
    const preview = queuedPreview(db, repository, "standalone", { hooks: false });
    const previewId = id("preview_builds", preview.publicId);
    run("insert into preview_screenshots (preview_id, artifact, requested_at, created_at, updated_at) values (?, 'out/1-a', ?, ?, ?)", previewId, T0, T0, T0);
    expect(() => run("insert into preview_screenshots (preview_id, artifact, requested_at, created_at, updated_at) values (?, 'out/1-b', ?, ?, ?)", previewId, T0, T0, T0)).toThrow(/UNIQUE constraint failed: preview_screenshots.preview_id/);
    expect(() => run("update preview_screenshots set state = 'ready' where preview_id = ?", previewId)).toThrow(/preview_screenshots_ready/);
    expect(() => run("update preview_screenshots set state = 'unavailable' where preview_id = ?", previewId)).toThrow(/preview_screenshots_unavailable/);
    run("update preview_screenshots set state = 'ready', directory = 'screenshots/1-a', captured_at = ? where preview_id = ?", T0, previewId);

    const preparation = db.$client.prepare("select preparation_id from preview_builds where id = ?").get(previewId) as { preparation_id: number };
    insert({ preparation: preparation.preparation_id, commit: preview.commitSha, latest: previewId });
    expect(() => run("delete from preview_builds where id = ?", previewId)).toThrow(/FOREIGN KEY constraint failed/);
  });
});
