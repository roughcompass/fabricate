import { beforeEach, describe, expect, it } from "vitest";
import { targetsOf } from "@/lib/assessments/assessment-records";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { currentProfile, currentProfiles } from "@/lib/profiling/current";
import { queueProfile, repositoryProfiling } from "@/lib/profiling/versions";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { manifest } from "../support/profiles";
import { completeRun, seedAssessment } from "../support/scenarios";

/** Queues the next profile version of +source+ and drives it to a Profile, or to a failure. */
async function profileVersion(db: Db, source: RepositorySource, outcome: "profiled" | "failed" = "profiled") {
  const { version } = queueProfile(db, source, "manual");
  await completeRun(db, version.assessment, targetsOf(db, version.assessment.id), [source], [outcome === "failed" ? "failed" : { "package.json": manifest({ name: source.name, version: "1.0.0" }) }]);
  return version;
}

describe("current Profile", () => {
  let db: Db;
  let orders: RepositorySource;
  beforeEach(() => {
    db = createTestDb();
    orders = buildSource(db, { name: "orders" });
  });

  it("is the newest Profile from any Run, including another Assessment's", async () => {
    await profileVersion(db, orders);
    const run = await seedAssessment(db, buildInitiative(db, { sources: [orders] }), [orders], [{ "package.json": manifest({ name: "orders", version: "2.0.0" }) }]);

    const current = currentProfile(db, orders.id)!;
    expect(current.assessment.id).toBe(run.id);
    expect(current.version).toBeNull();
    expect(current.target.repositorySourceId).toBe(orders.id);
    expect(current.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is a profile version's Profile, with its number, when that's the newest", async () => {
    await seedAssessment(db, buildInitiative(db, { sources: [orders] }), [orders], [{ "package.json": manifest({ name: "orders", version: "2.0.0" }) }]);
    const version = await profileVersion(db, orders);

    expect(currentProfile(db, orders.id)).toMatchObject({ version: 1, assessment: { id: version.assessment.id } });
  });

  it("is undefined for a repository no Run has profiled", async () => {
    await profileVersion(db, orders, "failed");

    expect(currentProfile(db, orders.id)).toBeUndefined();
    expect(currentProfile(db, buildSource(db, { name: "billing" }).id)).toBeUndefined();
  });

  it("stays the older Profile when the newest version failed", async () => {
    const first = await profileVersion(db, orders);
    await profileVersion(db, orders, "failed");

    expect(currentProfile(db, orders.id)).toMatchObject({ version: 1, assessment: { id: first.assessment.id } });
  });

  it("reads several repositories, or every one, in one query", async () => {
    const billing = buildSource(db, { name: "billing" });
    const ledger = buildSource(db, { name: "ledger" });
    await seedAssessment(db, buildInitiative(db, { sources: [orders, billing, ledger] }), [orders, billing, ledger], [{ "package.json": manifest({ name: "orders", version: "1.0.0" }) }, { "package.json": manifest({ name: "billing", version: "1.0.0" }) }, "failed"]);
    const statements: string[] = [];
    const prepare = db.$client.prepare.bind(db.$client);
    db.$client.prepare = ((source: string) => {
      statements.push(source);
      return prepare(source);
    }) as typeof db.$client.prepare;

    const some = currentProfiles(db, [orders.id, ledger.id]);
    const every = currentProfiles(db);
    db.$client.prepare = prepare;

    expect([...some.keys()]).toEqual([orders.id]);
    expect([...every.keys()].sort()).toEqual([orders.id, billing.id].sort());
    expect(statements).toHaveLength(2);
    expect(currentProfiles(db, [])).toEqual(new Map());
  });

  it("reads what the Repository page shows in two queries, however many versions there are", async () => {
    await profileVersion(db, orders);
    await profileVersion(db, orders, "failed");
    queueProfile(db, orders, "manual");
    const statements: string[] = [];
    const prepare = db.$client.prepare.bind(db.$client);
    db.$client.prepare = ((source: string) => {
      statements.push(source);
      return prepare(source);
    }) as typeof db.$client.prepare;

    const profiling = repositoryProfiling(db, orders.id);
    db.$client.prepare = prepare;

    expect(profiling).toMatchObject({ current: { version: 1 }, latest: { version: 3, assessment: { state: "queued" } }, count: 3 });
    expect(statements).toHaveLength(2);
  });
});
