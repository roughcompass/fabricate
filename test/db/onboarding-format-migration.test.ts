import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { type Db, MIGRATIONS_FOLDER, migrateDatabase } from "@/lib/db/client";
import { V1_FIXTURE, migratedV1Database, normalizedCounts, revisionDigests, v1Database, v1Snapshot, verifyV1Fixture } from "../support/onboarding-v1";

/*
 * The onboarding v1 fixture, pinned before revision format versions exist:
 * every revision's ID and digest, the frozen rows of each submitted
 * revision, and the placements, decisions, and routes between them. The
 * format-version migration must carry all of it unchanged.
 */

export const PINNED = {
  digests: {
    portal_revisions: [
      { id: 1, number: 1, state: "submitted", digest: "91e35fd3bd16a194fe6a3dda83146a8f2a3a3dc5c37508a76d7b352a7613c610" },
      { id: 2, number: 1, state: "submitted", digest: "e8c8570d46a4ab2eb217ced1fd1882f2c5ea417a0c8c480bf1e0588c1037bfab" },
      { id: 3, number: 2, state: "draft", digest: null },
      { id: 4, number: 1, state: "draft", digest: null },
    ],
    application_revisions: [
      { id: 1, number: 1, state: "submitted", digest: "24c9dc7c2c0454371a49893a1f0007a10bd875d2dcadabb840be3c6169cbd2eb" },
      { id: 2, number: 1, state: "submitted", digest: "dd08c405046e6b5a0d2c859f9957cb35e17c5a5da55eae8bf850a6397cca0c26" },
      { id: 3, number: 1, state: "submitted", digest: "ada12b421456890f97bd98baf6267dde271ed73c49db0582867a1993f19e5ce6" },
      { id: 4, number: 2, state: "draft", digest: null },
    ],
    microfrontend_revisions: [
      { id: 1, number: 1, state: "submitted", digest: "6b241052966da2eb4ef8a9d1dc23d9f6096ed07038c0bbdbb79355ef6285329f" },
      { id: 2, number: 1, state: "submitted", digest: "6f995d639d96b374f42ee2e4fac247989b6909d471743e49587208779ee83090" },
      { id: 3, number: 2, state: "draft", digest: null },
      { id: 4, number: 1, state: "draft", digest: null },
    ],
  },
  normalized: {
    portal_environments: [
      { revision: 1, rows: 2 },
      { revision: 2, rows: 2 },
    ],
    portal_menu_groups: [
      { revision: 1, rows: 1 },
      { revision: 2, rows: 1 },
    ],
    application_environments: [
      { revision: 1, rows: 2 },
      { revision: 2, rows: 2 },
      { revision: 3, rows: 2 },
    ],
    application_launch_targets: [
      { revision: 1, rows: 1 },
      { revision: 2, rows: 1 },
      { revision: 3, rows: 1 },
    ],
    rendering_inference_candidates: [{ revision: 1, rows: 1 }],
    application_components: [
      { revision: 1, rows: 2 },
      { revision: 2, rows: 1 },
    ],
    placement_requests: [
      { revision: 1, rows: 2 },
      { revision: 2, rows: 1 },
      { revision: 3, rows: 1 },
    ],
  },
  counts: {
    portal_revisions: 4,
    application_revisions: 4,
    microfrontend_revisions: 4,
    portal_environments: 4,
    portal_menu_groups: 2,
    application_environments: 6,
    application_launch_targets: 3,
    rendering_inference_candidates: 1,
    application_components: 3,
    placement_requests: 4,
    placement_request_environments: 8,
    application_placements: 4,
    placement_decisions: 4,
    placement_routes: 6,
    portal_default_routes: 2,
    onboarding_validations: 7,
    onboarding_events: 36,
    portals: 3,
    applications: 3,
    microfrontends: 3,
  },
};

const counts = (db: Db) => Object.fromEntries(Object.entries(v1Snapshot(db)).map(([table, rows]) => [table, rows.length]));

