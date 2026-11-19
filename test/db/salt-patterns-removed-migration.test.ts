import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";

/*
 * Migration 0044 (prune-and-consolidate-code, design decision 5): the Salt
 * Patterns initiative goes with its Runs and their results, and template
 * targets, their stored files, and the initiative flag that marked it go with
 * it. A Git Run beside it is untouched.
 */

const BEFORE = "0043_ownership_removed";
const SALT_PATTERNS = "ini_saltpatterns0000";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const DIGEST = "c".repeat(40);
const T0 = 1_790_000_000_000;

describe("Salt Patterns removed migration", () => {
  let db: Db;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const all = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).all(...values);
  const columns = (table: string) => (all(`select name from pragma_table_info('${table}')`) as { name: string }[]).map((column) => column.name);
  const triggers = () => (all("select name from sqlite_master where type = 'trigger'") as { name: string }[]).map((row) => row.name);

  /** A queued Run of +initiative+ numbered +n+, and its id. */
  function startRun(initiative: number, n: number): number {
    return Number(
      run(
        "insert into assessments (public_id, initiative_id, launch_token, detector_release, configuration, configuration_digest, profile_schema_version, relationship_schema_version, created_at, updated_at) values (?, ?, ?, 'r1', '{}', ?, 2, 1, ?, ?)",
        `asm_${String(n).padStart(16, "0")}`,
        initiative,
        `4a6e3b0c-6a43-4e0f-9a59-${String(n).padStart(12, "0")}`,
        "d".repeat(64),
        T0,
        T0,
      ).lastInsertRowid,
    );
  }

  beforeEach(() => {
    db = createTestDb(migrationFolderAt(BEFORE));
    const salt = (db.$client.prepare("select id from initiatives where public_id = ?").get(SALT_PATTERNS) as { id: number }).id;

    // A Salt Patterns Run of one template version, its stored files, and their snapshot.
    const saltRun = startRun(salt, 1);
    run(
      "insert into assessment_targets (public_id, assessment_id, kind, position, source_public_id, source_name, template_public_id, template_version_public_id, template_version_number, prototype_version_public_id, content_digest, created_at, updated_at) values ('tgt_template00000000', ?, 'template', 0, 'ptp_payments00000000', 'Payments', 'ptp_payments00000000', 'ptv_payments00000000', 1, 'ver_payments00000000', ?, ?, ?)",
      saltRun,
      DIGEST,
      T0,
      T0,
    );
    run("insert into stored_file_sets (assessment_target_id, digest, files, created_at) select id, ?, '{}', ? from assessment_targets where public_id = 'tgt_template00000000'", DIGEST, T0);
    run("update assessment_targets set state = 'acquiring' where public_id = 'tgt_template00000000'");
    run(
      "insert into source_snapshots (public_id, assessment_target_id, commit_sha, tree_sha, ref_kind, resolved_ref, internal_ref, acquisition_metadata, acquired_at, created_at) select 'snp_template00000000', id, null, ?, 'stored_files', 'stored files', 'refs/fabricate/snapshots/snp_template00000000', '{}', ?, ? from assessment_targets where public_id = 'tgt_template00000000'",
      DIGEST,
      T0,
      T0,
    );
    run("insert into jobs (kind, payload, idempotency_key, created_at, updated_at, run_after) values ('analyze_target', ?, 'analyze:tgt_template00000000', ?, ?, ?)", JSON.stringify({ assessment: "asm_0000000000000001", target: "tgt_template00000000" }), T0, T0, T0);

    // A Git Run of an operator's Assessment, acquired.
    run("insert into repository_sources (public_id, name, clone_url, canonical_url, created_at, updated_at) values ('src_orders0000000000', 'orders', 'https://git.example.com/acme/orders.git', 'https://git.example.com/acme/orders', ?, ?)", T0, T0);
    run("insert into initiatives (public_id, name, selection_mode, created_at, updated_at) values ('ini_fleet00000000000', 'Fleet', 'all', ?, ?)", T0, T0);
    const fleet = (db.$client.prepare("select id from initiatives where public_id = 'ini_fleet00000000000'").get() as { id: number }).id;
    const gitRun = startRun(fleet, 2);
    run(
      "insert into assessment_targets (public_id, assessment_id, repository_source_id, position, source_public_id, source_name, clone_url, canonical_url, git_ref, created_at, updated_at) values ('tgt_orders0000000000', ?, 1, 0, 'src_orders0000000000', 'orders', 'https://git.example.com/acme/orders.git', 'https://git.example.com/acme/orders', 'main', ?, ?)",
      gitRun,
      T0,
      T0,
    );
    run("update assessment_targets set state = 'acquiring' where public_id = 'tgt_orders0000000000'");
    run(
      "insert into source_snapshots (public_id, assessment_target_id, repository_source_id, commit_sha, tree_sha, ref_kind, resolved_ref, internal_ref, acquisition_metadata, acquired_at, created_at) select 'snp_orders0000000000', id, 1, ?, ?, 'branch', 'refs/heads/main', 'refs/fabricate/snapshots/snp_orders0000000000', '{}', ?, ? from assessment_targets where public_id = 'tgt_orders0000000000'",
      COMMIT,
      TREE,
      T0,
      T0,
    );
    migrateUpTo(db, "0044_salt_patterns_removed");
  });
  afterEach(() => db.$client.close());

  it("deletes the Salt Patterns initiative with its Run, template target, stored files, snapshot, and jobs", () => {
    expect(all("select public_id from initiatives where public_id = ?", SALT_PATTERNS)).toEqual([]);
    expect(all("select public_id from assessments")).toEqual([{ public_id: "asm_0000000000000002" }]);
    expect(all("select public_id from assessment_targets")).toEqual([{ public_id: "tgt_orders0000000000" }]);
    expect(all("select public_id from source_snapshots")).toEqual([{ public_id: "snp_orders0000000000" }]);
    expect(all("select name from sqlite_master where name = 'stored_file_sets'")).toEqual([]);
    expect(all("select * from jobs")).toEqual([]);
  });

  it("keeps the Git Run, its target, and its snapshot untouched", () => {
    expect(all("select public_id, repository_source_id, clone_url, canonical_url, git_ref, state from assessment_targets")).toEqual([
      { public_id: "tgt_orders0000000000", repository_source_id: 1, clone_url: "https://git.example.com/acme/orders.git", canonical_url: "https://git.example.com/acme/orders", git_ref: "main", state: "acquiring" },
    ]);
    expect(all("select public_id, repository_source_id, commit_sha, tree_sha, ref_kind from source_snapshots")).toEqual([{ public_id: "snp_orders0000000000", repository_source_id: 1, commit_sha: COMMIT, tree_sha: TREE, ref_kind: "branch" }]);
    expect(all("select public_id, name, selection_mode from initiatives where public_id = 'ini_fleet00000000000'")).toEqual([{ public_id: "ini_fleet00000000000", name: "Fleet", selection_mode: "all" }]);
    expect(all("select * from pragma_foreign_key_check")).toEqual([]);
  });

  it("drops the template columns, the target kind, and the Salt Patterns flag and triggers", () => {
    expect(columns("assessment_targets")).not.toEqual(expect.arrayContaining(["kind"]));
    for (const column of ["kind", "template_public_id", "template_version_public_id", "template_version_number", "prototype_version_public_id", "content_digest"]) expect(columns("assessment_targets"), column).not.toContain(column);
    expect(columns("initiatives")).not.toContain("system_owned");
    expect(triggers().filter((name) => /system_owned|kind_matches|stored_file_sets/.test(name))).toEqual([]);
  });

  it("keeps the rules that still apply to targets and snapshots", () => {
    expect(() => run("delete from assessment_targets")).toThrow(/retained/);
    expect(() => run("delete from source_snapshots")).toThrow(/retained/);
    expect(() => run("update assessment_targets set clone_url = 'https://elsewhere.example/x.git'")).toThrow(/scope snapshot cannot change/);
    expect(() => run("update source_snapshots set tree_sha = ?", "e".repeat(40))).toThrow(/immutable/);
    // A snapshot is always a commit of a catalog repository.
    expect(() =>
      run(
        "insert into source_snapshots (public_id, assessment_target_id, repository_source_id, commit_sha, tree_sha, ref_kind, resolved_ref, internal_ref, acquisition_metadata, acquired_at, created_at) select 'snp_other00000000000', id, 1, null, ?, 'branch', 'x', 'refs/fabricate/snapshots/snp_other00000000000', '{}', ?, ? from assessment_targets",
        TREE,
        T0,
        T0,
      ),
    ).toThrow(/NOT NULL/);
    expect(() => run("insert into initiatives (public_id, name, profiling, created_at, updated_at) values ('ini_profiling0000000', 'Mine', 1, ?, ?)", T0, T0)).toThrow(/profiling/);
  });
});
