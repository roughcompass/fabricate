import { describe, expect, it } from "vitest";
import { type FabricateConfig, getConfig, withOverrides } from "@/lib/config";
import { attentionItems } from "@/lib/home/attention";
import { claimInitiative } from "@/lib/initiatives/initiative-records";
import { recordFailedDeConsoleRead } from "@/lib/ownership/de-console";
import { createApplication } from "@/lib/ownership/records";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, driveEvaluation, driveRun, readDeConsole } from "../support/home";

const NOW = new Date(Date.UTC(2026, 9, 15, 12, 0));
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
const configured = (refreshMinutes = 60): FabricateConfig => withOverrides(getConfig(), { deConsole: { source: "/tmp/de-console-export.json", refreshMinutes } });
const unconfigured = (): FabricateConfig => withOverrides(getConfig(), { deConsole: { source: null } });

describe("Needs attention", () => {
  it("lists an Assessment whose latest Run failed, with its number and Assessment (Failed Run)", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const initiative = buildInitiative(db, { name: "Checkout platform migration", sources: [source] });
    for (let i = 0; i < 3; i++) driveRun(db, buildAssessment(db, { initiative }).assessment, "complete");
    const failed = driveRun(db, buildAssessment(db, { initiative }).assessment, "failed");

    expect(attentionItems(db, unconfigured(), NOW)).toEqual([
      { kind: "run_failed", since: failed.finishedAt, assessment: { publicId: initiative.publicId, name: "Checkout platform migration" }, run: { publicId: failed.publicId, number: 4 } },
    ]);
  });

  it("drops a failure that a later Run replaced (Failure replaced by a later Run)", () => {
    const db = createTestDb();
    const initiative = buildInitiative(db, { sources: [buildSource(db)] });
    driveRun(db, buildAssessment(db, { initiative }).assessment, "failed");
    driveRun(db, buildAssessment(db, { initiative }).assessment, "complete");

    expect(attentionItems(db, unconfigured(), NOW)).toEqual([]);
  });

  it("counts the Repositories a Run with issues couldn't assess (Run that couldn't assess every Repository)", () => {
    const db = createTestDb();
    const sources = Array.from({ length: 5 }, () => buildSource(db));
    const initiative = buildInitiative(db, { sources });
    driveRun(db, buildAssessment(db, { initiative }).assessment, "complete_with_issues", { failedTargets: 3 });

    expect(attentionItems(db, unconfigured(), NOW)).toMatchObject([{ kind: "run_with_issues", unassessed: 3, run: { number: 1 } }]);
  });

  it("lists a failed latest Evaluation, and includes Assessments created for claims", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const initiative = buildInitiative(db, { sources: [source] });
    const run = driveRun(db, buildAssessment(db, { initiative }).assessment, "complete");
    driveEvaluation(db, buildEvaluation(db, initiative, run), "complete", "gaps");
    const failed = driveEvaluation(db, buildEvaluation(db, initiative, run), "failed");
    const claimed = claimInitiative(db, source);
    driveRun(db, buildAssessment(db, { initiative: claimed, sources: [source] }).assessment, "failed");

    const items = attentionItems(db, unconfigured(), NOW);
    expect(items).toHaveLength(2);
    expect(items).toContainEqual(expect.objectContaining({ kind: "evaluation_failed", evaluation: { publicId: failed.publicId, number: 2 } }));
    expect(items).toContainEqual(expect.objectContaining({ kind: "run_failed", assessment: { publicId: claimed.publicId, name: claimed.name } }));
  });

  it("lists a failed DE Console read with when the last success was (DE Console read failed)", () => {
    const db = createTestDb();
    readDeConsole(db, [{ seal_id: "88001" }], hoursAgo(5));
    recordFailedDeConsoleRead(db, { trigger: "schedule", error: "The DE Console didn't answer within 10 seconds", readAt: hoursAgo(1) });

    expect(attentionItems(db, configured(), NOW)).toEqual([{ kind: "de_console_failed", since: hoursAgo(1), lastSuccess: hoursAgo(5) }]);
  });

  it("lists DE Console values older than three refresh intervals, and not younger ones (DE Console values stale)", () => {
    const db = createTestDb();
    readDeConsole(db, [{ seal_id: "88001" }], hoursAgo(4));
    expect(attentionItems(db, configured(60), NOW)).toEqual([{ kind: "de_console_stale", since: hoursAgo(4), refreshMinutes: 60 }]);
    expect(attentionItems(db, configured(120), NOW)).toEqual([]);
  });

  it("lists no read problem while no source is configured, or before any read (DE Console not configured)", () => {
    const db = createTestDb();
    expect(attentionItems(db, configured(), NOW)).toEqual([]);
    recordFailedDeConsoleRead(db, { trigger: "schedule", error: "unreachable", readAt: hoursAgo(1) });
    expect(attentionItems(db, unconfigured(), NOW)).toEqual([]);
  });

  it("lists every open DE Console conflict as one item, configured or not (Open DE Console conflicts)", () => {
    const db = createTestDb();
    createApplication(db, { sealId: "88002", name: "Access Shell" });
    createApplication(db, { sealId: "88002", name: "Access Settings" });
    readDeConsole(db, [{ seal_id: "88001", name: "Markets Hub" }, { seal_id: "88001", name: "Markets Admin" }, { seal_id: "88002" }], hoursAgo(2));

    const expected = [{ kind: "de_console_conflicts", since: hoursAgo(2), count: 2 }];
    expect(attentionItems(db, configured(), NOW)).toEqual(expected);
    expect(attentionItems(db, unconfigured(), NOW)).toEqual(expected);
  });

  it("orders items newest first", () => {
    const db = createTestDb();
    const initiative = buildInitiative(db, { sources: [buildSource(db)] });
    driveRun(db, buildAssessment(db, { initiative }).assessment, "failed");
    recordFailedDeConsoleRead(db, { trigger: "schedule", error: "unreachable", readAt: new Date(Date.now() + 60_000) });

    expect(attentionItems(db, configured(), new Date(Date.now() + 120_000)).map((item) => item.kind)).toEqual(["de_console_failed", "run_failed"]);
  });
});
