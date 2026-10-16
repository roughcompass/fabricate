import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, MIGRATIONS_FOLDER, migrateDatabase, openDatabase } from "@/lib/db/client";
import { createWebApplication, getApplication, placementCandidates } from "@/lib/onboarding/applications";
import { createPortal, getPortal, savePortalDraft, submitPortal } from "@/lib/onboarding/portals";
import { applicationsWithSealId } from "@/lib/ownership/records";
import { ana, portalDraft, portalInput } from "../support/onboarding";

const PRE_ONBOARDING_MIGRATION = "0021_claim_initiative_triggers";
const FIXTURE = path.resolve("test/fixtures/onboarding/ownership-before-onboarding.sql");

const EXPECTED = {
  applicationIds: [201, 202],
  portalIds: [401],
  assertionIds: [501, 502, 503, 504, 505, 506, 507],
  supersessions: [{ assertionId: 503, supersededId: 502 }],
  counts: { applications: 2, portals: 1, assertions: 7, supersessions: 1 },
};

function migrationFolderAt(tag: string): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-onboarding-migrations-"));
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { idx: number; tag: string }[] };
  const selected = journal.entries.find((entry) => entry.tag === tag);
  if (!selected) throw new Error(`Migration ${tag} does not exist`);
  for (const entry of journal.entries.filter((candidate) => candidate.idx > selected.idx)) fs.rmSync(path.join(folder, `${entry.tag}.sql`), { force: true });
  journal.entries = journal.entries.filter((entry) => entry.idx <= selected.idx);
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}

function snapshot(db: Db) {
  const ids = (table: string) => (db.$client.prepare(`select id from ${table} order by id`).all() as { id: number }[]).map((row) => row.id);
  const count = (table: string) => (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  return {
    applicationIds: ids("seal_applications"),
    portalIds: ids("portals"),
    assertionIds: ids("ownership_assertions"),
    supersessions: db.$client
      .prepare("select assertion_id as assertionId, superseded_id as supersededId from ownership_supersessions order by assertion_id, superseded_id")
      .all(),
    counts: {
      applications: count("seal_applications"),
      portals: count("portals"),
      assertions: count("ownership_assertions"),
      supersessions: count("ownership_supersessions"),
    },
  };
}

function migratedSnapshot(db: Db) {
  const ids = (table: string) => (db.$client.prepare(`select id from ${table} order by id`).all() as { id: number }[]).map((row) => row.id);
  const count = (table: string) => (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  return {
    applicationIds: ids("applications"),
    portalIds: ids("portals"),
    assertions: db.$client.prepare("select id, attribute from ownership_assertions order by id").all(),
    supersessions: db.$client
      .prepare("select assertion_id as assertionId, superseded_id as supersededId from ownership_supersessions order by assertion_id, superseded_id")
      .all(),
    counts: {
      applications: count("applications"),
      portals: count("portals"),
      assertions: count("ownership_assertions"),
      supersessions: count("ownership_supersessions"),
    },
  };
}

function verifyFixture(db: Db): void {
  const actual = snapshot(db);
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED)) throw new Error(`Incomplete ownership migration fixture: ${JSON.stringify(actual)}`);
}

