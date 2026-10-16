import { describe, expect, it } from "vitest";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { attentionItems } from "@/lib/home/attention";
import { fleetSummary } from "@/lib/home/summary";
import { createApplication } from "@/lib/ownership/records";
import { registerApplication } from "../support/applications";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, claim, driveEvaluation, driveRun, readDeConsole } from "../support/home";
import { onboardPortal } from "../support/onboarding";

/** A fleet of +repositories+ Repositories, half claimed, +assessments+ Assessments with a mix of outcomes, and +applications+ registered Applications. */
function seed(repositories: number, assessments: number, applications: number): Db {
  const db = createTestDb();
  const sources = Array.from({ length: repositories }, (_, index) => {
    const source = buildSource(db);
    if (index % 2 === 0) claim(db, source);
    return source;
  });
  for (let index = 0; index < assessments; index++) {
    const initiative = buildInitiative(db, { sources: [sources[index % sources.length]!] });
    const run = driveRun(db, buildAssessment(db, { initiative }).assessment, index % 3 === 0 ? "failed" : "complete");
    if (run.state === "complete") driveEvaluation(db, buildEvaluation(db, initiative, run), index % 2 === 0 ? "complete" : "failed", "gaps");
  }
  createApplication(db, { sealId: "88002" });
  createApplication(db, { sealId: "88002" });
  const portal = onboardPortal(db, "Access");
  for (let index = 0; index < applications; index++) registerApplication(db, { name: `Application ${index + 1}`, portal });
  readDeConsole(db, [{ seal_id: "88002" }], new Date(0));
  return db;
}

/** The SQL of every statement Home's loaders prepare. */
function statementsOf(db: Db): string[] {
  const statements: string[] = [];
  const prepare = db.$client.prepare.bind(db.$client);
  db.$client.prepare = ((source: string) => {
    statements.push(source);
    return prepare(source);
  }) as typeof db.$client.prepare;
  try {
    fleetSummary(db);
    attentionItems(db, withOverrides(getConfig(), { deConsole: { source: "/tmp/de-console-export.json", refreshMinutes: 60 } }));
  } finally {
    db.$client.prepare = prepare;
  }
  return statements;
}

describe("Home's reads", () => {
  it("prepare the same statements for 5 Repositories and 1 Application as for 500 and 200, and never read a Profile or Map document (Fleet at its expected maximum)", () => {
    const small = statementsOf(seed(5, 1, 1));
    const large = statementsOf(seed(500, 100, 200));

    expect(small.length).toBeGreaterThan(5);
    expect(large.length).toBe(small.length);
    expect(large.length).toBeLessThan(15);
    for (const statement of large) expect(statement).not.toMatch(/repository_profiles|relationship_maps/);
  }, 120_000);
});
