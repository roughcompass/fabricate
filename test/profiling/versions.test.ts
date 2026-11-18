import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { targetsOf } from "@/lib/assessments/assessment-records";
import { launchAssessment } from "@/lib/assessments/launcher";
import { ScopeResolutionError } from "@/lib/assessments/scope-resolver";
import { disableSource, editSource, enableSource, registerSource } from "@/lib/catalog/catalog";
import { type RepositorySource, getSource } from "@/lib/catalog/source-records";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { JOB_PRIORITIES, jobs, profileVersions } from "@/lib/db/schema";
import { PROFILING_INITIATIVE_ID, listInitiatives, profilingInitiative, updateReleaseSelections } from "@/lib/initiatives/initiative-records";
import { currentVersion, findVersion, profileSummaries, queueProfile, versionCount, versionOfAssessment, versionsOf } from "@/lib/profiling/versions";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { GitFixture } from "../support/git-fixture";
import { manifest } from "../support/profiles";
import { completeRun } from "../support/scenarios";

/** Drives version +number+ of +source+ to a Profile, or to a failure. */
async function finish(db: Db, source: RepositorySource, number: number, outcome: "profiled" | "failed" = "profiled") {
  const version = findVersion(db, source.id, number)!;
  await completeRun(db, version.assessment, targetsOf(db, version.assessment.id), [source], [outcome === "failed" ? "failed" : { "package.json": manifest({ name: source.name, version: `1.0.${number}` }) }]);
}

