import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILD_ENTRY, catalogBuilds, queueBuild } from "@/lib/catalog/build";
import { catalogConfiguration } from "@/lib/catalog/configuration";
import { entryDocument, storedEntries } from "@/lib/catalog/entries";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { type FakeRegistry, fakeRegistry, saltCore, saltEntry, saltPackages, unreachable } from "../support/catalog";
import { createTestDb } from "../support/db";

/*
 * The catalog.build job (establish-frontend-registry, task 4.4): it builds
 * one thing at one version from the configured registry and stores the
 * entry, and the job's state and last error are the outcome.
 */

describe("Catalog builds", () => {
  let db: Db;
  let config: FrontendRegistryConfig;
  let registry: FakeRegistry;
  const salt = () => catalogConfiguration(config).things.find((thing) => thing.id === "salt")!;
  const jobById = (id: number) => db.select().from(jobs).where(eq(jobs.id, id)).get()!;
  // Retries wait out a backoff; draining at a later time runs them at once.
  const drain = () => drainJobs(db, jobHandlers(db, config), { now: () => new Date(Date.now() + 3_600_000) });

  beforeEach(() => {
    db = createTestDb();
    registry = fakeRegistry(saltPackages());
    config = withOverrides(getConfig(), { catalog: { registry: registry.registry } });
    vi.stubGlobal("fetch", registry.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("builds Salt 1.75.0 from the registry and stores the entry, naming its job", async () => {
    const job = queueBuild(db, salt(), "1.75.0", "in_use");
    expect(job).toMatchObject({ kind: BUILD_ENTRY, state: "queued", priority: 0 });

    await drain();
    expect(jobById(job.id)).toMatchObject({ state: "succeeded", attempts: 1, lastError: null });
    const [entry, ...others] = storedEntries(db);
    expect(others).toEqual([]);
    expect(entry).toMatchObject({ kind: "design_system", entryId: "salt", version: "1.75.0", buildJobId: job.id });
    // The registry's packages and the fixtures are the same, so the entry is the one an offline build writes.
    expect(entry!.digest).toBe(saltEntry().digest);
    expect(entry!.sources.map((source) => `${source.name}@${source.version}`).slice(0, 4)).toEqual(["@salt-ds/core@1.75.0", "@salt-ds/theme@1.48.0", "@salt-ds/icons@1.19.0", "@salt-ds/mcp@0.0.0-snapshot-20260331141637"]);
    expect(entryDocument(db, entry!.digest)).toMatchObject({ id: "salt", version: "1.75.0", digest: entry!.digest });
    expect(catalogBuilds(db)).toEqual([expect.objectContaining({ jobId: job.id, request: { kind: "design_system", id: "salt", version: "1.75.0", reason: "in_use" }, state: "succeeded", failure: null, entry })]);
  });

  it("records a build that can't reach the registry as failed, with its reason, after retrying, and stores nothing", async () => {
    vi.stubGlobal("fetch", unreachable);
    const job = queueBuild(db, salt(), "1.75.0", "in_use");

    await drain();
    expect(jobById(job.id)).toMatchObject({ state: "failed", attempts: 3, lastError: expect.stringMatching(/^CatalogBuildError: registry_unreachable: Couldn't reach https:\/\/registry\.test/) });
    expect(storedEntries(db)).toEqual([]);
    expect(catalogBuilds(db)[0]).toMatchObject({ state: "failed", entry: null, failure: { reason: "registry_unreachable", message: expect.stringContaining("ECONNREFUSED") } });
  });

  it("fails a build of a version that isn't published at once, without retrying", async () => {
    const job = queueBuild(db, salt(), "9.9.9", "in_use");

    await drain();
    expect(jobById(job.id)).toMatchObject({ state: "failed", attempts: 1 });
    expect(catalogBuilds(db)[0]!.failure).toEqual({ reason: "not_found", message: expect.stringContaining("@salt-ds/core@9.9.9 isn't published") });
    expect(storedEntries(db)).toEqual([]);
  });

  it("stores no new entry when a rebuild writes the digest already stored, and keeps both builds", async () => {
    const first = queueBuild(db, salt(), "1.75.0", "in_use", new Date("2026-11-19T08:00:00Z"));
    await drain();
    const second = queueBuild(db, salt(), "1.75.0", "published", new Date("2026-11-20T08:00:00Z"));
    expect(second.id).not.toBe(first.id);
    await drain();

    expect(jobById(second.id)).toMatchObject({ state: "succeeded", lastError: null });
    expect(storedEntries(db)).toEqual([expect.objectContaining({ buildJobId: first.id })]);
    const builds = catalogBuilds(db);
    expect(builds.map((build) => [build.jobId, build.state, build.entry?.buildJobId ?? null])).toEqual([
      [second.id, "succeeded", null],
      [first.id, "succeeded", first.id],
    ]);
  });

  it("queues one build per thing, version, and rules a day", () => {
    const morning = queueBuild(db, salt(), "1.76.0", "in_use", new Date("2026-11-19T08:00:00Z"));
    expect(queueBuild(db, salt(), "1.76.0", "published", new Date("2026-11-19T20:00:00Z")).id).toBe(morning.id);
    expect(queueBuild(db, salt(), "1.76.0", "in_use", new Date("2026-11-20T08:00:00Z")).id).not.toBe(morning.id);
  });

  it("builds a newer version whose companion packages were released before it", async () => {
    registry = fakeRegistry([...saltPackages(), saltCore("1.76.0", "2026-02-01T00:00:00.000Z")]);
    config = withOverrides(getConfig(), { catalog: { registry: registry.registry } });
    vi.stubGlobal("fetch", registry.fetch);
    queueBuild(db, salt(), "1.76.0", "published");

    await drain();
    const [entry] = storedEntries(db);
    expect(entry).toMatchObject({ version: "1.76.0", packages: expect.arrayContaining([{ name: "@salt-ds/core", version: "1.76.0" }, { name: "@salt-ds/theme", version: "1.48.0" }]) });
    const button = (entryDocument(db, entry!.digest)!.content as { components: { name: string; props: unknown[] }[] }).components.find((component) => component.name === "Button");
    expect(button?.props).toContainEqual({ name: "appearance", values: ["bordered", "solid", "transparent"] });
  });
});
