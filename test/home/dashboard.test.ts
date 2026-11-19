import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ACTIVITY_STATES, WEEK_MS, assessmentTrend, figureChanges, figuresAt, recentActivity, weekChange } from "@/lib/home/dashboard";
import { fleetSummary } from "@/lib/home/summary";
import { attentionItems } from "@/lib/home/attention";
import { currentRecipe, moveSurvey, requestSurvey } from "@/lib/surveys/records";
import { finishSurvey } from "@/lib/surveys/run";
import { getConfig } from "@/lib/config";
import { buildRun, buildAssessment, buildRepository } from "../support/builders";
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

const changes = (db: Db) => figureChanges(fleetSummary(db), figuresAt(db, new Date(NOW - WEEK_MS)));

describe("figures over seven days", () => {
  it("states an increase, a decrease, and no change in text", () => {
    expect(weekChange(6, 4)).toBe("+2 this week");
    expect(weekChange(3, 5)).toBe("−2 this week");
    expect(weekChange(5, 5)).toBe("No change this week");
  });

  it("counts the Repositories added this week, not a deleted one (Repositories added this week)", () => {
    const db = createTestDb();
    for (let index = 0; index < 4; index++) backdate(db, "repository_sources", "created_at", buildRepository(db).id, 10);
    buildRepository(db);
    buildRepository(db);
    expect(changes(db)).toEqual({ repositories: "+2 this week", assessments: "No change this week" });
  });

  it("counts an Assessment's conclusion from Evaluations completed by then, and states no change for an Assessment created earlier (No change)", () => {
    const db = createTestDb();
    const repository = buildRepository(db);
    const assessment = buildAssessment(db, { repositories: [repository] });
    backdate(db, "initiatives", "created_at", assessment.id, 10);
    const evaluation = driveEvaluation(db, buildEvaluation(db, assessment, driveRun(db, buildRun(db, { assessment }).run, "complete")), "complete", "gaps");
    expect(figuresAt(db, new Date(NOW - WEEK_MS)).assessments).toMatchObject({ total: 1, byConclusion: { gaps: 0, none: 1 } });
    expect(changes(db)).toMatchObject({ assessments: "No change this week" });
    backdate(db, "evaluations", "finished_at", evaluation.id, 9);
    expect(figuresAt(db, new Date(NOW - WEEK_MS)).assessments.byConclusion).toMatchObject({ gaps: 1, none: 0 });
  });
});

describe("Assessment trend", () => {
  it("counts this week's Evaluations by conclusion in the last of eight weeks (Trend)", () => {
    const db = createTestDb();
    const repository = buildRepository(db);
    const evaluate = (conclusion: "gaps" | "conforms") => {
      const assessment = buildAssessment(db, { repositories: [repository] });
      return driveEvaluation(db, buildEvaluation(db, assessment, driveRun(db, buildRun(db, { assessment }).run, "complete")), "complete", conclusion);
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
  it("names a Run that finished with issues apart from one that finished cleanly, so it shows as a warning", () => {
    const db = createTestDb();
    const repositories = [buildRepository(db, { name: "orders" }), buildRepository(db, { name: "billing" })];
    const fleet = buildAssessment(db, { name: "Fleet baseline", repositories });
    driveRun(db, buildRun(db, { assessment: fleet, repositories }).run, "complete_with_issues", { failedTargets: 1 });
    const [item] = recentActivity(db);
    expect(item!.kind).toBe("run_with_issues");
    expect(ACTIVITY_STATES[item!.kind]).toBe("complete_with_issues");
  });

  it("leads with the newest finished Run, linking to it by its number and Assessment, and leaves background surveys out", () => {
    const db = createTestDb();
    const repository = buildRepository(db);
    const orders = buildAssessment(db, { name: "Orders review", repositories: [repository] });
    const older = driveRun(db, buildRun(db, { assessment: orders }).run, "complete");
    backdate(db, "assessments", "finished_at", older.id, 1);
    const failed = driveRun(db, buildRun(db, { assessment: orders }).run, "failed");
    // A background survey that failed is a version of the Repository, not a Run.
    const { survey } = requestSurvey(db, { repositoryId: repository.id, commitSha: "a".repeat(40), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", ...currentRecipe(getConfig()) });
    finishSurvey(db, moveSurvey(db, survey, "running", { attempts: 1 }), { failure: { code: "source_unavailable", message: "The repository could not be reached" } });

    const activity = recentActivity(db);
    expect(attentionItems(db).map((item) => item.kind)).toEqual(["run_failed"]);
    expect(fleetSummary(db).assessments.total).toBe(1);
    expect(activity.map((item) => item.kind)).toEqual(["run_failed", "run_completed"]);
    expect(activity[0]).toMatchObject({ record: { name: "Run #2 · Orders review", href: `/runs/${failed.publicId}` } });
    expect(activity[1]).toMatchObject({ record: { name: "Run #1 · Orders review", href: `/runs/${older.publicId}` } });
  });

  it("lists at most ten", () => {
    const db = createTestDb();
    const assessment = buildAssessment(db, { repositories: [buildRepository(db)] });
    for (let index = 0; index < 12; index++) driveRun(db, buildRun(db, { assessment }).run, "complete");
    expect(recentActivity(db)).toHaveLength(10);
  });
});
