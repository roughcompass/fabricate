import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { attentionItems } from "@/lib/home/attention";
import { WEEK_MS, assessmentTrend, figuresAt, recentActivity } from "@/lib/home/dashboard";
import { fleetSummary } from "@/lib/home/summary";
import { buildRun, buildAssessment, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, driveEvaluation, driveRun } from "../support/home";

/** A fleet of +repositories+ Repositories and +assessments+ Assessments with a mix of outcomes. */
function seed(repositoryCount: number, assessments: number): Db {
  const db = createTestDb();
  const repositories = Array.from({ length: repositoryCount }, () => buildRepository(db));
  for (let index = 0; index < assessments; index++) {
    const assessment = buildAssessment(db, { repositories: [repositories[index % repositories.length]!] });
    const run = driveRun(db, buildRun(db, { assessment }).run, index % 3 === 0 ? "failed" : "complete");
    if (run.state === "complete") driveEvaluation(db, buildEvaluation(db, assessment, run), index % 2 === 0 ? "complete" : "failed", "gaps");
  }
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
    figuresAt(db, new Date(Date.now() - WEEK_MS));
    assessmentTrend(db);
    recentActivity(db);
    attentionItems(db);
  } finally {
    db.$client.prepare = prepare;
  }
  return statements;
}

describe("Home's reads", () => {
  it("prepare the same statements for 5 Repositories as for 500, and never read a Profile or Map document (Fleet at its expected maximum)", () => {
    const small = statementsOf(seed(5, 1));
    const large = statementsOf(seed(500, 100));

    expect(small.length).toBeGreaterThan(5);
    expect(large.length).toBe(small.length);
    expect(large.length).toBeLessThan(20);
    // Profile and Relationship Map rows may be counted, but no statement reads a stored document.
    for (const statement of large) expect(statement).not.toMatch(/\bdocument\b/);
  }, 120_000);
});
