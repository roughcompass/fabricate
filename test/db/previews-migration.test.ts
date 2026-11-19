import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";

/*
 * Migration 0042 (add-repository-previews, design decision 1): preview
 * preparations, one per Repository and commit, and preview builds, one per
 * Repository, commit, and package among undeleted rows. A build row exists
 * only once its commit's preparation has decided some package qualifies.
 */

const BEFORE = "0041_bitbucket_tokens";
const COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);
const DIGEST = "d".repeat(64);
const T0 = 1_790_000_000_000;

describe("repository previews migration", () => {
  let db: Db;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const count = (table: string) => (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

  beforeEach(() => {
    // A Repository registered before the migration carries over untouched.
    db = createTestDb(migrationFolderAt(BEFORE));
    run("insert into repository_sources (public_id, name, clone_url, canonical_url, created_at, updated_at) values ('src_orders0000000000', 'orders', 'https://git.example.com/acme/orders.git', 'https://git.example.com/acme/orders', ?, ?)", T0, T0);
    migrateUpTo(db, "0042_repository_previews");
  });
  afterEach(() => db.$client.close());

  let preparations = 0;
  const preparation = (commit = COMMIT, state: "profiling" | "ready" | "refused" = "ready") => {
    preparations++;
    const publicId = `ppr_${String(preparations).padStart(16, "0")}`;
    run(
      "insert into preview_preparations (public_id, repository_source_id, commit_sha, ref_name, ref_kind, requested_at, created_at, updated_at) values (?, 1, ?, 'refs/heads/main', 'branch', ?, ?, ?)",
      publicId,
      commit,
      T0,
      T0,
      T0,
    );
    if (state !== "profiling") {
      run(
        "update preview_preparations set state = ?, profile_document = '{}', profile_digest = ?, packages = '[]', refusal = ?, finished_at = ? where public_id = ?",
        state,
        DIGEST,
        state === "refused" ? '{"conditions":[]}' : null,
        T0,
        publicId,
      );
    }
    return (db.$client.prepare("select id from preview_preparations where public_id = ?").get(publicId) as { id: number }).id;
  };
  let builds = 0;
  const build = (preparationId: number, values: { commit?: string; packageDir?: string } = {}) => {
    builds++;
    const publicId = `pvw_${String(builds).padStart(16, "0")}`;
    run(
      "insert into preview_builds (public_id, repository_source_id, preparation_id, commit_sha, package_dir, ref_name, ref_kind, profile_digest, deciding_facts, created_at, updated_at) values (?, 1, ?, ?, ?, 'refs/heads/main', 'branch', ?, '{}', ?, ?)",
      publicId,
      preparationId,
      values.commit ?? COMMIT,
      values.packageDir ?? "apps/web",
      DIGEST,
      T0,
      T0,
    );
    return publicId;
  };

  it("keeps existing Repositories and starts with no preparations or previews", () => {
    expect(count("repository_sources")).toBe(1);
    expect(count("preview_preparations")).toBe(0);
    expect(count("preview_builds")).toBe(0);
  });

  it("allows one undeleted preview per Repository, commit, and package", () => {
    const prepared = preparation();
    const first = build(prepared);

    expect(() => build(prepared)).toThrow(/UNIQUE constraint failed: preview_builds.repository_source_id, preview_builds.commit_sha, preview_builds.package_dir/);
    // Another package at the commit, or the package at another commit, is another preview.
    build(prepared, { packageDir: "apps/admin" });
    build(preparation(OTHER_COMMIT), { commit: OTHER_COMMIT });

    // Once the first is deleted, the same Repository, commit, and package can be previewed again.
    run("update preview_builds set deleted_at = ? where public_id = ?", T0 + 1, first);
    build(prepared);
    expect(count("preview_builds")).toBe(4);
  });

  it("allows one preparation per Repository and commit", () => {
    preparation();
    expect(() => preparation()).toThrow(/UNIQUE constraint failed: preview_preparations.repository_source_id, preview_preparations.commit_sha/);
  });

  it("builds only from a ready preparation of the same Repository and commit", () => {
    expect(() => build(preparation(COMMIT, "profiling"))).toThrow(/only from a ready preparation/);
    expect(() => build(preparation(OTHER_COMMIT, "refused"), { commit: OTHER_COMMIT })).toThrow(/only from a ready preparation/);
    expect(() => build(preparation("c".repeat(40)), { commit: COMMIT })).toThrow(/only from a ready preparation/);
  });

  it("starts each preview queued with nothing published, and freezes a deleted one", () => {
    const prepared = preparation();
    expect(() =>
      run(
        "insert into preview_builds (public_id, repository_source_id, preparation_id, commit_sha, package_dir, ref_kind, profile_digest, deciding_facts, attempt_state, created_at, updated_at) values ('pvw_ready00000000000', 1, ?, ?, '.', 'commit', ?, '{}', 'ready', ?, ?)",
        prepared,
        COMMIT,
        DIGEST,
        T0,
        T0,
      ),
    ).toThrow(/starts with its first attempt queued/);

    const preview = build(prepared);
    expect(() => run("update preview_builds set package_dir = 'apps/admin' where public_id = ?", preview)).toThrow(/keeps its Repository, commit, package/);
    run("update preview_builds set attempt = 2 where public_id = ?", preview);
    expect(() => run("update preview_builds set attempt = 1 where public_id = ?", preview)).toThrow(/numbered forward/);

    run("update preview_builds set deleted_at = ? where public_id = ?", T0 + 1, preview);
    expect(() => run("update preview_builds set attempt_state = 'building', attempt_claim = 'late-worker' where public_id = ?", preview)).toThrow(/stays deleted/);
    expect(() => run("update preview_builds set deleted_at = null where public_id = ?", preview)).toThrow(/stays deleted/);
  });

  it.each([["/apps/web"], ["apps/../.."], ["apps/web/"], ["./apps"], [""]])("rejects the package directory %j", (packageDir) => {
    expect(() => build(preparation(), { packageDir })).toThrow(/CHECK constraint failed: preview_builds_package_dir/);
  });

  it.each([
    ["a failed attempt without a reason", "attempt_state = 'failed'"],
    ["a partly published artifact", "artifact = 'out-1'"],
    ["an artifact from a later attempt", "artifact = 'out-2', artifact_attempt = 2, artifact_layout = 'standalone', artifact_entry = '{}', output_bytes = 1, build_ms = 1, node_version = '22.11.0', package_manager = 'pnpm'"],
  ])("rejects %s", (_label, assignment) => {
    const preview = build(preparation());
    expect(() => run(`update preview_builds set ${assignment} where public_id = ?`, preview)).toThrow(/CHECK constraint failed/);
  });

  it("records a decision only with its Profile and verdicts, and a failure only with its reason", () => {
    const prepared = preparation(COMMIT, "profiling");
    expect(() => run("update preview_preparations set state = 'ready', finished_at = ? where id = ?", T0, prepared)).toThrow(/CHECK constraint failed: preview_preparations_decided/);
    expect(() => run("update preview_preparations set state = 'failed', finished_at = ? where id = ?", T0, prepared)).toThrow(/CHECK constraint failed: preview_preparations_failed/);
    expect(() => run("update preview_preparations set commit_sha = ? where id = ?", OTHER_COMMIT, prepared)).toThrow(/keeps its Repository, commit, and ref/);
  });
});
