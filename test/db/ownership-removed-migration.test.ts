import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";

/*
 * Migration 0043 (prune-and-consolidate-code, design decision 4): ownership
 * goes. Its tables and the ontology's are dropped, every Assessment created
 * for a claim is deleted with its Runs and their results, and initiatives
 * lose the column that named a claim's repository. An operator's Assessment
 * and its Run are untouched.
 */

const BEFORE = "0042_repository_previews";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const T0 = 1_790_000_000_000;

const DROPPED = ["ownership_assertions", "ownership_supersessions", "applications", "lines_of_business", "portals", "de_console_reads", "de_console_links", "de_console_conflicts", "concept_classifications", "ontology_releases", "ontology_concepts"];

describe("ownership removed migration", () => {
  let db: Db;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const all = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).all(...values);
  const count = (table: string) => (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  const objects = (type: string) => (all("select name from sqlite_master where type = ?", type) as { name: string }[]).map((row) => row.name);

  /** A Run of +initiative+ over +source+ with one acquired target, numbered +n+ for its public IDs. */
  function seedRun(initiative: number, source: number, n: number) {
    const suffix = String(n).padStart(16, "0");
    const assessment = Number(
      run(
        "insert into assessments (public_id, initiative_id, launch_token, detector_release, configuration, configuration_digest, profile_schema_version, relationship_schema_version, created_at, updated_at) values (?, ?, ?, 'r1', '{}', ?, 2, 1, ?, ?)",
        `asm_${suffix}`,
        initiative,
        `4a6e3b0c-6a43-4e0f-9a59-${String(n).padStart(12, "0")}`,
        "d".repeat(64),
        T0,
        T0,
      ).lastInsertRowid,
    );
    const target = Number(
      run(
        "insert into assessment_targets (public_id, assessment_id, repository_source_id, position, source_public_id, source_name, clone_url, canonical_url, git_ref, created_at, updated_at) select ?, ?, id, 0, public_id, name, clone_url, canonical_url, 'main', ?, ? from repository_sources where id = ?",
        `tgt_${suffix}`,
        assessment,
        T0,
        T0,
        source,
      ).lastInsertRowid,
    );
    run("update assessment_targets set state = 'acquiring' where id = ?", target);
    run(
      "insert into source_snapshots (public_id, assessment_target_id, repository_source_id, commit_sha, tree_sha, ref_kind, resolved_ref, internal_ref, acquisition_metadata, acquired_at, created_at) values (?, ?, ?, ?, ?, 'branch', 'refs/heads/main', ?, '{}', ?, ?)",
      `snp_${suffix}`,
      target,
      source,
      COMMIT,
      TREE,
      `refs/fabricate/snapshots/snp_${suffix}`,
      T0,
      T0,
    );
    run("insert into jobs (kind, payload, idempotency_key, created_at, updated_at, run_after) values ('acquire_target', ?, ?, ?, ?, ?)", JSON.stringify({ assessment: `asm_${suffix}`, target: `tgt_${suffix}` }), `acquire:tgt_${suffix}`, T0, T0, T0);
  }

  beforeEach(() => {
    db = createTestDb(migrationFolderAt(BEFORE));
    for (const name of ["orders", "billing"]) {
      run("insert into repository_sources (public_id, name, clone_url, canonical_url, created_at, updated_at) values (?, ?, ?, ?, ?, ?)", `src_${name.padEnd(16, "0")}`, name, `https://git.example.com/acme/${name}.git`, `https://git.example.com/acme/${name}`, T0, T0);
    }
    // The operator's Assessment selects orders and has a Run.
    run("insert into initiatives (public_id, name, selection_mode, created_at, updated_at) values ('ini_fleet00000000000', 'Fleet', 'explicit', ?, ?)", T0, T0);
    const fleet = (db.$client.prepare("select id from initiatives where public_id = 'ini_fleet00000000000'").get() as { id: number }).id;
    run("insert into initiative_targets (initiative_id, repository_source_id, created_at) values (?, 1, ?)", fleet, T0);
    seedRun(fleet, 1, 1);
    // The Assessment created when billing was claimed, with its own Run.
    run("insert into initiatives (public_id, name, selection_mode, claim_repository_source_id, created_at, updated_at) values ('ini_claim00000000000', 'billing', 'explicit', 2, ?, ?)", T0, T0);
    const claimed = (db.$client.prepare("select id from initiatives where public_id = 'ini_claim00000000000'").get() as { id: number }).id;
    run("insert into initiative_targets (initiative_id, repository_source_id, created_at) values (?, 2, ?)", claimed, T0);
    seedRun(claimed, 2, 2);
    // Ownership values: billing's application, its Line of Business and portal, and a DE Console read.
    run("insert into applications (public_id, seal_id, name, created_at) values ('sea_billing000000000', '88001', 'Billing', ?)", T0);
    run("insert into lines_of_business (public_id, label, label_key, created_at) values ('lob_payments00000000', 'Payments', 'payments', ?)", T0);
    run("insert into portals (public_id, label, label_key, created_at) values ('ptl_access0000000000', 'Access', 'access', ?)", T0);
    run(
      "insert into ownership_assertions (public_id, attribute, operation, subject_repository_source_id, value_application_id, provided_by, source, verification, recorded_at) values ('own_billing000000000', 'application', 'set', 2, 1, 'ana@example.com', 'person', 'unverified', ?)",
      T0,
    );
    run("insert into de_console_reads (\"trigger\", status, read_at, applications, recorded) values ('schedule', 'succeeded', ?, 1, 0)", T0);
    migrateUpTo(db, "0043_ownership_removed");
  });
  afterEach(() => db.$client.close());

  it("drops the ownership, DE Console, and ontology tables with their triggers", () => {
    const tables = objects("table");
    for (const table of DROPPED) expect(tables, table).not.toContain(table);
    const triggers = objects("trigger");
    expect(triggers.filter((name) => /^(ownership|applications|lines_of_business|portals|de_console|concept_classifications|ontology)_/.test(name))).toEqual([]);
    expect(triggers.filter((name) => name.includes("claim"))).toEqual([]);
  });

  it("deletes the Assessment created for a claim, with its Run, targets, snapshots, and jobs", () => {
    expect(all("select public_id from initiatives order by public_id")).toEqual(expect.not.arrayContaining([{ public_id: "ini_claim00000000000" }]));
    expect(all("select public_id from assessments")).toEqual([{ public_id: "asm_0000000000000001" }]);
    expect(all("select public_id from assessment_targets")).toEqual([{ public_id: "tgt_0000000000000001" }]);
    expect(all("select public_id from source_snapshots")).toEqual([{ public_id: "snp_0000000000000001" }]);
    expect(all("select json_extract(payload, '$.assessment') as assessment from jobs")).toEqual([{ assessment: "asm_0000000000000001" }]);
    // The claimed repository stays in the catalog.
    expect(count("repository_sources")).toBe(2);
  });

  it("keeps the operator's Assessment, its selection, and its Run, and drops the claim column", () => {
    expect(all("select public_id, name, selection_mode from initiatives where public_id = 'ini_fleet00000000000'")).toEqual([{ public_id: "ini_fleet00000000000", name: "Fleet", selection_mode: "explicit" }]);
    expect(all("select r.public_id from initiative_targets t join repository_sources r on r.id = t.repository_source_id join initiatives i on i.id = t.initiative_id where i.public_id = 'ini_fleet00000000000'")).toEqual([{ public_id: "src_orders0000000000" }]);
    expect((all("select name from pragma_table_info('initiatives')") as { name: string }[]).map((column) => column.name)).not.toContain("claim_repository_source_id");
    expect(all("select * from pragma_foreign_key_check")).toEqual([]);
  });

  it("keeps the initiative guards that still apply", () => {
    expect(() => run("delete from assessments where public_id = 'asm_0000000000000001'")).toThrow(/retained/);
    expect(() => run("update initiatives set public_id = 'ini_other00000000000' where public_id = 'ini_fleet00000000000'")).toThrow(/public identity/);
    expect(() => run("insert into initiatives (public_id, name, profiling, created_at, updated_at) values ('ini_profiling0000000', 'Mine', 1, ?, ?)", T0, T0)).toThrow(/profiling/);
    const every = Number(run("insert into initiatives (public_id, name, selection_mode, created_at, updated_at) values ('ini_every00000000000', 'Every', 'all', ?, ?)", T0, T0).lastInsertRowid);
    expect(() => run("insert into initiative_targets (initiative_id, repository_source_id, created_at) values (?, 2, ?)", every, T0)).toThrow(/explicit/);
  });
});
