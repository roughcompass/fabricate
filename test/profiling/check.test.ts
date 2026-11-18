import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { targetsOf } from "@/lib/assessments/assessment-records";
import { remoteHead } from "@/lib/acquisition/remote-head";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { CHECK_PROFILES, CURRENT_DETECTOR, type CheckDecision, checkProfiles, decideWithHead, decideWithoutHead, scheduleProfileChecks } from "@/lib/profiling/check";
import { type CheckState, findVersion, latestVersions, queueProfile, versionsOf } from "@/lib/profiling/versions";
import { buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { GitFixture } from "../support/git-fixture";
import { manifest } from "../support/profiles";
import { completeRun } from "../support/scenarios";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const state = (overrides: Partial<CheckState> = {}): CheckState => ({ version: 1, state: "complete", headCommit: null, knownCommit: HEAD_A, ...CURRENT_DETECTOR, ...overrides });

async function finish(db: Db, source: RepositorySource, number: number, outcome: "profiled" | "failed" = "profiled") {
  const version = findVersion(db, source.id, number)!;
  await completeRun(db, version.assessment, targetsOf(db, version.assessment.id), [source], [outcome === "failed" ? "failed" : { "package.json": manifest({ name: source.name, version: "1.0.0" }) }]);
}

describe("the profiling check's decisions", () => {
  it("queues a first version, skips one in progress, and queues one for a new detector release or profile schema without reading the reference", () => {
    expect(decideWithoutHead(undefined)).toEqual<CheckDecision>({ queue: "initial" });
    for (const running of ["queued", "acquiring", "analyzing", "finalizing"] as const) expect(decideWithoutHead(state({ state: running }))).toEqual({ skip: "active" });
    expect(decideWithoutHead(state({ detectorRelease: "repo-facts-0.0.1" }))).toEqual({ queue: "detector" });
    expect(decideWithoutHead(state({ profileSchemaVersion: 1 }))).toEqual({ queue: "detector" });
    expect(decideWithoutHead(state({ state: "failed" }))).toEqual({ needsHead: true });
    expect(decideWithoutHead(state())).toEqual({ needsHead: true });
  });

  it("queues a version for new commits, recording the commit it saw, and none for the commit already profiled", () => {
    expect(decideWithHead(state(), HEAD_A)).toBeNull();
    expect(decideWithHead(state(), HEAD_B)).toEqual({ queue: "commit", headCommit: HEAD_B });
  });

  it("retries a version that failed before its commit was known once, then waits for the commit to change", () => {
    expect(decideWithHead(state({ state: "failed", knownCommit: null }), HEAD_A)).toEqual({ queue: "commit", headCommit: HEAD_A });
    expect(decideWithHead(state({ state: "failed", headCommit: HEAD_A, knownCommit: HEAD_A }), HEAD_A)).toBeNull();
    expect(decideWithHead(state({ state: "failed", headCommit: HEAD_A, knownCommit: HEAD_A }), HEAD_B)).toEqual({ queue: "commit", headCommit: HEAD_B });
  });
});

describe("the profiling check", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("queues every repository without a version, and reads only the references of profiled repositories at rest", async () => {
    const orders = buildSource(db, { name: "orders" });
    const ledger = buildSource(db, { name: "ledger" });
    const billing = buildSource(db, { name: "billing" });
    queueProfile(db, orders, "imported");
    await finish(db, orders, 1);
    queueProfile(db, ledger, "imported");

    const read: string[] = [];
    const commit = versionsOf(db, orders.id)[0]!.commit!;
    const result = await checkProfiles(db, getConfig(), {
      head: async (source) => {
        read.push(source.name);
        return commit;
      },
    });

    expect(result).toEqual({ checked: 3, queued: { initial: 1 }, unreachable: [] });
    expect(read).toEqual(["orders"]);
    expect(versionsOf(db, billing.id).map((version) => version.trigger)).toEqual(["initial"]);
    expect(versionsOf(db, ledger.id)).toHaveLength(1);
  });

  it("queues a version when the reference moved, and records an unreachable repository without stopping", async () => {
    const orders = buildSource(db, { name: "orders" });
    const ledger = buildSource(db, { name: "ledger" });
    for (const source of [orders, ledger]) {
      queueProfile(db, source, "imported");
      await finish(db, source, 1);
    }

    const result = await checkProfiles(db, getConfig(), {
      head: async (source) => {
        if (source.name === "ledger") throw new Error("The source could not be reached");
        return HEAD_B;
      },
    });

    expect(result.queued).toEqual({ commit: 1 });
    expect(result.unreachable).toEqual([{ source: ledger.publicId, message: "The source could not be reached" }]);
    expect(versionsOf(db, orders.id)[0]).toMatchObject({ version: 2, trigger: "commit", headCommit: HEAD_B });
    expect(latestVersions(db).get(orders.id)).toMatchObject({ version: 2, state: "queued", knownCommit: HEAD_B });
  });

  it("retries a repository that failed before its commit was known once, not on every check", async () => {
    const orders = buildSource(db, { name: "orders" });
    queueProfile(db, orders, "imported");
    await finish(db, orders, 1, "failed");
    const head = async () => HEAD_A;

    expect((await checkProfiles(db, getConfig(), { head })).queued).toEqual({ commit: 1 });
    await finish(db, orders, 2, "failed");
    expect((await checkProfiles(db, getConfig(), { head })).queued).toEqual({});
    expect(versionsOf(db, orders.id).map((version) => version.version)).toEqual([2, 1]);
  });

  it("schedules one check per slot, however many workers start", () => {
    const config = withOverrides(getConfig(), { profiling: { checkMinutes: 60 } });
    const now = new Date(Date.UTC(2026, 10, 17, 9, 30));
    scheduleProfileChecks(db, config, now);
    scheduleProfileChecks(db, config, now);
    expect(db.select().from(jobs).all().map((job) => [job.kind, job.runAfter.toISOString()])).toEqual([
      [CHECK_PROFILES, now.toISOString()],
      [CHECK_PROFILES, "2026-11-17T10:00:00.000Z"],
    ]);
  });
});

describe("a repository's reference on its remote", () => {
  let fixture: GitFixture;
  beforeEach(() => {
    fixture = GitFixture.create("remote-head");
  });
  afterEach(() => fixture.cleanup());

  it("reads the commit the default branch, a branch, or an annotated tag names, without fetching", async () => {
    const repo = fixture.repo("fleet/orders");
    const first = repo.write("README.md", "one").commit();
    repo.tag("v1", { message: "First release" });
    const second = repo.write("README.md", "two").commit();
    const config = withOverrides(getConfig(), { allowedRoots: [fixture.dir("fleet")] });
    const source = (gitRef: string | null) => ({ cloneUrl: `file://${fixture.dir("fleet")}/orders`, gitRef });

    expect(await remoteHead(source(null), { config })).toBe(second);
    expect(await remoteHead(source("main"), { config })).toBe(second);
    expect(await remoteHead(source("v1"), { config })).toBe(first);
    expect(await remoteHead(source(first), { config })).toBe(first);
    await expect(remoteHead(source("missing"), { config })).rejects.toThrow(/no branch or tag named missing/);
  });
});
