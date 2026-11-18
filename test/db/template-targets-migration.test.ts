import { describe, expect, it } from "vitest";
import { type Db, MIGRATIONS_FOLDER, migrateDatabase, openDatabase } from "@/lib/db/client";
import { SALT_PATTERNS_INITIATIVE_ID } from "@/lib/initiatives/initiative-records";
import { migrationFolderAt } from "../support/onboarding-v1";

/*
 * Migration 0028 (converge-templates-and-prototypes, design decision 2):
 * assessment targets gain a kind, template targets record a template
 * version's identity and content digest instead of a catalog source, and the
 * migration seeds the system-owned Salt Patterns initiative. Existing
 * assessments carry over unchanged, as source targets.
 */

const BEFORE = "0027_onboarding_format_version_triggers";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const DIGEST = "c".repeat(40);
const T0 = 1_780_000_000_000;

function databaseAt(tag: string): Db {
  const db = openDatabase(":memory:");
  migrateDatabase(db, migrationFolderAt(tag));
  return db;
}

function triggers(db: Db): Map<string, string> {
  const rows = db.$client.prepare("select name, sql from sqlite_master where type = 'trigger'").all() as { name: string; sql: string }[];
  return new Map(rows.map((row) => [row.name, row.sql]));
}

/** A source, an explicit initiative selecting it, and one assessment whose target was acquired, written at the schema before 0028. */
function seedExistingAssessment(db: Db): void {
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  run("insert into repository_sources (public_id, name, clone_url, canonical_url, created_at, updated_at) values ('src_orders0000000000', 'orders', 'https://git.example/orders.git', 'git.example/orders', ?, ?)", T0, T0);
  run("insert into initiatives (public_id, name, selection_mode, created_at, updated_at) values ('ini_fleet00000000000', 'Fleet', 'explicit', ?, ?)", T0, T0);
  run("insert into initiative_targets (initiative_id, repository_source_id, created_at) values (1, 1, ?)", T0);
  run(
    "insert into assessments (public_id, initiative_id, launch_token, detector_release, configuration, configuration_digest, profile_schema_version, relationship_schema_version, created_at, updated_at) values ('asm_fleet00000000000', 1, '4a6e3b0c-6a43-4e0f-9a59-9a2d0f2a8e11', 'r1', '{}', ?, 1, 1, ?, ?)",
    "d".repeat(64),
    T0,
    T0,
  );
  run(
    "insert into assessment_targets (public_id, assessment_id, repository_source_id, position, source_public_id, source_name, clone_url, canonical_url, git_ref, created_at, updated_at) values ('tgt_orders0000000000', 1, 1, 0, 'src_orders0000000000', 'orders', 'https://git.example/orders.git', 'git.example/orders', 'main', ?, ?)",
    T0,
    T0,
  );
  run("update assessment_targets set state = 'acquiring' where id = 1");
  run(
    "insert into source_snapshots (public_id, assessment_target_id, repository_source_id, commit_sha, tree_sha, ref_kind, resolved_ref, internal_ref, acquisition_metadata, acquired_at, created_at) values ('snp_orders0000000000', 1, 1, ?, ?, 'branch', 'refs/heads/main', 'refs/fabricate/snapshots/snp_orders0000000000', '{}', ?, ?)",
    COMMIT,
    TREE,
    T0,
    T0,
  );
}

/** Starts a queued assessment under +initiativeId+ and returns its id and timestamp. */
function startAssessment(db: Db, initiativeId: number, suffix: string): { id: number; at: number } {
  const at = T0 + 1_000;
  const { lastInsertRowid } = db.$client
    .prepare(
      "insert into assessments (public_id, initiative_id, launch_token, detector_release, configuration, configuration_digest, profile_schema_version, relationship_schema_version, created_at, updated_at) values (?, ?, ?, 'r1', '{}', ?, 2, 1, ?, ?)",
    )
    .run(`asm_${suffix.padEnd(16, "0")}`, initiativeId, `4a6e3b0c-6a43-4e0f-9a59-${suffix.padEnd(12, "0")}`, "d".repeat(64), at, at);
  return { id: Number(lastInsertRowid), at };
}

function insertTemplateTarget(db: Db, assessment: { id: number; at: number }, overrides: Record<string, unknown> = {}) {
  const values = {
    public_id: "tgt_template00000000",
    assessment_id: assessment.id,
    kind: "template",
    position: 0,
    source_public_id: "ptp_payments00000000",
    source_name: "Payments",
    template_public_id: "ptp_payments00000000",
    template_version_public_id: "ptv_payments00000000",
    template_version_number: 1,
    prototype_version_public_id: "ver_payments00000000",
    content_digest: DIGEST,
    created_at: assessment.at,
    updated_at: assessment.at,
    ...overrides,
  };
  const columns = Object.keys(values);
  return db.$client.prepare(`insert into assessment_targets (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`).run(...Object.values(values));
}