describe("onboarding v1 fixture", () => {
  let db: Db | undefined;
  afterEach(() => db?.$client.close());

  it("records every v1 revision, digest, frozen row, and relationship before format versions", () => {
    db = v1Database();

    expect(() => verifyV1Fixture(db!)).not.toThrow();
    expect(revisionDigests(db)).toEqual(PINNED.digests);
    expect(normalizedCounts(db)).toEqual(PINNED.normalized);
    expect(counts(db)).toEqual(PINNED.counts);
    // Every placement names its Application and Portal, and every decision and route its request and placement.
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
    expect(
      db.$client
        .prepare(
          "select count(*) as n from placement_decisions d join placement_requests r on r.id = d.placement_request_id and r.placement_id = d.placement_id and r.application_revision_id = d.application_revision_id join placement_routes pr on pr.decision_id = d.id",
        )
        .get(),
    ).toEqual({ n: PINNED.counts.placement_routes });
  });

  it("refuses a fixture missing what the migration must carry", () => {
    const fixture = fs
      .readFileSync(V1_FIXTURE, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith('INSERT INTO "portal_environments"'))
      .join("\n");
    db = v1Database(fixture);

    expect(() => verifyV1Fixture(db!)).toThrow(/Incomplete onboarding v1 fixture: Portal entitlements/);
  });
});

const DIGEST = "a".repeat(64);
const run = (db: Db, statement: string, ...params: unknown[]) => Number(db.$client.prepare(statement).run(...params).lastInsertRowid);
const all = (db: Db, statement: string, ...params: unknown[]) => db.$client.prepare(statement).all(...params);
const idOf = (db: Db, table: string, column: string, name: string) => (db.$client.prepare(`select id from ${table} where ${column} = ?`).get(name) as { id: number }).id;