describe("onboarding ownership migration fixture", () => {
  let db: Db;
  let migrations: string;

  beforeEach(() => {
    migrations = migrationFolderAt(PRE_ONBOARDING_MIGRATION);
    db = openDatabase(":memory:");
    migrateDatabase(db, migrations);
  });

  afterEach(() => {
    db.$client.close();
    fs.rmSync(migrations, { recursive: true, force: true });
  });

  it("pins ownership IDs and counts before onboarding", () => {
    db.$client.exec(fs.readFileSync(FIXTURE, "utf8"));

    expect(snapshot(db)).toEqual(EXPECTED);
    expect(() => verifyFixture(db)).not.toThrow();
  });

  it("detects an incomplete assertion history", () => {
    const fixture = fs.readFileSync(FIXTURE, "utf8").replace(/INSERT INTO ownership_supersessions[\s\S]*$/, "");
    db.$client.exec(fixture);

    expect(() => verifyFixture(db)).toThrow(/Incomplete ownership migration fixture/);
  });

  it("preserves identity and history through the onboarding migration", () => {
    db.$client.exec(fs.readFileSync(FIXTURE, "utf8"));
    const before = snapshot(db);

    migrateDatabase(db, MIGRATIONS_FOLDER);

    expect(migratedSnapshot(db)).toEqual({
      applicationIds: before.applicationIds,
      portalIds: before.portalIds,
      assertions: before.assertionIds.map((id) => ({ id, attribute: id === 501 ? "application" : id === 502 || id === 503 ? "team" : id === 504 ? "line_of_business" : id === 505 ? "portal" : id === 506 ? "owner" : "host" })),
      supersessions: before.supersessions,
      counts: before.counts,
    });
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
    expect(() =>
      db.$client
        .prepare("insert into applications (id, public_id, seal_id, name, created_at) values (203, 'wap_onboarding_payments_two', '88001', 'Payments reporting', 2000)")
        .run(),
    ).not.toThrow();
    expect(() =>
      db.$client.prepare("insert into applications (public_id, seal_id, name, created_at) values ('app_invalid', '88003', 'Invalid', 2000)").run(),
    ).toThrow(/applications_public_id/);
    expect(() =>
      db.$client
        .prepare(
          "insert into ownership_assertions (public_id, attribute, operation, subject_application_id, value_application_id, provided_by, source, verification, recorded_at) values ('own_invalid_shape', 'application', 'set', 201, 202, 'ana@example.com', 'person', 'unverified', 2000)",
        )
        .run(),
    ).toThrow(/ownership_assertions_shape/);
    expect(() => db.$client.prepare("update ownership_assertions set provided_by = 'changed' where id = 501").run()).toThrow(/assertions are never changed/);
  });

  it("carries the ownership fixture through the complete onboarding migration, keeping portal claims as unapproved Draft candidates", () => {
    db.$client.exec(fs.readFileSync(FIXTURE, "utf8"));
    const before = snapshot(db);
    migrateDatabase(db, MIGRATIONS_FOLDER);

    // Every assertion and supersession keeps its ID, and nothing is added or lost.
    expect(migratedSnapshot(db).counts).toEqual(before.counts);
    expect((migratedSnapshot(db).assertions as { id: number }[]).map((row) => row.id)).toEqual(before.assertionIds);
    expect(migratedSnapshot(db).supersessions).toEqual(before.supersessions);

    // The claimed Portal is a Draft identity, and the claim a candidate, never a placement.
    const payments = getApplication(db, "sea_onboarding_payments");
    expect(getPortal(db, "ptl_onboarding_access")).toMatchObject({ lifecycle: "draft", activeRevisionId: null, draftRevisionId: null });
    expect(payments).toMatchObject({ lifecycle: "draft", activeRevisionId: null });
    const counts = () => db.$client.prepare("select (select count(*) from application_placements) as placements, (select count(*) from placement_requests) as requests, (select count(*) from placement_decisions) as decisions, (select count(*) from placement_routes) as routes").get();
    expect(counts()).toEqual({ placements: 0, requests: 0, decisions: 0, routes: 0 });
    expect(placementCandidates(db, payments)).toEqual([
      { portal: { publicId: "ptl_onboarding_access", label: "Access", lifecycle: "draft", onboarded: false }, claim: { assertion: "own_onboarding_portal", providedBy: "ana@example.com", source: "person", recordedAt: new Date(1400) } },
    ]);

    // Onboarding the claimed Portal adopts it; the claim stays a candidate until a placement is requested and reviewed.
    const { portal, draft } = createPortal(db, portalInput("Access", { ownerTeam: "Access Platform", sealId: "88002" }), ana);
    expect(portal.publicId).toBe("ptl_onboarding_access");
    const saved = savePortalDraft(db, portal.publicId, { lockVersion: draft.lockVersion, document: portalDraft({ sealId: "88002" }) });
    expect(submitPortal(db, portal.publicId, { lockVersion: saved.lockVersion, actor: ana }).submitted).toBe(true);
    expect(placementCandidates(db, payments).map((candidate) => [candidate.portal.label, candidate.portal.onboarded])).toEqual([["Access", true]]);
    expect(counts()).toEqual({ placements: 0, requests: 0, decisions: 0, routes: 0 });

    // A SEAL ID another Application carries is accepted for a new one.
    const { application } = createWebApplication(db, { name: "Payments reporting", ownerTeam: "Payments", sealId: "88001" }, ana);
    expect(applicationsWithSealId(db, "88001").map((item) => item.publicId).sort()).toEqual([application.publicId, "sea_onboarding_payments"].sort());
  });

  it("links each application the DE Console described to its legacy SEAL ID key, and no other", () => {
    db.$client.exec(fs.readFileSync(FIXTURE, "utf8"));
    db.$client
      .prepare(
        "insert into ownership_assertions (id, public_id, attribute, operation, subject_application_id, value_team, provided_by, source, verification, read_at, recorded_at) values (508, 'own_onboarding_console', 'team', 'set', 202, 'Access Platform', 'DE Console', 'de_console', 'not_required', 1700, 1700)",
      )
      .run();

    migrateDatabase(db, MIGRATIONS_FOLDER);

    expect(db.$client.prepare("select console_key as consoleKey, application_id as applicationId, basis, linked_at as linkedAt from de_console_links").all()).toEqual([
      { consoleKey: "seal:88002", applicationId: 202, basis: "migrated", linkedAt: 1700 },
    ]);
  });
});
