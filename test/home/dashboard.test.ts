import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { WEEK_MS, assessmentTrend, figureChanges, figuresAt, recentActivity, weekChange } from "@/lib/home/dashboard";
import { claimedShare, fleetSummary } from "@/lib/home/summary";
import type { Assessment } from "@/lib/assessments/assessment-records";
import { getConfig } from "@/lib/config";
import { attentionItems } from "@/lib/home/attention";
import { claimInitiative } from "@/lib/initiatives/initiative-records";
import { queueProfile } from "@/lib/profiling/versions";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, driveEvaluation, driveRun } from "../support/home";

/*
 * Home's dashboard readers: each figure's change over seven days, the
 * Assessment trend, and the recent activity.
 */

const NOW = Date.now();
const daysAgo = (days: number) => NOW - days * 24 * 60 * 60 * 1000;
/** Moves a record's time back +days+, lifting the test database's guards on changing it: a real record's times never change. */
function backdate(db: Db, table: string, column: string, id: number, days: number) {
  for (const { name } of db.$client.prepare("select name from sqlite_master where type = 'trigger' and tbl_name = ? and sql like '%BEFORE UPDATE%'").all(table) as { name: string }[]) db.$client.exec(`drop trigger "${name}"`);
  db.$client.prepare(`update ${table} set ${column} = ? where id = ?`).run(daysAgo(days), id);
}

const changes = (db: Db) => figureChanges(fleetSummary(db), figuresAt(db, new Date(NOW - WEEK_MS)), claimedShare);

describe("figures over seven days", () => {
  it("states an increase, a decrease, and no change in text", () => {
    expect(weekChange(6, 4)).toBe("+2 this week");
    expect(weekChange(3, 5)).toBe("−2 this week");
    expect(weekChange(5, 5)).toBe("No change this week");
    expect(weekChange(61, 58, " pts")).toBe("+3 pts this week");
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

    // The Evaluations finish now, after NOW was read when the file loaded.
    const weeks = assessmentTrend(db, new Date(Date.now() + 1000));
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)!.counts).toEqual({ gaps: 2, undetermined: 0, conforms: 1, not_applicable: 0 });
    expect(weeks.reduce((sum, week) => sum + week.counts.conforms, 0)).toBe(2);
    expect(weeks[0]!.start.getTime()).toBeLessThan(weeks[1]!.start.getTime());
  });
});

describe("recent activity", () => {
  it("leads with the newest finished Run, linking to it, and leaves claims' Runs and profile versions out", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const orders = buildInitiative(db, { name: "Orders review", sources: [source] });
    const older = driveRun(db, buildAssessment(db, { initiative: orders }).assessment, "complete");
    backdate(db, "assessments", "finished_at", older.id, 1);
    const failed = driveRun(db, buildAssessment(db, { initiative: orders }).assessment, "failed");
    driveRun(db, buildAssessment(db, { initiative: claimInitiative(db, source) }).assessment, "complete");
    const version = queueProfile(db, source, "imported") as { version: { assessment: Assessment } };
    driveRun(db, version.version.assessment, "failed");

    const activity = recentActivity(db);
    expect(attentionItems(db, getConfig()).map((item) => item.kind)).toEqual(["run_failed"]);
    expect(fleetSummary(db).assessments.total).toBe(1);
    expect(activity.map((item) => item.kind)).toEqual(["run_failed", "run_completed"]);
    expect(activity[0]).toMatchObject({ record: { name: "Orders review", href: `/runs/${failed.publicId}` } });
  });

  it("lists at most ten", () => {
    const db = createTestDb();
    const initiative = buildInitiative(db, { sources: [buildSource(db)] });
    for (let index = 0; index < 12; index++) driveRun(db, buildAssessment(db, { initiative }).assessment, "complete");
    expect(recentActivity(db)).toHaveLength(10);
  });
});