describe("revision format-version migration", () => {
  let db: Db | undefined;
  afterEach(() => db?.$client.close());

  it("keeps every v1 revision, digest, and frozen row, marking each version 1", () => {
    const before = v1Database();
    const snapshot = v1Snapshot(before);
    before.$client.close();

    db = migratedV1Database();

    expect(v1Snapshot(db)).toEqual(snapshot);
    expect(revisionDigests(db)).toEqual(PINNED.digests);
    expect(normalizedCounts(db)).toEqual(PINNED.normalized);
    for (const table of ["portal_revisions", "application_revisions", "microfrontend_revisions"]) {
      expect(all(db, `select distinct format_version as version from ${table}`), table).toEqual([{ version: 1 }]);
    }
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
    expect(db.$client.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    // The rebuilt tables keep their guards: frozen revisions, retained rows, and rows written only before submission.
    expect(() => run(db!, "update portal_revisions set owner_team = 'Changed' where id = 1")).toThrow(/never changed/);
    expect(() => run(db!, "delete from microfrontend_revisions where id = 1")).toThrow(/retained/);
    expect(() => run(db!, "update portal_environments set enabled = 0 where id = 1")).toThrow(/never changed/);
    expect(() => run(db!, "insert into portal_environments (portal_revision_id, environment, runtime, enabled, entitlements, entitlements_digest) values (1, 'dev', 'studio-shell', 1, '{}', ?)", DIGEST)).toThrow(/frozen with it/);
    expect(() => run(db!, "update application_revisions set state = 'submitted', lock_version = lock_version + 1 where id = 4")).toThrow(/one launch target/);
  });

  it("writes every new revision in format version 2", () => {
    db = migratedV1Database();
    const markets = idOf(db, "portals", "label", "Markets");

    const revision = run(db, "insert into portal_revisions (portal_id, number, document, created_by, created_at, updated_at, based_on_revision_id) values (?, 2, '{}', 'ana', 1, 1, 2)", markets);

    expect(all(db, "select format_version as version from portal_revisions where id = ?", revision)).toEqual([{ version: 2 }]);
    const reporting = idOf(db, "applications", "name", "Payments reporting");
    expect(() => run(db!, "insert into application_revisions (application_id, number, document, created_by, created_at, updated_at, format_version) values (?, 2, '{}', 'ana', 1, 1, 1)", reporting)).toThrow(/written in format version 2/);
  });

  it("moves a v1 Draft to version 2 when it's saved, and never back", () => {
    db = migratedV1Database();
    // Revision 3 is Access's open v1 Draft.
    expect(() => run(db!, "update portal_revisions set format_version = 2 where id = 3")).toThrow(/advances its lock version/);
    run(db, "update portal_revisions set format_version = 2, lock_version = lock_version + 1 where id = 3");
    expect(() => run(db!, "update portal_revisions set format_version = 1, lock_version = lock_version + 1 where id = 3")).toThrow(/only moves from version 1 to 2/);
    expect(() => run(db!, "update portal_revisions set format_version = 3, lock_version = lock_version + 1 where id = 4")).toThrow(/only moves from version 1 to 2/);
    expect((db.$client.prepare("select sql from sqlite_master where name = 'portal_revisions'").get() as { sql: string }).sql).toContain("format_version IN (1, 2)");
  });

  it("refuses v2 revisions that carry v1 values, and v1 values without their v1 revision", () => {
    db = migratedV1Database();
    const markets = idOf(db, "portals", "label", "Markets");
    const portalRevision = run(db, "insert into portal_revisions (portal_id, number, document, created_by, created_at, updated_at, based_on_revision_id) values (?, 2, '{}', 'ana', 1, 1, 2)", markets);
    const submitPortal = (extra: string) => () => run(db!, `update portal_revisions set state = 'submitted', digest = ?, submitted_by = 'ana', submitted_at = 2, owner_team = 'Markets Platform', lock_version = lock_version + 1${extra} where id = ?`, DIGEST, portalRevision);

    expect(() => run(db!, "insert into portal_environments (portal_revision_id, environment, runtime, enabled, entitlements, entitlements_digest) values (?, 'prod', 'studio-shell', 1, '{}', ?)", portalRevision, DIGEST)).toThrow(/a v2 revision enables catalog environments/);
    expect(() => run(db!, "insert into portal_environments (portal_revision_id, environment, enabled) values (?, 'dr', 0)", portalRevision)).toThrow(/a v2 revision enables catalog environments/);
    // A v1 Draft's rows state a runtime and entitlements together.
    expect(() => run(db!, "insert into portal_environments (portal_revision_id, environment, runtime, enabled) values (3, 'prod', 'studio-shell', 1)")).toThrow(/portal_environments_legacy/);
    expect(() => run(db!, "insert into portal_environments (portal_revision_id, environment, enabled) values (3, 'prod', 1)")).toThrow(/a v1 revision states both/);
    run(db, "insert into portal_environments (portal_revision_id, environment, enabled) values (?, 'prod', 1)", portalRevision);
    expect(submitPortal(", runtimes = '[]', contract = '{}', contract_digest = '" + DIGEST + "', environment_catalog_source = 'fallback', environment_catalog_digest = '" + DIGEST + "'")).toThrow(/portal_revisions_frozen/);
    expect(submitPortal("")).toThrow(/portal_revisions_frozen/);
    expect(submitPortal(", environment_catalog_source = 'spreadsheet', environment_catalog_digest = '" + DIGEST + "'")).toThrow(/portal_revisions_frozen/);
    submitPortal(", environment_catalog_source = 'fallback', environment_catalog_digest = '" + DIGEST + "'")();

    const reporting = idOf(db, "applications", "name", "Payments reporting");
    const applicationRevision = run(db, "insert into application_revisions (application_id, number, document, created_by, created_at, updated_at, based_on_revision_id) values (?, 2, '{}', 'ana', 1, 1, 2)", reporting);
    expect(() => run(db!, "insert into application_environments (application_revision_id, environment) values (?, 'prod')", applicationRevision)).toThrow(/only a v1 revision has global environments/);
    expect(() =>
      run(db!, "insert into application_launch_targets (application_revision_id, kind, rendering_mode, document_url, host_contract, host_contract_digest, confirmation, confirmed_by, confirmed_at) values (?, 'external', 'iframe', 'https://payments.example.com/reports', '{}', ?, 'explicit', 'ana', 1)", applicationRevision, DIGEST),
    ).toThrow(/only a v1 revision has an external host contract/);
    run(db, "insert into application_launch_targets (application_revision_id, kind, rendering_mode, document_url, confirmation, confirmed_by, confirmed_at) values (?, 'external', 'iframe', 'https://payments.example.com/reports', 'explicit', 'ana', 1)", applicationRevision);
    const search = idOf(db, "microfrontends", "name", "Payee search");
    expect(() => run(db!, "insert into application_components (application_revision_id, microfrontend_id, role, mount_kind, mount_key, required, host_configuration) values (?, ?, 'child', 'slot', 'search', 1, '{\"pageSize\":25}')", applicationRevision, search)).toThrow(/passes no host configuration/);
    run(db, "insert into application_components (application_revision_id, microfrontend_id, role, mount_kind, mount_key, required, module) values (?, ?, 'child', 'slot', 'search', 1, './Widget')", applicationRevision, search);
    const submitApplication = (extra: string) => () => run(db!, `update application_revisions set state = 'submitted', digest = ?, submitted_by = 'ana', submitted_at = 2, name = 'Payments reporting', owner_team = 'Payments', lock_version = lock_version + 1${extra} where id = ?`, DIGEST, applicationRevision);
    expect(submitApplication(", required_capabilities = '[]', environment_catalog_source = 'fallback', environment_catalog_digest = '" + DIGEST + "'")).toThrow(/application_revisions_frozen/);
    submitApplication(", environment_catalog_source = 'studio', environment_catalog_digest = '" + DIGEST + "'")();

    const frames = idOf(db, "microfrontends", "name", "Payee frames");
    const source = (db.$client.prepare("select id from repository_sources order by id limit 1").get() as { id: number }).id;
    const mfeRevision = 4;
    run(db, "update microfrontend_revisions set format_version = 2, lock_version = lock_version + 1 where id = ? and microfrontend_id = ?", mfeRevision, frames);
    const submitMfe = (extra: string) => () => run(db!, `update microfrontend_revisions set state = 'submitted', digest = ?, submitted_by = 'ana', submitted_at = 2, name = 'Payee frames', owner_team = 'Payee', repository_source_id = ?, lock_version = lock_version + 1${extra} where id = ?`, DIGEST, source, mfeRevision);
    expect(submitMfe(", contract = '{}', contract_digest = '" + DIGEST + "'")).toThrow(/microfrontend_revisions_frozen/);
    expect(submitMfe("")).toThrow(/microfrontend_revisions_frozen/);
    expect(submitMfe(", rendering = '[]'")).toThrow(/microfrontend_revisions_frozen/);
    submitMfe(", rendering = '{\"esm\":{\"exports\":[\"./Frames\"]}}'")();
  });

  it("rolls the whole migration back when a copied reference is broken", () => {
    db = v1Database();
    db.$client.pragma("foreign_keys = OFF");
    run(db, "insert into onboarding_validations (subject, portal_revision_id, document_digest, blocking, issues, evaluated_at) values ('portal', 999, ?, 0, '[]', 1)", DIGEST);
    db.$client.pragma("foreign_keys = ON");

    let failure: unknown;
    try {
      migrateDatabase(db, MIGRATIONS_FOLDER);
    } catch (error) {
      failure = error;
    }
    expect(String((failure as Error | undefined)?.cause)).toMatch(/CHECK constraint failed: violations = 0/);
    expect((db.$client.prepare("pragma table_info(portal_revisions)").all() as { name: string }[]).map((column) => column.name)).not.toContain("format_version");
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});
