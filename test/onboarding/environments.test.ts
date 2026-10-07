import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FabricateConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { CatalogDefinitionError, FALLBACK_ENVIRONMENTS, catalogDigest, catalogFromStudio, defineCatalog, environmentCatalog, inCatalogOrder, recordCatalogRead } from "@/lib/onboarding/environments";
import { studioClient } from "@/lib/onboarding/external/clients";
import { refreshEnvironmentCatalog } from "@/lib/onboarding/external/refresh";
import { createTestDb, rawRun } from "../support/db";
import { type RecordingServer, json, recordingServer } from "../support/recording-server";

/*
 * The environment catalog (tasks 3.1 to 3.3): the committed fallback set,
 * Studio's list projected from a read-only GET, and which of them teams
 * select from now.
 */

const STUDIO_TOKEN = "studio-service-token-4b1e";
const HOUR = 60 * 60 * 1000;
const studioList = (environments = [{ id: 11, label: "UAT" }, { id: 12, label: "PROD" }, { id: 9, label: "SIT" }]) => catalogFromStudio(environments).environments;

describe("environment catalog definitions", () => {
  it("commits DEV, UAT, TEST, and PROD as the fallback set, in that order", () => {
    expect(FALLBACK_ENVIRONMENTS.map((environment) => [environment.key, environment.label])).toEqual([
      ["dev", "DEV"],
      ["uat", "UAT"],
      ["test", "TEST"],
      ["prod", "PROD"],
    ]);
    expect(Object.isFrozen(FALLBACK_ENVIRONMENTS)).toBe(true);
  });

  it("canonicalizes a reordered definition to the same catalog and digest", () => {
    const written = [
      { key: " prod ", label: "PROD", order: 3 },
      { key: "dev", label: " DEV ", order: 0 },
      { key: "test", label: "TEST", order: 2 },
      { key: "uat", label: "UAT", order: 1 },
    ];
    const catalog = defineCatalog(written);
    expect(catalog).toEqual(FALLBACK_ENVIRONMENTS);
    expect(catalogDigest(defineCatalog([...written].reverse()))).toBe(catalogDigest(FALLBACK_ENVIRONMENTS));
  });

  it("refuses duplicate and malformed definitions", () => {
    expect(() => defineCatalog([{ key: "uat", label: "UAT" }, { key: "uat", label: "UAT again" }])).toThrow(CatalogDefinitionError);
    expect(() => defineCatalog([{ key: "uat", label: "UAT" }, { key: "uat", label: "UAT again" }])).toThrow(/uat is defined more than once/);
    expect(() => defineCatalog([{ key: "UAT", label: "UAT" }])).toThrow(/isn't an environment key/);
    expect(() => defineCatalog([{ key: "1st", label: "First" }])).toThrow(/isn't an environment key/);
    expect(() => defineCatalog([{ key: "uat", label: "  " }])).toThrow(/needs a label/);
    expect(() => defineCatalog([{ key: "uat", label: "UAT", order: 1 }, { key: "prod", label: "PROD", order: 1 }])).toThrow(/takes order 1/);
  });

  it("projects Studio's list by label and ID, skipping what makes no key or repeats one", () => {
    const projected = catalogFromStudio([{ id: 12, label: "PROD" }, { id: 4, label: "Pre Prod" }, { id: 11, label: "uat" }, { id: 15, label: "Prod" }, { id: 16, label: "  " }, { id: 17, label: "2024" }]);
    expect(projected.environments.map((environment) => [environment.key, environment.label, environment.studioId])).toEqual([
      ["pre-prod", "Pre Prod", 4],
      ["uat", "uat", 11],
      ["prod", "PROD", 12],
    ]);
    expect(projected.skipped).toEqual(["Prod (ID 15) repeats PROD", "(no label) (ID 16) has no usable environment key", "2024 (ID 17) has no usable environment key"]);
    const reordered = catalogFromStudio([{ id: 17, label: "2024" }, { id: 11, label: "uat" }, { id: 15, label: "Prod" }, { id: 4, label: "Pre Prod" }, { id: 12, label: "PROD" }, { id: 16, label: "  " }]);
    expect(catalogDigest(reordered.environments)).toBe(catalogDigest(projected.environments));
  });

  it("orders keys as the catalog lists them, with unlisted keys last", () => {
    expect(inCatalogOrder({ environments: FALLBACK_ENVIRONMENTS }, ["prod", "qa", "dev", "uat", "dr"])).toEqual(["dev", "uat", "prod", "dr", "qa"]);
  });
});

describe("environment catalog resolution", () => {
  let db: Db;
  const t0 = new Date("2026-10-04T08:00:00Z");
  const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);

  beforeEach(() => {
    db = createTestDb();
  });

  it("is the attributed fallback set before Studio is read, or while it isn't configured", () => {
    expect(environmentCatalog(db)).toMatchObject({ source: "fallback", environments: FALLBACK_ENVIRONMENTS, digest: catalogDigest(FALLBACK_ENVIRONMENTS), observedAt: null, stale: false, note: "Studio's environments haven't been read yet, so the fallback set is in use" });
    expect(environmentCatalog(db, { studioConfigured: false }).note).toBe("Studio isn't configured, so the fallback set is in use");
  });

  it("prefers the latest successful Studio read, with its observation time", () => {
    recordCatalogRead(db, { outcome: "found", environments: studioList() }, { readAt: t0 });
    const catalog = environmentCatalog(db, { now: at(1) });
    expect(catalog).toMatchObject({ source: "studio", observedAt: t0, stale: false, note: null });
    expect(catalog.environments.map((environment) => environment.key)).toEqual(["sit", "uat", "prod"]);
    expect(catalog.digest).toBe(catalogDigest(studioList()));
  });

  it("falls back while Studio is unavailable and nothing was read before", () => {
    recordCatalogRead(db, { outcome: "unavailable", error: "Studio didn't answer in time" }, { readAt: t0 });
    expect(environmentCatalog(db, { now: at(1) })).toMatchObject({ source: "fallback", note: "Studio couldn't be read (Studio didn't answer in time), so the fallback set is in use", lastRead: { outcome: "unavailable" } });
  });

  it("keeps Studio's list, stale, through unavailable and incompatible reads, until a read recovers", () => {
    recordCatalogRead(db, { outcome: "found", environments: studioList() }, { readAt: t0 });
    recordCatalogRead(db, { outcome: "incompatible", error: "The Studio environments response didn't match the contract at 0.label" }, { readAt: at(1) });
    expect(environmentCatalog(db, { now: at(2) })).toMatchObject({ source: "studio", observedAt: t0, stale: true, note: "Studio couldn't be read since this list: The Studio environments response didn't match the contract at 0.label" });
    recordCatalogRead(db, { outcome: "unavailable", error: "Studio answered HTTP 503" }, { readAt: at(3) });
    expect(environmentCatalog(db, { now: at(4) })).toMatchObject({ source: "studio", stale: true, note: "Studio couldn't be read since this list: Studio answered HTTP 503" });

    recordCatalogRead(db, { outcome: "found", environments: studioList([{ id: 11, label: "UAT" }, { id: 12, label: "PROD" }]) }, { readAt: at(5) });
    expect(environmentCatalog(db, { now: at(6) })).toMatchObject({ source: "studio", observedAt: at(5), stale: false, note: null });
    expect(environmentCatalog(db, { now: at(6) }).environments.map((environment) => environment.key)).toEqual(["uat", "prod"]);
  });

  it("marks Studio's list stale once it's older than the limit", () => {
    recordCatalogRead(db, { outcome: "found", environments: studioList() }, { readAt: t0 });
    expect(environmentCatalog(db, { now: at(25) })).toMatchObject({ source: "studio", stale: true, note: "Studio hasn't been read recently" });
  });

  it("doesn't use a list read under an earlier contract, or one with no usable environment", () => {
    recordCatalogRead(db, { outcome: "found", environments: studioList() }, { readAt: t0, contractDigest: "b".repeat(64) });
    expect(environmentCatalog(db, { now: at(1) })).toMatchObject({ source: "fallback", note: "Studio's latest list was read under an earlier contract, so the fallback set is in use" });
    recordCatalogRead(db, { outcome: "found", environments: [] }, { readAt: at(2) });
    expect(environmentCatalog(db, { now: at(3) })).toMatchObject({ source: "fallback", note: "Studio listed no usable environment, so the fallback set is in use" });
  });

  it("keeps every read, and never changes one", () => {
    const read = recordCatalogRead(db, { outcome: "found", environments: studioList() }, { readAt: t0 });
    expect(() => rawRun(db, "update environment_catalog_reads set read_at = 1 where id = ?", read.id)).toThrow(/never changed/);
    expect(() => rawRun(db, "delete from environment_catalog_reads")).toThrow(/retained/);
    expect(() => rawRun(db, "insert into environment_catalog_reads (outcome, contract_digest, error, read_at) values ('found', ?, NULL, 1)", "a".repeat(64))).toThrow(/environment_catalog_reads_found/);
  });
});

describe("reading Studio's environment list", () => {
  let studio: RecordingServer;
  let config: FabricateConfig;
  let db: Db;

  beforeEach(async () => {
    studio = await recordingServer();
    config = withOverrides(getConfig(), { onboarding: { studioUrl: `${studio.base}/studio-api`, cdaasUrl: null, timeoutSeconds: 1, maxResponseBytes: 20_000 } });
    vi.stubEnv("FABRICATE_STUDIO_TOKEN", STUDIO_TOKEN);
    db = createTestDb();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await studio.close();
  });

  it("projects the whole list from one GET with the Studio token, and records the read", async () => {
    studio.route("/studio-api/api/v1/environments", json([{ id: 2, label: "PROD", description: "" }, { id: 1, label: "UAT", description: "" }]));

    const read = await refreshEnvironmentCatalog(db, config, { now: new Date() });

    expect(read).toMatchObject({ outcome: "found", error: null });
    expect(environmentCatalog(db).environments.map((environment) => [environment.key, environment.studioId])).toEqual([
      ["uat", 1],
      ["prod", 2],
    ]);
    expect(studio.requests.map((request) => [request.method, request.path, request.authorization])).toEqual([["GET", "/studio-api/api/v1/environments", `Bearer ${STUDIO_TOKEN}`]]);
  });

  it("records a failed or incompatible read without its body, and keeps the token out of storage", async () => {
    studio.route("/studio-api/api/v1/environments", (_request, response) => response.writeHead(500).end(`secret for ${STUDIO_TOKEN}`));
    await refreshEnvironmentCatalog(db, config);
    studio.route("/studio-api/api/v1/environments", json([{ id: "one", label: 7, secret: "do-not-store" }]));
    expect(await studioClient(config).environments()).toEqual({ outcome: "incompatible", error: "The Studio environments response didn't match the contract at 0.id" });
    await refreshEnvironmentCatalog(db, config);
    studio.route("/studio-api/api/v1/environments", (_request, response) => response.writeHead(302, { location: "https://elsewhere.example.com" }).end());
    expect(await studioClient(config).environments()).toEqual({ outcome: "unavailable", error: "Studio answered with a redirect, which isn't followed" });

    const reads = db.$client.prepare("select outcome, error from environment_catalog_reads order by id").all();
    expect(reads).toEqual([
      { outcome: "unavailable", error: "Studio answered HTTP 500" },
      { outcome: "incompatible", error: "The Studio environments response didn't match the contract at 0.id" },
    ]);
    expect(JSON.stringify(reads)).not.toMatch(new RegExp(`secret|do-not-store|${STUDIO_TOKEN}`));
    expect(studio.requests.every((request) => request.method === "GET")).toBe(true);
    expect(environmentCatalog(db).source).toBe("fallback");
  });

  it("reads nothing while Studio isn't configured", async () => {
    expect(await refreshEnvironmentCatalog(db, withOverrides(getConfig(), { onboarding: { studioUrl: null, cdaasUrl: null } }))).toBeNull();
    expect(studio.requests).toEqual([]);
  });
});