describe("migration 0028: template targets", () => {
  it("seeds the Salt Patterns initiative on a fresh database and keeps every earlier trigger", () => {
    const before = triggers(databaseAt(BEFORE));
    // Later migrations rebuild and drop onboarding's tables, so the triggers are compared right after 0028.
    const db = databaseAt("0028_template_targets");

    expect(db.$client.prepare("select public_id, name, selection_mode, system_owned, claim_repository_source_id from initiatives").all()).toEqual([
      { public_id: SALT_PATTERNS_INITIATIVE_ID, name: "Salt Patterns", selection_mode: "explicit", system_owned: 1, claim_repository_source_id: null },
    ]);
    const after = triggers(db);
    const changed = ["assessment_targets_scope_immutable", "source_snapshots_match_target"];
    for (const [name, sql] of before) {
      expect(after.has(name), name).toBe(true);
      if (!changed.includes(name)) expect(after.get(name), name).toBe(sql);
    }
    for (const name of ["assessment_targets_kind_matches_initiative", "initiatives_system_owned_insert", "initiatives_system_owned_kept", "initiatives_system_owned_never_deleted", "initiative_targets_not_system_owned"]) {
      expect(after.has(name), name).toBe(true);
    }
    expect(db.$client.prepare("select count(*) as violations from pragma_foreign_key_check").get()).toEqual({ violations: 0 });
  });

  it("reads existing assessment targets back as source targets, with their snapshots unchanged", () => {
    const db = databaseAt(BEFORE);
    seedExistingAssessment(db);
    const snapshotBefore = db.$client.prepare("select * from source_snapshots").all();
    const initiativeBefore = db.$client.prepare("select * from initiatives").get() as Record<string, unknown>;

    migrateDatabase(db, MIGRATIONS_FOLDER);

    expect(db.$client.prepare("select public_id, kind, repository_source_id, clone_url, canonical_url, git_ref, state, template_public_id, template_version_public_id, template_version_number, prototype_version_public_id, content_digest from assessment_targets").all()).toEqual([
      {
        public_id: "tgt_orders0000000000",
        kind: "source",
        repository_source_id: 1,
        clone_url: "https://git.example/orders.git",
        canonical_url: "git.example/orders",
        git_ref: "main",
        state: "acquiring",
        template_public_id: null,
        template_version_public_id: null,
        template_version_number: null,
        prototype_version_public_id: null,
        content_digest: null,
      },
    ]);
    expect(db.$client.prepare("select * from source_snapshots").all()).toEqual(snapshotBefore);
    expect(db.$client.prepare("select * from initiatives where public_id = 'ini_fleet00000000000'").get()).toEqual({ ...initiativeBefore, system_owned: 0, profiling: 0 });
    expect(db.$client.prepare("select count(*) as n from initiative_targets").get()).toEqual({ n: 1 });
    // The carried-over target still obeys its rules.
    expect(() => db.$client.prepare("update assessment_targets set clone_url = 'https://elsewhere.example/x.git'").run()).toThrow(/scope snapshot cannot change/);
    expect(() => db.$client.prepare("delete from assessment_targets").run()).toThrow(/cannot be deleted/);
  });

  describe("after the migration", () => {
    function migrated() {
      const db = openDatabase(":memory:");
      migrateDatabase(db, MIGRATIONS_FOLDER);
      const salt = (db.$client.prepare("select id from initiatives where system_owned = 1").get() as { id: number }).id;
      const fleet = Number(db.$client.prepare("insert into initiatives (public_id, name, selection_mode, created_at, updated_at) values ('ini_fleet00000000000', 'Fleet', 'explicit', ?, ?)").run(T0, T0).lastInsertRowid);
      return { db, salt, fleet };
    }

    it("records a template target under Salt Patterns, pinned to its content digest", () => {
      const { db, salt } = migrated();
      const assessment = startAssessment(db, salt, "salt");
      insertTemplateTarget(db, assessment);
      db.$client.prepare("update assessment_targets set state = 'acquiring'").run();

      const snapshot = (tree: string, id: string) =>
        db.$client
          .prepare(
            "insert into source_snapshots (public_id, assessment_target_id, repository_source_id, commit_sha, tree_sha, ref_kind, resolved_ref, internal_ref, acquisition_metadata, acquired_at, created_at) values (?, 1, null, null, ?, 'stored_files', 'ptv_payments00000000', ?, '{}', ?, ?)",
          )
          .run(id, tree, `refs/fabricate/snapshots/${id}`, T0, T0);
      expect(() => snapshot(TREE, "snp_wrongtree0000000")).toThrow(/recorded for its acquiring target/);
      snapshot(DIGEST, "snp_template00000000");

      expect(db.$client.prepare("select kind, repository_source_id, content_digest from assessment_targets").get()).toEqual({ kind: "template", repository_source_id: null, content_digest: DIGEST });
      expect(() => db.$client.prepare("update assessment_targets set content_digest = ?").run("e".repeat(40))).toThrow(/scope snapshot cannot change/);
      expect(() => db.$client.prepare("update assessment_targets set template_version_number = 2").run()).toThrow(/scope snapshot cannot change/);
    });

    it("refuses a template target outside Salt Patterns and a catalog source inside it", () => {
      const { db, salt, fleet } = migrated();
      expect(() => insertTemplateTarget(db, startAssessment(db, fleet, "fleet"))).toThrow(/Salt Patterns initiative only/);

      db.$client.prepare("insert into repository_sources (public_id, name, clone_url, canonical_url, created_at, updated_at) values ('src_orders0000000000', 'orders', 'https://git.example/orders.git', 'git.example/orders', ?, ?)").run(T0, T0);
      const assessment = startAssessment(db, salt, "salt");
      expect(() =>
        db.$client
          .prepare(
            "insert into assessment_targets (public_id, assessment_id, repository_source_id, position, source_public_id, source_name, clone_url, canonical_url, created_at, updated_at) values ('tgt_orders0000000000', ?, 1, 0, 'src_orders0000000000', 'orders', 'https://git.example/orders.git', 'git.example/orders', ?, ?)",
          )
          .run(assessment.id, assessment.at, assessment.at),
      ).toThrow(/Salt Patterns initiative only/);
      expect(() => db.$client.prepare("insert into initiative_targets (initiative_id, repository_source_id, created_at) values (?, 1, ?)").run(salt, T0)).toThrow(/assesses template versions/);
    });

    it("holds a template target to a prototype version, a content digest, and a whole template identity or none", () => {
      const { db, salt } = migrated();
      const assessment = startAssessment(db, salt, "salt");
      expect(() => insertTemplateTarget(db, assessment, { content_digest: "short" })).toThrow(/CHECK constraint failed: assessment_targets_kind_columns/);
      expect(() => insertTemplateTarget(db, assessment, { content_digest: null })).toThrow(/assessment_targets_kind_columns/);
      expect(() => insertTemplateTarget(db, assessment, { prototype_version_public_id: null })).toThrow(/assessment_targets_kind_columns/);
      expect(() => insertTemplateTarget(db, assessment, { template_version_public_id: null })).toThrow(/assessment_targets_kind_columns/);
      expect(() => insertTemplateTarget(db, assessment, { clone_url: "https://git.example/x.git" })).toThrow(/assessment_targets_kind_columns/);

      // A first acceptance assesses the version before its template exists.
      insertTemplateTarget(db, assessment, { template_public_id: null, template_version_public_id: null, template_version_number: null });
      expect(db.$client.prepare("select template_public_id, prototype_version_public_id from assessment_targets").get()).toEqual({ template_public_id: null, prototype_version_public_id: "ver_payments00000000" });
    });

    it("refuses template columns on a source target", () => {
      const { db, fleet } = migrated();
      db.$client.prepare("insert into repository_sources (public_id, name, clone_url, canonical_url, created_at, updated_at) values ('src_orders0000000000', 'orders', 'https://git.example/orders.git', 'git.example/orders', ?, ?)").run(T0, T0);
      const assessment = startAssessment(db, fleet, "fleet");
      expect(() =>
        db.$client
          .prepare(
            "insert into assessment_targets (public_id, assessment_id, repository_source_id, position, source_public_id, source_name, clone_url, canonical_url, prototype_version_public_id, created_at, updated_at) values ('tgt_orders0000000000', ?, 1, 0, 'src_orders0000000000', 'orders', 'https://git.example/orders.git', 'git.example/orders', 'ver_payments00000000', ?, ?)",
          )
          .run(assessment.id, assessment.at, assessment.at),
      ).toThrow(/assessment_targets_kind_columns/);
    });

    it("keeps Salt Patterns' name, objective, and scope, and never deletes it, while its Releases can change", () => {
      const { db, salt } = migrated();
      expect(() => db.$client.prepare("update initiatives set name = 'Renamed' where id = ?").run(salt)).toThrow(/keeps its name, objective, and scope/);
      expect(() => db.$client.prepare("update initiatives set objective = '' where id = ?").run(salt)).toThrow(/keeps its name, objective, and scope/);
      expect(() => db.$client.prepare("update initiatives set selection_mode = 'all' where id = ?").run(salt)).toThrow(/keeps its name, objective, and scope/);
      expect(() => db.$client.prepare("update initiatives set system_owned = 0 where id = ?").run(salt)).toThrow(/keeps its name, objective, and scope/);
      expect(() => db.$client.prepare("delete from initiatives where id = ?").run(salt)).toThrow(/is retained/);
      expect(() => db.$client.prepare("update initiatives set system_owned = 1 where public_id = 'ini_fleet00000000000'").run()).toThrow(/keeps its name, objective, and scope/);
      expect(() => db.$client.prepare("insert into initiatives (public_id, name, selection_mode, system_owned, created_at, updated_at) values ('ini_another000000000', 'Another', 'explicit', 1, ?, ?)").run(T0, T0)).toThrow(/only DE FabLab creates/);

      // Selecting Releases bumps the lock version, which is allowed.
      db.$client.prepare("update initiatives set lock_version = lock_version + 1, updated_at = ? where id = ?").run(T0 + 5, salt);
      expect(db.$client.prepare("select lock_version from initiatives where id = ?").get(salt)).toEqual({ lock_version: 1 });
    });
  });
});
