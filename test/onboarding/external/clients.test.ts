import fs from "node:fs";
import path from "node:path";
import { sha256 } from "@repo-facts/contract";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { type FabricateConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { type CdaasClient, type StudioClient, cdaasClient, studioClient } from "@/lib/onboarding/external/clients";
import { ALLOWED_OPERATIONS, PINNED_CONTRACTS } from "@/lib/onboarding/external/contracts";
import { evidenceOf } from "@/lib/onboarding/external/evidence";
import { refreshAll, refreshReference } from "@/lib/onboarding/external/refresh";
import { declareReference } from "@/lib/onboarding/external/references";
import { buildSource } from "../../support/builders";
import { createTestDb } from "../../support/db";
import { ana, onboardPortal, registerMfe } from "../../support/onboarding";
import { type RecordingServer, cdaasVersionsResponse, json, recordingServer, studioModuleResponse } from "../../support/recording-server";

const STUDIO_TOKEN = "studio-service-token-4b1e";
const CDAAS_TOKEN = "cdaas-service-token-9d2f";

describe("Studio and CDaaS clients", () => {
  it("call only GET operations the vendored contracts define, pinned by digest", () => {
    for (const [system, pin] of Object.entries(PINNED_CONTRACTS)) {
      const file = fs.readFileSync(path.resolve("..", pin.file), "utf8");
      expect(sha256(file), system).toBe(pin.digest);
    }
    for (const operation of Object.values(ALLOWED_OPERATIONS)) {
      const contract = JSON.parse(fs.readFileSync(path.resolve("..", PINNED_CONTRACTS[operation.system].file), "utf8")) as { paths: Record<string, Record<string, { operationId?: string }>> };
      expect(operation.method).toBe("GET");
      expect(contract.paths[operation.path]?.get?.operationId, operation.path).toBe(operation.operationId);
    }
  });

  it("expose no method that could send anything but GET", () => {
    expectTypeOf<keyof StudioClient>().toEqualTypeOf<"channel" | "moduleGroup" | "module" | "menu" | "environment" | "environments">();
    expectTypeOf<keyof CdaasClient>().toEqualTypeOf<"applicationView">();
    const config = withOverrides(getConfig(), { onboarding: { studioUrl: "https://studio.example.test", cdaasUrl: "https://cdaas.example.test" } });
    expect(Object.keys(studioClient(config)).sort()).toEqual(["channel", "environment", "environments", "menu", "module", "moduleGroup"]);
    expect(Object.keys(cdaasClient(config))).toEqual(["applicationView"]);
    expect(JSON.stringify(ALLOWED_OPERATIONS)).not.toMatch(/"(POST|PUT|PATCH|DELETE)"/);
  });

  describe("against recording servers", () => {
    let studio: RecordingServer;
    let cdaas: RecordingServer;
    let config: FabricateConfig;
    let db: Db;

    beforeEach(async () => {
      studio = await recordingServer();
      cdaas = await recordingServer();
      config = withOverrides(getConfig(), { onboarding: { studioUrl: `${studio.base}/studio-api`, cdaasUrl: `${cdaas.base}/cdaas-admin`, timeoutSeconds: 1, maxResponseBytes: 20_000 } });
      vi.stubEnv("FABRICATE_STUDIO_TOKEN", STUDIO_TOKEN);
      vi.stubEnv("FABRICATE_CDAAS_TOKEN", CDAAS_TOKEN);
      db = createTestDb();
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await Promise.all([studio.close(), cdaas.close()]);
    });

    it("sends each read as a GET with its system's token, and projects the response (every documented request)", async () => {
      studio.route("/studio-api/api/v1/channels/chan-1", json({ id: 1, uuid: "chan-1", label: "Access", title: "Access", runtimeIds: [3], sealId: 88001, status: { id: 1, name: "Active" }, menus: [{ menuUUId: "menu-1" }] }));
      studio.route("/studio-api/api/v1/module-groups/group-1", json({ id: 2, uuid: "group-1", name: "Payments workspace", description: "", runtimeIds: [3], sealId: 88001, modules: [{ uuid: "mod-1" }] }));
      studio.route("/studio-api/api/v1/module/mod-1", json(studioModuleResponse("mod-1")));
      studio.route("/studio-api/api/v1/menu/menu-1", json({ id: 4, uuid: "menu-1", name: "Payments", channelUUId: "chan-1", envId: 2, modules: [{ uuid: "mod-1" }], entitlements: [{ id: 1, entCodes: "PAY, ACCESS" }] }));
      studio.route("/studio-api/api/v1/environments", json([{ id: 1, label: "UAT", description: "" }, { id: 2, label: "PROD", description: "" }]));
      cdaas.route("/cdaas-admin/v1/apps/payee/views/search", json(cdaasVersionsResponse([{ versionName: "1.0.0" }, { versionName: "1.1.0", live: true }])));
      const read = studioClient(config);
      const results = [await read.channel("chan-1"), await read.moduleGroup("group-1"), await read.module("mod-1"), await read.menu("menu-1"), await read.environment("prod"), await cdaasClient(config).applicationView("payee", "search")];

      expect(results.map((result) => result.outcome)).toEqual(["found", "found", "found", "found", "found", "found"]);
      expect(results[0]).toMatchObject({ projection: { uuid: "chan-1", label: "Access", sealId: "88001", status: "Active", menuUuids: ["menu-1"] } });
      expect(results[2]).toMatchObject({ projection: { appId: "payee", typeLabels: ["Module Federation"] } });
      expect(results[3]).toMatchObject({ projection: { route: null, entitlementCodes: ["PAY", "ACCESS"], moduleUuids: ["mod-1"] } });
      expect(results[4]).toEqual({ outcome: "found", projection: { id: 2, label: "PROD" } });
      expect(results[5]).toMatchObject({ projection: { appId: "payee", viewId: "search", versions: [{ name: "1.0.0", live: false }, { name: "1.1.0", live: true, branch: "main" }] } });
      expect(studio.requests.map((request) => [request.method, request.path, request.authorization])).toEqual([
        ["GET", "/studio-api/api/v1/channels/chan-1", `Bearer ${STUDIO_TOKEN}`],
        ["GET", "/studio-api/api/v1/module-groups/group-1", `Bearer ${STUDIO_TOKEN}`],
        ["GET", "/studio-api/api/v1/module/mod-1", `Bearer ${STUDIO_TOKEN}`],
        ["GET", "/studio-api/api/v1/menu/menu-1", `Bearer ${STUDIO_TOKEN}`],
        ["GET", "/studio-api/api/v1/environments", `Bearer ${STUDIO_TOKEN}`],
      ]);
      expect(cdaas.requests.map((request) => [request.method, request.path, request.authorization])).toEqual([["GET", "/cdaas-admin/v1/apps/payee/views/search", `Bearer ${CDAAS_TOKEN}`]]);
    });

    it("reads a missing resource as not found, and escapes identifiers into the path", async () => {
      studio.route("/studio-api/api/v1/module/gone", (_request, response) => response.writeHead(204).end());
      expect(await studioClient(config).module("gone")).toEqual({ outcome: "not_found" });
      expect(await cdaasClient(config).applicationView("payee", "../../v1/cache")).toEqual({ outcome: "not_found" });
      expect(cdaas.requests.at(-1)!.path).toBe("/cdaas-admin/v1/apps/payee/views/..%2F..%2Fv1%2Fcache");
    });

    it("refuses a redirect, so the token goes nowhere else", async () => {
      studio.route("/studio-api/api/v1/channels/chan-1", (_request, response) => response.writeHead(302, { location: `${cdaas.base}/elsewhere` }).end());
      expect(await studioClient(config).channel("chan-1")).toEqual({ outcome: "unavailable", error: "Studio answered with a redirect, which isn't followed" });
      expect(cdaas.requests).toEqual([]);
    });

    it("stops at the time and size limits", async () => {
      studio.route("/studio-api/api/v1/module/slow", () => undefined);
      studio.route("/studio-api/api/v1/module/large", json({ ...studioModuleResponse("large"), description: "x".repeat(30_000) }));
      studio.route("/studio-api/api/v1/module/streamed", (_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.write(`{"uuid":"streamed","title":"${"y".repeat(25_000)}`);
        response.end('"}');
      });
      expect(await studioClient(config).module("slow")).toEqual({ outcome: "unavailable", error: "Studio didn't answer in time" });
      expect(await studioClient(config).module("large")).toEqual({ outcome: "unavailable", error: "Studio's answer is larger than 20000 bytes" });
      expect(await studioClient(config).module("streamed")).toEqual({ outcome: "unavailable", error: "Studio's answer is larger than 20000 bytes" });
    });

    it("never puts a response body in an error", async () => {
      studio.route("/studio-api/api/v1/module/broken", (_request, response) => response.writeHead(500).end(`internal error for ${STUDIO_TOKEN}: secret detail`));
      studio.route("/studio-api/api/v1/module/odd", json({ uuid: "odd", title: 42, secret: "do-not-store" }));
      studio.route("/studio-api/api/v1/module/text", (_request, response) => response.writeHead(200).end("<html>secret page</html>"));
      const results = [await studioClient(config).module("broken"), await studioClient(config).module("odd"), await studioClient(config).module("text")];
      expect(results).toEqual([
        { outcome: "unavailable", error: "Studio answered HTTP 500" },
        { outcome: "incompatible", error: "The Studio module response didn't match the contract at title" },
        { outcome: "unavailable", error: "Studio's answer isn't valid JSON" },
      ]);
      expect(JSON.stringify(results)).not.toMatch(/secret|do-not-store/);
    });

    it("stores no token in any table or log", async () => {
      const log = vi.spyOn(console, "log");
      const error = vi.spyOn(console, "error");
      const mfe = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee" }), cdaas: { appId: "payee", viewId: "search" }, confirmed: false });
      declareReference(db, { system: "studio", resourceType: "module", externalId: "mod-1", subject: { kind: "microfrontend", id: mfe.id }, source: "person", actor: ana });
      studio.route("/studio-api/api/v1/module/mod-1", (_request, response) => response.writeHead(401).end(STUDIO_TOKEN));
      cdaas.route("/cdaas-admin/v1/apps/payee/views/search", json(cdaasVersionsResponse([{ versionName: "1.0.0", live: true }])));
      await refreshAll(db, config);

      const tables = db.$client.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[];
      for (const { name } of tables) expect(JSON.stringify(db.$client.prepare(`select * from "${name}"`).all()), name).not.toMatch(new RegExp(`${STUDIO_TOKEN}|${CDAAS_TOKEN}`));
      for (const call of [...log.mock.calls, ...error.mock.calls]) expect(JSON.stringify(call)).not.toMatch(new RegExp(`${STUDIO_TOKEN}|${CDAAS_TOKEN}`));
      log.mockRestore();
      error.mockRestore();
    });

    it("records a system that isn't configured as unavailable, never as absent", async () => {
      const portal = onboardPortal(db, "Access");
      const reference = declareReference(db, { system: "studio", resourceType: "channel", externalId: "chan-1", subject: { kind: "portal", id: portal.id }, source: "person", actor: ana });
      const unconfigured = withOverrides(getConfig(), { onboarding: { studioUrl: null, cdaasUrl: null } });
      const { read } = await refreshReference(db, unconfigured, reference);
      expect(read).toMatchObject({ outcome: "unavailable", error: "Studio isn't configured", observationId: null });
      expect(evidenceOf(db, reference).observation).toBeNull();
      expect(studio.requests).toEqual([]);
    });
  });
});
