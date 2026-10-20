import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { catalogs } from "@/lib/experience/catalogs";
import { currentExperience, saveExperience } from "@/lib/experience/versions";
import { WEEK_MS, assessmentTrend, figureChanges, figuresAt, portalsOverview, recentActivity, weekChange } from "@/lib/home/dashboard";
import { claimedShare, fleetSummary } from "@/lib/home/summary";
import { addItem, setDefault } from "@/lib/onboarding/navigation";
import { getPortal, promotePortal } from "@/lib/onboarding/portals";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, driveEvaluation, driveRun } from "../support/home";
import { registerApplication } from "../support/applications";
import { ana, onboardPortal } from "../support/onboarding";

/*
 * Home's dashboard readers (update-portal-management-journey task 5.1): each
 * figure's change over seven days, the Portals overview, the Assessment trend,
 * and the recent activity.
 */

const NOW = Date.now();
const daysAgo = (days: number) => NOW - days * 24 * 60 * 60 * 1000;
/** Moves a record's time back +days+, lifting the test database's guards on changing it: a real record's times never change. */
function backdate(db: Db, table: string, column: string, id: number, days: number) {
  for (const { name } of db.$client.prepare("select name from sqlite_master where type = 'trigger' and tbl_name = ? and sql like '%BEFORE UPDATE%'").all(table) as { name: string }[]) db.$client.exec(`drop trigger "${name}"`);
  db.$client.prepare(`update ${table} set ${column} = ? where id = ?`).run(daysAgo(days), id);
}

/** Promotes +portal+, giving it the default route promotion needs. */
function promote(db: Db, portal: { publicId: string }) {
  const version = () => getPortal(db, portal.publicId).lockVersion;
  const application = registerApplication(db, { name: `${portal.publicId} home`, portal: getPortal(db, portal.publicId) });
  const item = addItem(db, portal.publicId, { lockVersion: version(), label: "Home", route: "/home", application: application.publicId, parent: null }, ana);
  setDefault(db, portal.publicId, { lockVersion: version(), entry: item.publicId }, ana);
  promotePortal(db, portal.publicId, { lockVersion: version() }, ana);
}
const changes = (db: Db) => figureChanges(fleetSummary(db), figuresAt(db, new Date(NOW - WEEK_MS)), claimedShare);

describe("figures over seven days", () => {
  it("states an increase, a decrease, and no change in text", () => {
    expect(weekChange(6, 4)).toBe("+2 this week");
    expect(weekChange(3, 5)).toBe("−2 this week");
    expect(weekChange(5, 5)).toBe("No change this week");
    expect(weekChange(61, 58, " pts")).toBe("+3 pts this week");
  });

  it("counts Applications registered in the last seven days (Applications added this week)", () => {
    const db = createTestDb();
    const access = onboardPortal(db, "Access");
    const registered = Array.from({ length: 6 }, (_, index) => registerApplication(db, { name: `App ${index}`, portal: access }));
    for (const application of registered.slice(0, 4)) backdate(db, "applications", "created_at", application.id, 10);
    expect(figuresAt(db, new Date(NOW - WEEK_MS)).applications.applications).toBe(4);
    expect(changes(db).applications).toBe("+2 this week");
  });

  it("reads Production Portals from lifecycle changes, and says No change for an older promotion (No change)", () => {
    const db = createTestDb();
    const access = onboardPortal(db, "Access");
    promote(db, access);
    expect(changes(db).productionPortals).toBe("+1 this week");
    for (const { id } of db.$client.prepare("select id from onboarding_events where portal_id = ?").all(access.id) as { id: number }[]) backdate(db, "onboarding_events", "occurred_at", id, 10);
    expect(changes(db).productionPortals).toBe("No change this week");
  });

  it("counts an Assessment's conclusion from Evaluations completed by then", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const initiative = buildInitiative(db, { sources: [source] });
    backdate(db, "initiatives", "created_at", initiative.id, 10);
    const evaluation = driveEvaluation(db, buildEvaluation(db, initiative, driveRun(db, buildAssessment(db, { initiative }).assessment, "complete")), "complete", "gaps");
    expect(figuresAt(db, new Date(NOW - WEEK_MS)).assessments).toMatchObject({ total: 1, byConclusion: { gaps: 0, none: 1 } });
    expect(changes(db)).toMatchObject({ assessments: "No change this week", gaps: "+1 this week", none: "−1 this week" });
    backdate(db, "evaluations", "finished_at", evaluation.id, 9);
    expect(changes(db).gaps).toBe("No change this week");
  });
});

