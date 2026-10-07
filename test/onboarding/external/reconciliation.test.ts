import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FabricateConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { getApplication } from "@/lib/onboarding/applications";
import { applicationState, groupByState, microfrontendState, placementState, portalState } from "@/lib/onboarding/external/current-state";
import { evidenceOf, readHistory, recordRead } from "@/lib/onboarding/external/evidence";
import { REFRESH_ONBOARDING, REFRESH_SUBJECT, refreshSubject, requestRefresh, scheduleOnboardingRefresh } from "@/lib/onboarding/external/refresh";
import { declareReference, referenceOf, referencesOf, retireReference } from "@/lib/onboarding/external/references";
import { getMicrofrontend } from "@/lib/onboarding/microfrontends";
import { getPortal } from "@/lib/onboarding/portals";
import { buildSource } from "../../support/builders";
import { createTestDb } from "../../support/db";
import { ana, cdaasView, decide, observeCdaas, observeStudio, onboardApplication, onboardPortal, placementsOf, registerMfe } from "../../support/onboarding";
import { type RecordingServer, cdaasVersionsResponse, json, recordingServer, studioModuleResponse } from "../../support/recording-server";

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 3, hour, minute));
const states = (items: { subject: string; state: string }[]) => items.map((item) => [item.subject, item.state]);