describe("profile versions", () => {
  let db: Db;
  let orders: RepositorySource;
  beforeEach(() => {
    db = createTestDb();
    orders = buildSource(db, { name: "orders" });
  });

  it("queues version 1 as a background Run of the Repository profiling initiative, profiling the repository alone at its reference", () => {
    const result = queueProfile(db, orders, "imported");

    expect(result.status).toBe("queued");
    const version = (result as { version: ReturnType<typeof versionsOf>[number] }).version;
    expect(version).toMatchObject({ version: 1, trigger: "imported", headCommit: null, profile: null, commit: null, failure: null });
    expect(version.assessment.initiativeId).toBe(profilingInitiative(db).id);
    expect(targetsOf(db, version.assessment.id).map((target) => [target.sourcePublicId, target.gitRef])).toEqual([[orders.publicId, orders.gitRef]]);
    expect(db.select().from(jobs).all().map((job) => [job.kind, job.priority])).toEqual([["assessment.coordinate", JOB_PRIORITIES.background]]);
    expect(versionOfAssessment(db, version.assessment.id)).toEqual({ version: 1, sourcePublicId: orders.publicId, sourceName: "orders" });
  });

  it("queues no second version while one is queued or running, and numbers the next one after it finishes", async () => {
    queueProfile(db, orders, "imported");
    expect(queueProfile(db, orders, "manual")).toMatchObject({ status: "active", version: { version: 1 } });

    await finish(db, orders, 1);
    expect(queueProfile(db, orders, "manual")).toMatchObject({ status: "queued", version: { version: 2, trigger: "manual" } });
    expect(versionsOf(db, orders.id).map((version) => version.version)).toEqual([2, 1]);
    expect(versionCount(db, orders.id)).toBe(2);
  });

  it("names the version it already queued when the same launch token is submitted twice", async () => {
    queueProfile(db, orders, "imported");
    await finish(db, orders, 1);
    const token = crypto.randomUUID();
    queueProfile(db, orders, "manual", { launchToken: token });
    await finish(db, orders, 2);
    expect(queueProfile(db, orders, "manual", { launchToken: token })).toMatchObject({ status: "active", version: { version: 2 } });
    expect(versionCount(db, orders.id)).toBe(2);
  });

  it("profiles no disabled repository", () => {
    const disabled = buildSource(db, { name: "ledger", enabled: false });
    expect(queueProfile(db, disabled, "manual")).toEqual({ status: "disabled" });
    expect(db.select().from(profileVersions).all()).toEqual([]);
  });

  it("shows the newest profiled version as current while a later one runs or after one fails", async () => {
    queueProfile(db, orders, "imported");
    await finish(db, orders, 1);
    queueProfile(db, orders, "manual");
    await finish(db, orders, 2, "failed");
    queueProfile(db, orders, "manual");

    const versions = versionsOf(db, orders.id);
    expect(versions.map((version) => [version.version, version.assessment.state, version.profile !== null, version.failure?.code ?? null])).toEqual([
      [3, "queued", false, null],
      [2, "failed", false, "source_unavailable"],
      [1, "complete", true, null],
    ]);
    expect(versions[2]!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(currentVersion(db, orders.id)?.version).toBe(1);
    expect(findVersion(db, orders.id, 2)?.failure?.message).toBe("The repository could not be reached");
    expect(findVersion(db, orders.id, 4)).toBeUndefined();
    expect(findVersion(db, orders.id, 0)).toBeUndefined();
  });

  it("summarizes every repository's newest and current versions in one read", async () => {
    const ledger = buildSource(db, { name: "ledger" });
    buildSource(db, { name: "billing" });
    queueProfile(db, orders, "imported");
    await finish(db, orders, 1);
    queueProfile(db, orders, "commit");
    queueProfile(db, ledger, "imported");

    const summaries = profileSummaries(db);
    expect(summaries.size).toBe(2);
    expect(summaries.get(orders.id)).toMatchObject({ latest: { version: 2, state: "queued" }, current: { version: 1 } });
    expect(summaries.get(ledger.id)).toMatchObject({ latest: { version: 1, state: "queued" }, current: null });
  });

  it("keeps versions as recorded, and only for a Repository profiling Run of their repository", () => {
    const version = (queueProfile(db, orders, "imported") as { version: { assessment: { id: number } } }).version;
    expect(() => rawRun(db, "update profile_versions set trigger = 'manual'")).toThrow(/never changed/);
    expect(() => rawRun(db, "delete from profile_versions")).toThrow(/retained/);
    const other = buildSource(db, { name: "ledger" });
    expect(() => rawRun(db, "insert into profile_versions (repository_source_id, assessment_id, version, trigger, created_at) values (?, ?, 2, 'manual', 0)", other.id, version.assessment.id)).toThrow(/Repository profiling Run of its repository/);
  });
});

describe("the Repository profiling initiative", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("takes each Run's scope from its launch, and is the only initiative that does", () => {
    const orders = buildSource(db, { name: "orders" });
    expect(() => launchAssessment(db, PROFILING_INITIATIVE_ID, crypto.randomUUID())).toThrow(ScopeResolutionError);
    expect(() => launchAssessment(db, buildInitiative(db, { sources: [orders] }).publicId, crypto.randomUUID(), getConfig(), { sources: [orders] })).toThrow(/Only the Repository profiling initiative/);
  });

  it("stays out of the operator's Assessments and keeps its name, scope, and empty Releases", () => {
    const initiative = profilingInitiative(db);
    expect(listInitiatives(db).map((item) => item.publicId)).not.toContain(PROFILING_INITIATIVE_ID);
    expect(listInitiatives(db, { systemOwned: true }).map((item) => item.publicId)).not.toContain(PROFILING_INITIATIVE_ID);
    expect(() => updateReleaseSelections(db, PROFILING_INITIATIVE_ID, initiative.lockVersion, [])).toThrow(/can't change/);
    expect(() => rawRun(db, "update initiatives set name = 'Mine' where public_id = ?", PROFILING_INITIATIVE_ID)).toThrow(/keeps its name/);
    expect(() => rawRun(db, "delete from initiatives where public_id = ?", PROFILING_INITIATIVE_ID)).toThrow(/retained/);
    expect(() => rawRun(db, "insert into initiative_targets (initiative_id, repository_source_id, created_at) values (?, ?, 0)", initiative.id, buildSource(db).id)).toThrow(/names its own repository/);
  });
});

describe("profiling as the catalog changes", () => {
  let db: Db;
  let fixture: GitFixture;
  let boundary: SourceBoundary;
  beforeEach(() => {
    db = createTestDb();
    fixture = GitFixture.create("profiling");
    fixture.repo("fleet/orders").write("README.md", "orders").commit();
    boundary = new SourceBoundary(withOverrides(getConfig(), { allowedRoots: [fixture.dir("fleet")] }));
    return () => fixture.cleanup();
  });

  const triggers = (source: RepositorySource) => versionsOf(db, source.id).map((version) => version.trigger);
  const form = (overrides: Partial<{ name: string; cloneUrl: string; gitRef: string }> = {}) => ({ name: "orders", cloneUrl: `file://${fixture.dir("fleet")}/orders`, gitRef: "", ...overrides });

  it("queues a version when a repository is added, and when its clone URL or reference is edited, but not when only its name changes", async () => {
    const source = registerSource(db, form(), boundary);
    expect(triggers(source)).toEqual(["added"]);
    await finish(db, source, 1);

    const renamed = editSource(db, source.publicId, source.lockVersion, form({ name: "orders-service" }), boundary);
    expect(triggers(source)).toEqual(["added"]);
    editSource(db, source.publicId, renamed.lockVersion, form({ name: "orders-service", gitRef: "main" }), boundary);
    expect(triggers(source)).toEqual(["edited", "added"]);
  });

  it("queues a first version when a repository is enabled without one, and leaves a profiled one to the scheduled check", async () => {
    const source = registerSource(db, form(), boundary);
    await finish(db, source, 1);
    disableSource(db, source.publicId);
    enableSource(db, source.publicId);
    expect(triggers(source)).toEqual(["added"]);

    const never = buildSource(db, { name: "ledger", enabled: false });
    enableSource(db, never.publicId);
    expect(triggers(getSource(db, never.publicId))).toEqual(["initial"]);
    expect(db.select().from(profileVersions).where(eq(profileVersions.repositorySourceId, never.id)).all()).toHaveLength(1);
  });
});
