import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, MIGRATIONS_FOLDER, migrateDatabase } from "@/lib/db/client";
import { createTestDb } from "../support/db";
import { v2Database } from "../support/onboarding-v2";

/*
 * Migration 0032 and the menu carry-over after it (make-applications-first-
 * class task 1.1, design decision 11), over the v1 and v2 onboarding
 * fixtures: Portal lifecycles, flattened menus with PROD's routes and
 * default, a colliding route skipped and logged, each Application's Portal,
 * the dropped tables, and the imported demo deployments.
 */

const DROPPED = [
  "portal_revisions",
  "application_revisions",
  "microfrontend_revisions",
  "microfrontends",
  "portal_environments",
  "application_environments",
  "environment_catalog_reads",
  "portal_menu_groups",
  "portal_default_routes",
  "application_placements",
  "placement_requests",
  "placement_request_environments",
  "placement_decisions",
  "placement_routes",
  "rendering_inference_candidates",
  "application_launch_targets",
  "application_components",
  "onboarding_validations",
  "external_references",
  "external_observations",
  "external_reads",
  "_carried_menu_groups",
  "_carried_menu_routes",
  "_carried_onboarded_portals",
];

const lifecycleOf = (db: Db, label: string) => (db.$client.prepare("select lifecycle from portals where label = ?").get(label) as { lifecycle: string }).lifecycle;
const portalOf = (db: Db, name: string) => (db.$client.prepare("select p.label from applications a join portals p on p.id = a.portal_id where a.name = ?").get(name) as { label: string } | undefined)?.label;
const menuOf = (db: Db, portal: string) =>
  db.$client
    .prepare(
      `select m.kind, m.label, m.route, a.name as application, m.is_default as isDefault, parent.label as parent
       from portal_menu_items m join portals p on p.id = m.portal_id
       left join applications a on a.id = m.application_id left join portal_menu_items parent on parent.id = m.parent_id
       where p.label = ? order by m.parent_id is not null, m.parent_id, m.position`,
    )
    .all(portal) as { kind: string; label: string; route: string | null; application: string | null; isDefault: number; parent: string | null }[];

describe("migration 0032 over the onboarding fixtures", () => {
  let db: Db;
  let warnings: string[];
  beforeEach(() => {
    db = v2Database();
    warnings = [];
    vi.spyOn(console, "warn").mockImplementation((message: string) => void warnings.push(message));
    migrateDatabase(db, MIGRATIONS_FOLDER);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    db.$client.close();
  });

  it("puts an Active Portal in Production, and Ready, Draft, and Retired Portals in Prototype", () => {
    expect(lifecycleOf(db, "Access")).toBe("production");
    expect(lifecycleOf(db, "Markets")).toBe("prototype");
    expect(lifecycleOf(db, "Treasury")).toBe("prototype");
    expect(lifecycleOf(db, "Lending")).toBe("prototype");
  });

  it("carries the active revision's groups and each approved placement's route into the menu", () => {
    expect(menuOf(db, "Access")).toEqual([
      { kind: "group", label: "Payments", route: null, application: null, isDefault: 0, parent: null },
      { kind: "item", label: "Payments", route: "/payee", application: "Payee hub", isDefault: 1, parent: "Payments" },
      { kind: "item", label: "Payments", route: "/reports", application: "Payments reporting", isDefault: 0, parent: "Payments" },
      { kind: "item", label: "Approvals", route: "/approvals", application: "Payments approvals", isDefault: 0, parent: "Payments" },
    ]);
  });

  it("uses a PROD route over a UAT one, and makes PROD's default the Portal's default", () => {
    const markets = menuOf(db, "Markets");
    expect(markets.find((entry) => entry.application === "Ledger")).toMatchObject({ route: "/ledger", isDefault: 1 });
    expect(markets.find((entry) => entry.application === "Activity")).toMatchObject({ route: "/activity", isDefault: 0 });
    expect(markets.filter((entry) => entry.isDefault === 1)).toHaveLength(1);
    expect(markets.some((entry) => entry.route === "/ledger-uat")).toBe(false);
  });

  it("skips a route that collides once menus are flattened, and logs it", () => {
    expect(menuOf(db, "Markets").some((entry) => entry.application === "Statements")).toBe(false);
    expect(warnings).toContainEqual(expect.stringMatching(/^Menu migration: Markets: skipped \/ledger for Statements, because Ledger already has it\.$/));
  });

  it("puts an Application in its earliest approved placement's Portal", () => {
    expect(portalOf(db, "Payee hub")).toBe("Access");
    expect(portalOf(db, "Cards")).toBe("Markets");
    expect(portalOf(db, "Ledger")).toBe("Markets");
  });

  it("drops every revision, environment, placement, validation, reconciliation, launch-target, inference, and MFE table", () => {
    const present = (db.$client.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((row) => row.name);
    for (const table of DROPPED) expect(present).not.toContain(table);
    const triggers = (db.$client.prepare("select name from sqlite_master where type = 'trigger' and tbl_name in ('portals', 'applications')").all() as { name: string }[]).map((row) => row.name);
    expect(triggers).not.toContain("portals_revision_pointers");
    expect(triggers).not.toContain("applications_revision_pointers");
  });

  it("deletes imported demo deployments with their threads, comments, and shares, and keeps template ones", () => {
    expect(db.$client.prepare("select name from demo_applications").all()).toEqual([{ name: "Payments workspace" }]);
    for (const table of ["demo_threads", "demo_comments", "demo_shares"]) expect(db.$client.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 0 });
  });

  it("keeps each Portal's slug derivation, and its creation and activation in history", () => {
    expect(db.$client.prepare("select slug from portals where label = 'Lending'").get()).toEqual({ slug: "lending" });
    const events = db.$client.prepare("select e.event, e.from_lifecycle as fromLifecycle, e.to_lifecycle as toLifecycle from onboarding_events e join portals p on p.id = e.portal_id where p.label = 'Access' order by e.id").all();
    expect(events).toContainEqual({ event: "created", fromLifecycle: null, toLifecycle: "prototype" });
    expect(events).toContainEqual({ event: "promoted", fromLifecycle: "prototype", toLifecycle: "production" });
  });
});

describe("migration 0032 on an empty database", () => {
  it("leaves no staged tables and logs nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = createTestDb();
    expect(db.$client.prepare("select name from sqlite_master where name glob '_carried_*'").all()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    db.$client.close();
  });

  it("refuses a menu item for another Portal's Application, and keeps an Application's Portal", () => {
    const db = createTestDb();
    const now = Date.now();
    const portal = (label: string) => (db.$client.prepare("insert into portals (public_id, label, label_key, created_at) values (?, ?, ?, ?) returning id").get(`ptl_${label}`, label, label.toLowerCase(), now) as { id: number }).id;
    const [access, markets] = [portal("Access"), portal("Markets")];
    const ledger = (db.$client.prepare("insert into applications (public_id, name, portal_id, created_at, updated_at) values ('wap_ledger', 'Ledger', ?, ?, ?) returning id").get(markets, now, now) as { id: number }).id;
    expect(() => db.$client.prepare("insert into portal_menu_items (public_id, portal_id, kind, label, route, application_id, position) values ('mnu_one', ?, 'item', 'Ledger', '/ledger', ?, 0)").run(access, ledger)).toThrow(/Application of its own Portal/);
    expect(() => db.$client.prepare("update applications set portal_id = ? where id = ?").run(access, ledger)).toThrow(/keeps its slug, Portal, and repository/);
    db.$client.close();
  });
});