describe("reconciliation with Studio and CDaaS", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("explicit references (task 7.4)", () => {
    it("maps a record only to what someone states, and never infers a mapping", () => {
      const portal = onboardPortal(db, "Access", { sealId: "88001" });
      const mfe = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee" }), sealId: "88001" });
      observeStudio(db, { kind: "portal", id: portal.id }, "channel", "chan-1", { outcome: "found", projection: { uuid: "chan-1", label: "Access", title: "Access", sealId: "88001", status: "Active", runtimeIds: [], menuUuids: [] } });
      // A channel named and SEAL-tagged like the Portal maps nothing else; an MFE's only CDaaS mapping is the one it declared.
      expect(referencesOf(db, { kind: "portal", id: portal.id }).map((reference) => reference.externalId)).toEqual(["chan-1"]);
      expect(referencesOf(db, { kind: "microfrontend", id: mfe.id }).map((reference) => [reference.system, reference.resourceType, reference.externalId, reference.source])).toEqual([["cdaas", "application_view", "payee/payee-search", "declared"]]);
      expect(db.$client.prepare("select count(*) as n from external_references").get()).toEqual({ n: 2 });
    });

    it("refuses a mapping of the wrong kind, an environment-specific one without its environment, and a resource another record holds", () => {
      const portal = onboardPortal(db, "Access");
      const markets = onboardPortal(db, "Markets");
      const declare = (input: Partial<Parameters<typeof declareReference>[1]>) => () => declareReference(db, { system: "studio", resourceType: "channel", externalId: "chan-1", subject: { kind: "portal", id: portal.id }, source: "person", actor: ana, ...input });
      expect(declare({ resourceType: "module" })).toThrow(/doesn't map to a portal/);
      expect(declare({ resourceType: "environment" })).toThrow(/Name the environment/);
      expect(declare({ system: "cdaas", resourceType: "application_view", subject: { kind: "portal", id: portal.id } })).toThrow(/doesn't map to a portal/);
      expect(declare({ externalId: "chan 1" })).toThrow(/letters, digits/);
      declare({})();
      expect(declare({ subject: { kind: "portal", id: markets.id } })).toThrow(/Studio channel chan-1 is already mapped to the Portal Access/);
      const replaced = declare({ externalId: "chan-2" })();
      expect(referencesOf(db, { kind: "portal", id: portal.id }).map((reference) => reference.externalId)).toEqual(["chan-2"]);
      retireReference(db, replaced);
      expect(referencesOf(db, { kind: "portal", id: portal.id })).toEqual([]);
      expect(db.$client.prepare("select external_id, retired_at is not null as retired from external_references order by id").all()).toEqual([
        { external_id: "chan-1", retired: 1 },
        { external_id: "chan-2", retired: 1 },
      ]);
    });
  });

  describe("observations (task 7.5)", () => {
    it("keeps one observation per distinct state and every read, and treats contract drift as Unknown", () => {
      const mfe = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee" }), cdaas: { appId: "payee", viewId: "search" }, confirmed: false });
      const reference = referenceOf(db, { kind: "microfrontend", id: mfe.id }, "cdaas", "application_view")!;
      for (const hour of [8, 9, 10]) recordRead(db, reference, { outcome: "found", projection: cdaasView("payee", "search") }, { readAt: at(hour) });
      recordRead(db, reference, { outcome: "found", projection: { ...cdaasView("payee", "search"), versions: [...cdaasView("payee", "search").versions].reverse() } }, { readAt: at(11) });
      recordRead(db, reference, { outcome: "unavailable", error: "HTTP 503" }, { readAt: at(12) });
      expect(db.$client.prepare("select count(*) as n from external_observations").get()).toEqual({ n: 1 });
      expect(readHistory(db, reference.id).map((row) => [row.read.outcome, row.read.readAt.getUTCHours(), row.observation?.firstObservedAt.getUTCHours() ?? null])).toEqual([
        ["unavailable", 12, null],
        ["found", 11, 8],
        ["found", 10, 8],
        ["found", 9, 8],
        ["found", 8, 8],
      ]);
      expect(evidenceOf(db, reference, at(12)).observation?.observedAt).toEqual(at(11));

      recordRead(db, reference, { outcome: "found", projection: cdaasView("payee", "search") }, { readAt: at(13), contractDigest: "e".repeat(64) });
      expect(evidenceOf(db, reference, at(13))).toMatchObject({ contractDrift: true });
      expect(microfrontendState(db, getMicrofrontend(db, mfe.publicId), { now: at(13) })[0]).toMatchObject({ subject: "CDaaS view", state: "unknown", reason: "The CDaaS application view was last read under an earlier contract" });
    });
  });

  describe("refresh jobs (task 7.6)", () => {
    let cdaas: RecordingServer;
    let studio: RecordingServer;
    let config: FabricateConfig;

    beforeEach(async () => {
      cdaas = await recordingServer();
      studio = await recordingServer();
      config = withOverrides(getConfig(), { onboarding: { studioUrl: studio.base, cdaasUrl: cdaas.base, refreshMinutes: 30, timeoutSeconds: 1 } });
    });

    afterEach(async () => {
      vi.useRealTimers();
      await Promise.all([cdaas.close(), studio.close()]);
    });

    it("schedules one refresh per slot through the worker, which reads every mapping and rechecks readiness", async () => {
      const mfe = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee" }), cdaas: { appId: "payee", viewId: "search" }, confirmed: false });
      cdaas.route("/v1/apps/payee/views/search", json(cdaasVersionsResponse([{ versionName: "1.0.0", live: true }])));
      const now = new Date(Date.UTC(2026, 9, 3, 8, 7));
      vi.useFakeTimers({ toFake: ["Date"], now });

      const queued = scheduleOnboardingRefresh(db, config, now);
      expect(scheduleOnboardingRefresh(db, config, now).map((job) => job.id)).toEqual(queued.map((job) => job.id));
      expect(queued.map((job) => [job.kind, job.idempotencyKey])).toEqual([
        [REFRESH_ONBOARDING, `${REFRESH_ONBOARDING}:2026-10-03T08:00:00.000Z`],
        [REFRESH_ONBOARDING, `${REFRESH_ONBOARDING}:2026-10-03T08:30:00.000Z`],
      ]);
      await drainJobs(db, jobHandlers(db, config));

      expect(cdaas.requests.map((request) => [request.method, request.path])).toEqual([["GET", "/v1/apps/payee/views/search"]]);
      expect(getMicrofrontend(db, mfe.publicId).lifecycle).toBe("ready");
      expect(db.select().from(jobs).all().map((job) => [job.idempotencyKey, job.state])).toEqual([
        [`${REFRESH_ONBOARDING}:2026-10-03T08:00:00.000Z`, "succeeded"],
        [`${REFRESH_ONBOARDING}:2026-10-03T08:30:00.000Z`, "queued"],
      ]);
      expect(scheduleOnboardingRefresh(db, withOverrides(getConfig(), { onboarding: { studioUrl: null, cdaasUrl: null } }))).toEqual([]);
    });

    it("refreshes one record on request, once per minute however often it's asked", async () => {
      const mfe = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee" }), cdaas: { appId: "payee", viewId: "search" }, confirmed: false });
      cdaas.route("/v1/apps/payee/views/search", json(cdaasVersionsResponse([{ versionName: "1.0.0", live: true }])));
      const subject = { kind: "microfrontend" as const, id: mfe.id, publicId: mfe.publicId };
      const first = requestRefresh(db, subject, at(8, 0));
      expect(requestRefresh(db, subject, new Date(at(8, 0).getTime() + 30_000)).id).toBe(first.id);
      expect(requestRefresh(db, subject, at(8, 1)).id).not.toBe(first.id);
      await drainJobs(db, jobHandlers(db, config));
      expect(db.select().from(jobs).all().map((job) => [job.kind, job.state])).toEqual([
        [REFRESH_SUBJECT, "succeeded"],
        [REFRESH_SUBJECT, "succeeded"],
      ]);
      expect(cdaas.requests).toHaveLength(2);
    });

    it("keeps the last observation when a service can't be read, reporting Stale, never Missing (External service is unavailable)", async () => {
      const mfe = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee" }), cdaas: { appId: "payee", viewId: "search" }, confirmed: false });
      cdaas.route("/v1/apps/payee/views/search", json(cdaasVersionsResponse([{ versionName: "1.0.0", live: true }])));
      await refreshSubject(db, config, { kind: "microfrontend", id: mfe.id });
      expect(getMicrofrontend(db, mfe.publicId).lifecycle).toBe("ready");

      cdaas.route("/v1/apps/payee/views/search", (_request, response) => response.writeHead(503).end());
      await refreshSubject(db, config, { kind: "microfrontend", id: mfe.id });
      const state = microfrontendState(db, getMicrofrontend(db, mfe.publicId));
      expect(state[0]).toMatchObject({ state: "stale", reason: "The CDaaS application view couldn't be read since it was last observed: CDaaS answered HTTP 503", values: [{ observed: "payee" }, { observed: "search" }] });
      expect(state.every((item) => item.state !== "missing")).toBe(true);
      expect(getMicrofrontend(db, mfe.publicId).lifecycle).toBe("draft");
    });
  });

  describe("comparisons (task 7.7)", () => {
    it("compares a Portal's channel and environments, citing its revision and the observation", () => {
      const portal = onboardPortal(db, "Access", { sealId: "88001" });
      expect(states(portalState(db, portal))).toEqual([
        ["Studio channel", "unknown"],
        ["PROD Studio environment", "unknown"],
        ["UAT Studio environment", "unknown"],
      ]);
      observeStudio(db, { kind: "portal", id: portal.id }, "channel", "chan-1", { outcome: "found", projection: { uuid: "chan-1", label: "Access", title: null, sealId: "88009", status: null, runtimeIds: [], menuUuids: [] } }, null, at(8));
      declareReference(db, { system: "studio", resourceType: "environment", externalId: "PROD", environment: "prod", subject: { kind: "portal", id: portal.id }, source: "person", actor: ana });
      observeStudio(db, { kind: "portal", id: portal.id }, "channel", "chan-1", { outcome: "found", projection: { uuid: "chan-1", label: "Access", title: null, sealId: "88009", status: null, runtimeIds: [], menuUuids: [] } }, null, at(8));
      const prod = referenceOf(db, { kind: "portal", id: portal.id }, "studio", "environment", "prod")!;
      recordRead(db, prod, { outcome: "not_found" }, { readAt: at(8) });
      const items = portalState(db, getPortal(db, portal.publicId), { now: at(9) });
      expect(items[0]).toMatchObject({ state: "conflicting", desired: "Access revision 1", reference: { externalId: "chan-1" }, observedAt: at(8), values: [{ label: "SEAL ID", expected: "88001", observed: "88009", matches: false }] });
      expect(states(items)).toEqual([
        ["Studio channel", "conflicting"],
        ["PROD Studio environment", "missing"],
        ["UAT Studio environment", "unknown"],
      ]);
      expect(groupByState(items).map((group) => [group.state, group.items.length])).toEqual([
        ["conflicting", 1],
        ["missing", 1],
        ["unknown", 1],
      ]);
    });

    it("compares only team decisions an authoritative system states: never runtimes, contracts, capabilities, events, context, origins, or shared dependencies", () => {
      const portal = onboardPortal(db, "Access", { sealId: "88001" });
      observeStudio(db, { kind: "portal", id: portal.id }, "channel", "chan-1", { outcome: "found", projection: { uuid: "chan-1", label: "Access", title: "Access", sealId: "88001", status: "Active", runtimeIds: [3, 9], menuUuids: [] } });
      const items = portalState(db, getPortal(db, portal.publicId));
      expect(items.map((item) => [item.subject, item.state, item.values.map((value) => value.label)])).toEqual([
        ["Studio channel", "matching", ["SEAL ID"]],
        ["PROD Studio environment", "unknown", []],
        ["UAT Studio environment", "unknown", []],
      ]);
      const labels = JSON.stringify([...items, ...applicationState(db, onboardApplication(db, "Payments workspace", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" } }).application)].map((item) => [item.subject, item.values.map((value) => value.label)]));
      expect(labels).not.toMatch(/runtime|contract|capabilit|event|context|origin|shared/i);
    });

    it("compares an Application's module group, launch target, required children, and rendering mode (Application differs from Studio, Child MFE is declared but not loaded)", () => {
      const repository = buildSource(db, { name: "payee" });
      const host = registerMfe(db, "Payee hub", { repository, rendering: { iframe: null, esm: null, module_federation_2: { exposes: ["./App"] } } });
      const child = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "search" }), rendering: { iframe: null, esm: null, module_federation_2: { exposes: ["./Widget"] } } });
      const { application } = onboardApplication(db, "Payee hub", { launch: { kind: "mfe", microfrontend: host.publicId, mode: "module_federation_2", exposedModule: "./App" }, children: [{ microfrontend: child.publicId, mountKind: "slot", mountKey: "search", required: true, module: null }] });
      observeStudio(db, { kind: "microfrontend", id: host.id }, "module", "mod-hub", { outcome: "found", projection: { uuid: "mod-hub", title: "Payee hub", appId: "payee", url: null, sealId: null, status: null, version: 1, typeLabels: ["ESM"] } });
      observeStudio(db, { kind: "microfrontend", id: child.id }, "module", "mod-search", { outcome: "found", projection: { uuid: "mod-search", title: "Payee search", appId: "payee", url: null, sealId: null, status: null, version: 1, typeLabels: ["MFE"] } });
      observeStudio(db, { kind: "application", id: application.id }, "module_group", "group-1", { outcome: "found", projection: { uuid: "group-1", name: "Payee hub", sealId: "88001", status: null, runtimeIds: [], moduleUuids: ["mod-hub"] } });

      const items = applicationState(db, getApplication(db, application.publicId));
      expect(states(items)).toEqual([
        ["Studio module group", "matching"],
        ["Launch target Payee hub in the module group", "matching"],
        ["Required child Payee search in the module group", "conflicting"],
        ["Rendering mode", "conflicting"],
      ]);
      expect(items[2]).toMatchObject({ desired: "Payee hub revision 1", values: [{ label: "Payee search's module", expected: "mod-search", observed: "Not listed" }] });
      expect(items[3]).toMatchObject({ values: [{ expected: "Module Federation 2", observed: "ESM module" }] });
    });

    it("compares an approved placement's Studio menu in each environment, without comparing the route Studio doesn't state", () => {
      const portal = onboardPortal(db, "Access");
      const { application } = onboardApplication(db, "Payments workspace", {
        launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" },
        placements: [{ placement: null, portal: portal.publicId, menuParent: "payments", route: "/payments", label: "Payments", order: 1, environments: ["prod"], entitlements: { codes: ["PAY"], operator: "any" }, defaultRequested: false }],
      });
      const [placement] = placementsOf(db, application.publicId);
      decide(db, placement!, "approve");
      const placementId = (db.$client.prepare("select id from application_placements where public_id = ?").get(placement) as { id: number }).id;
      expect(states(placementState(db, placementId))).toEqual([["PROD Studio menu for /payments", "unknown"]]);
      observeStudio(db, { kind: "placement", id: placementId }, "menu", "menu-1", { outcome: "found", projection: { uuid: "menu-1", name: "Payments", parentUuid: null, channelUuid: null, envId: 2, route: null, moduleUuids: [], entitlementCodes: ["PAY"] } }, "prod");
      const [item] = placementState(db, placementId);
      expect(item).toMatchObject({ state: "matching", desired: expect.stringContaining("Payments workspace in Access"), values: [{ label: "Label", matches: true }, { label: "Entitlement codes", expected: "PAY", observed: "PAY", matches: true }] });
      expect(item!.values.map((value) => value.label)).not.toContain("Route");
    });

    it("reports an MFE's observed live version as release evidence, Missing when none is live", () => {
      const mfe = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee" }), cdaas: { appId: "payee", viewId: "search" }, confirmed: false });
      observeCdaas(db, mfe, { outcome: "found", projection: { ...cdaasView("payee", "search", 2) } });
      expect(microfrontendState(db, getMicrofrontend(db, mfe.publicId))[1]).toMatchObject({ subject: "Live version", state: "matching", reason: "CDaaS serves 1.1.0", values: [{ observed: "1.1.0" }] });
      observeCdaas(db, mfe, { outcome: "found", projection: { ...cdaasView("payee", "search", 2), versions: cdaasView("payee", "search", 2).versions.map((version) => ({ ...version, live: false })) } });
      expect(microfrontendState(db, getMicrofrontend(db, mfe.publicId))[1]).toMatchObject({ state: "missing", reason: "CDaaS reports no live version of this view", values: [{ observed: "None" }] });
      expect(studioModuleResponse("x").uuid).toBe("x");
    });
  });
});