describe("Portals overview", () => {
  it("lists Portals in Production first, with their Application counts and last save (Two Portals)", () => {
    const db = createTestDb();
    const markets = onboardPortal(db, "Markets");
    const access = onboardPortal(db, "Access");
    promote(db, access);
    for (const name of ["Payee Hub", "Ledger"]) registerApplication(db, { name, portal: access });
    registerApplication(db, { name: "Blotter", portal: markets });
    const current = currentExperience(db, getPortal(db, markets.publicId), catalogs());
    saveExperience(db, markets.publicId, { baseNumber: current.number, lockVersion: getPortal(db, markets.publicId).lockVersion, document: { ...current.experience, copyright: "© Markets" } }, ana, catalogs());

    const { portals, total } = portalsOverview(db);
    expect(total).toBe(2);
    expect(portals.map((portal) => [portal.label, portal.lifecycle, portal.applications, portal.savedAt !== null])).toEqual([
      ["Access", "production", 3, false],
      ["Markets", "prototype", 1, true],
    ]);
  });

  it("lists at most the limit, and says how many there are", () => {
    const db = createTestDb();
    for (const name of ["Alpha", "Bravo", "Charlie"]) onboardPortal(db, name);
    expect(portalsOverview(db, 2)).toMatchObject({ total: 3, portals: [{ label: "Alpha" }, { label: "Bravo" }] });
  });
});

describe("Assessment trend", () => {
  it("counts this week's Evaluations by conclusion in the last of eight weeks (Trend)", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const evaluate = (conclusion: "gaps" | "conforms") => {
      const initiative = buildInitiative(db, { sources: [source] });
      return driveEvaluation(db, buildEvaluation(db, initiative, driveRun(db, buildAssessment(db, { initiative }).assessment, "complete")), "complete", conclusion);
    };
    evaluate("gaps");
    evaluate("gaps");
    evaluate("conforms");
    const old = evaluate("conforms");
    backdate(db, "evaluations", "finished_at", old.id, 20);

    const weeks = assessmentTrend(db, new Date(NOW + 1000));
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)!.counts).toEqual({ gaps: 2, undetermined: 0, conforms: 1, not_applicable: 0 });
    expect(weeks.reduce((sum, week) => sum + week.counts.conforms, 0)).toBe(2);
    expect(weeks[0]!.start.getTime()).toBeLessThan(weeks[1]!.start.getTime());
  });
});

describe("recent activity", () => {
  it("leads with the newest event, naming who saved and linking to the Portal (Experience saved)", () => {
    const db = createTestDb();
    const access = onboardPortal(db, "Access");
    const payeeHub = registerApplication(db, { name: "Payee Hub", portal: access });
    backdate(db, "applications", "created_at", payeeHub.id, 1);
    const current = currentExperience(db, getPortal(db, access.publicId), catalogs());
    saveExperience(db, access.publicId, { baseNumber: current.number, lockVersion: getPortal(db, access.publicId).lockVersion, document: { ...current.experience, copyright: "© Access" } }, ana, catalogs());

    const activity = recentActivity(db);
    expect(activity[0]).toMatchObject({ kind: "experience_saved", actor: ana.name, record: { name: "Access", href: `/portals/${access.publicId}` } });
    expect(activity.map((item) => item.kind)).toEqual(["experience_saved", "portal_created", "application_created"]);
  });

  it("lists at most ten", () => {
    const db = createTestDb();
    for (let index = 0; index < 12; index++) onboardPortal(db, `Portal ${String.fromCharCode(65 + index)}`);
    expect(recentActivity(db)).toHaveLength(10);
  });
});
