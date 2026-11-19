import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILD_ENTRY, buildRequest } from "@/lib/catalog/build";
import { CHECK_CATALOG, checkCatalog, packageUse, runCatalogCheck, scheduleCatalogChecks } from "@/lib/catalog/check";
import { catalogConfiguration } from "@/lib/catalog/configuration";
import { storeEntry } from "@/lib/catalog/entries";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { jobPayload } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { runScheduledProfileCheck } from "@/lib/profiling/check";
import { deleteRepository } from "@/lib/repositories/registration";
import { type FakeRegistry, fakeRegistry, saltCore, saltEntry, saltPackages, unreachable } from "../support/catalog";
import { buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { manifest } from "../support/profiles";
import { seedSurvey } from "../support/scenarios";

/*
 * The Catalog check (establish-frontend-registry, task 4.5; the
 * reference-catalog requirement "Entries are built for every version in
 * use"): a build is queued for each version of a described thing that a
 * registered Repository resolves or declares and that has no entry, and for
 * its newest published version.
 */

const NOW = new Date("2026-11-19T09:30:00.000Z");

/** A Salt application whose lockfile resolves @salt-ds/core at +resolved+, or that only declares +declared+. */
function saltApp(name: string, options: { declared: string; resolved?: string }): Record<string, string> {
  const files: Record<string, string> = { "package.json": manifest({ name, version: "1.0.0", dependencies: { "@salt-ds/core": options.declared } }) };
  if (options.resolved) files["package-lock.json"] = JSON.stringify({ name, lockfileVersion: 3, packages: { "": { name, dependencies: { "@salt-ds/core": options.declared } }, "node_modules/@salt-ds/core": { version: options.resolved } } });
  return files;
}

describe("the Catalog check", () => {
  let db: Db;
  let config: FrontendRegistryConfig;
  let registry: FakeRegistry;
  const salt = () => catalogConfiguration(config).things.find((thing) => thing.id === "salt")!;
  const builds = () => db.select().from(jobs).where(eq(jobs.kind, BUILD_ENTRY)).all().map((job) => buildRequest(jobPayload(job)));
  const seed = async (name: string, files: Record<string, string>) => seedSurvey(db, buildRepository(db, { name }), { files });

  beforeEach(() => {
    db = createTestDb();
    registry = fakeRegistry([...saltPackages(), saltCore("1.76.0", "2026-02-01T00:00:00.000Z"), saltCore("1.77.0", "2026-03-01T00:00:00.000Z")]);
    config = withOverrides(getConfig(), { catalog: { registry: registry.registry } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the versions current Profiles resolve or declare exactly, and the ranges they declare without a resolved version", async () => {
    await seed("locked", saltApp("locked", { declared: "^1.75.0", resolved: "1.76.0" }));
    await seed("exact", saltApp("exact", { declared: "1.75.0" }));
    await seed("ranged", saltApp("ranged", { declared: "^1.75.0" }));
    await seed("linked", saltApp("linked", { declared: "workspace:*" }));
    expect(packageUse(db, "@salt-ds/core")).toEqual({ versions: new Set(["1.76.0", "1.75.0"]), ranges: new Set(["^1.75.0"]) });
  });

  it("queues a build for a version in use without an entry, and for the newest published version (New version appears)", async () => {
    storeEntry(db, saltEntry());
    await seed("web", saltApp("web", { declared: "^1.75.0", resolved: "1.76.0" }));
    await seed("orders", saltApp("orders", { declared: "1.75.0" }));

    const result = await checkCatalog(db, config, { fetch: registry.fetch, now: NOW });
    expect(result).toEqual({
      queued: [
        { thing: "design_system:salt", version: "1.76.0", reason: "in_use" },
        { thing: "design_system:salt", version: "1.77.0", reason: "published" },
      ],
      unreachable: [],
    });
    expect(builds()).toEqual([
      { kind: "design_system", id: "salt", version: "1.76.0", reason: "in_use" },
      { kind: "design_system", id: "salt", version: "1.77.0", reason: "published" },
    ]);
  });

  it("queues the highest published version a declared range allows", async () => {
    storeEntry(db, saltEntry());
    await seed("web", saltApp("web", { declared: "~1.76.0" }));

    await checkCatalog(db, config, { fetch: registry.fetch, now: NOW });
    expect(builds().map((build) => `${build.version} ${build.reason}`)).toEqual(["1.76.0 in_use", "1.77.0 published"]);
  });

  it("queues nothing for versions that have entries, and nothing twice in a day", async () => {
    storeEntry(db, saltEntry());
    await seed("orders", saltApp("orders", { declared: "1.75.0" }));
    registry = fakeRegistry(saltPackages());

    expect((await checkCatalog(db, config, { fetch: registry.fetch, now: NOW })).queued).toEqual([]);
    await seed("web", saltApp("web", { declared: "1.76.0" }));
    await checkCatalog(db, config, { fetch: registry.fetch, now: NOW });
    await checkCatalog(db, config, { fetch: registry.fetch, now: new Date(NOW.getTime() + 3_600_000) });
    expect(builds().map((build) => build.version)).toEqual(["1.76.0"]);
  });

  it("leaves out deleted Repositories and Profiles that aren't current", async () => {
    storeEntry(db, saltEntry());
    registry = fakeRegistry(saltPackages());
    const gone = buildRepository(db, { name: "gone" });
    await seedSurvey(db, gone, { files: saltApp("gone", { declared: "1.74.0" }) });
    deleteRepository(db, gone.publicId, "gone");
    const web = buildRepository(db, { name: "web" });
    await seedSurvey(db, web, { files: saltApp("web", { declared: "1.73.0" }) });
    await seedSurvey(db, web, { files: saltApp("web", { declared: "1.75.0" }) });
    await seedSurvey(db, web, { fromConfiguredReference: false, files: saltApp("web", { declared: "1.72.0" }) });

    expect(packageUse(db, "@salt-ds/core").versions).toEqual(new Set(["1.75.0"]));
    expect((await checkCatalog(db, config, { fetch: registry.fetch, now: NOW })).queued).toEqual([]);
  });

  it("rebuilds each version whose entries were all built before the team's rules changed", async () => {
    storeEntry(db, saltEntry());
    registry = fakeRegistry(saltPackages());
    // The rules as they stand now say something the stored entry's rules didn't.
    const changed = { things: [{ ...salt(), rules: { ...salt().rules, version: `sha256:${"0".repeat(64)}` } }] };

    const result = await checkCatalog(db, config, { catalog: changed, fetch: registry.fetch, now: NOW });
    expect(result.queued).toEqual([{ thing: "design_system:salt", version: "1.75.0", reason: "rules" }]);
  });

  it("queues the builds that need no registry when the registry can't be reached, then fails with its reason", async () => {
    storeEntry(db, saltEntry());
    await seed("web", saltApp("web", { declared: "^1.75.0", resolved: "1.76.0" }));
    await seed("ranged", saltApp("ranged", { declared: "~1.77.0" }));

    await expect(runCatalogCheck(db, config, { slot: "2026-11-19T00:00:00.000Z" }, { fetch: unreachable, now: NOW })).rejects.toThrow(/The registry couldn't be read for salt: registry_unreachable: Couldn't reach https:\/\/registry\.test/);
    expect(builds().map((build) => build.version)).toEqual(["1.76.0"]);
  });

  it("runs once a day, from when the worker starts, and after each profiling check", async () => {
    const scheduled = scheduleCatalogChecks(db, NOW);
    expect(scheduled.map((job) => [job.kind, job.runAfter.toISOString(), jobPayload(job)])).toEqual([
      [CHECK_CATALOG, NOW.toISOString(), { slot: "2026-11-19T00:00:00.000Z" }],
      [CHECK_CATALOG, "2026-11-20T00:00:00.000Z", { slot: "2026-11-20T00:00:00.000Z" }],
    ]);
    // A restart the same day queues nothing new.
    expect(scheduleCatalogChecks(db, new Date(NOW.getTime() + 60_000)).map((job) => job.id)).toEqual(scheduled.map((job) => job.id));

    runScheduledProfileCheck(db, config, { now: NOW });
    const after = db.select().from(jobs).where(eq(jobs.kind, CHECK_CATALOG)).all().map(jobPayload);
    expect(after).toContainEqual({ after: "2026-11-19T09:00:00.000Z" });
  });

  it("runs as a worker job that queues tomorrow's check and the builds it found", async () => {
    vi.stubGlobal("fetch", registry.fetch);
    storeEntry(db, saltEntry());
    await seed("web", saltApp("web", { declared: "1.76.0" }));
    const [today] = scheduleCatalogChecks(db, NOW);

    await drainJobs(db, jobHandlers(db, config), { limit: 1, now: () => NOW });
    expect(db.select().from(jobs).where(eq(jobs.id, today!.id)).get()).toMatchObject({ state: "succeeded" });
    expect(db.select().from(jobs).where(eq(jobs.kind, CHECK_CATALOG)).all().map((job) => job.runAfter.toISOString())).toEqual([NOW.toISOString(), "2026-11-20T00:00:00.000Z"]);
    expect(builds().map((build) => build.version)).toEqual(["1.76.0", "1.77.0"]);
  });
});
