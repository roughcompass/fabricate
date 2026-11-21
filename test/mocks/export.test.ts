import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { EXPORT_ORIGIN, exportFileName, exportHar } from "@/lib/mocks/export";
import { createDraft, saveDraft } from "@/lib/mocks/imports";
import type { MockRule } from "@/lib/mocks/model";
import { addRulesFromCalls, allRules, createRule, createSet } from "@/lib/mocks/records";
import { readBody, setDirectory } from "@/lib/mocks/storage";
import type { ViewedApplication } from "@/lib/workspaces/access";
import { ensureWorkspace } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { viewedApplicationIn } from "../support/views";

/*
 * Exporting a set as HAR 1.2 (add-mock-sets, design decision 13, task 3.6;
 * mock-sets spec, "A mock set exports as HAR 1.2"): one entry per response,
 * each recording its rule, so importing the file restores the same rules.
 */

const CHROME = fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "har", "orders-portal.chrome.har"), "utf8");

describe("exporting a mock set", () => {
  let db: Db;
  let storage: string;
  let config: FrontendRegistryConfig;
  let orders: ViewedApplication;
  let workspace: number;

  beforeEach(() => {
    db = createTestDb();
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "mock-export-"));
    config = withOverrides(getConfig(), { previews: { storage } });
    orders = viewedApplicationIn(db, "Orders portal");
    workspace = ensureWorkspace(db, "w".repeat(43)).id;
  });
  afterEach(() => {
    db.$client.close();
    fs.rmSync(storage, { recursive: true, force: true });
  });

  /** Uploads +source+ as a new set named +name+, keeping every call, binary ones too. */
  function imported(source: string, name: string) {
    const draft = createDraft(db, { applicationId: orders.id, workspaceId: workspace, fileName: "upload.har", target: null, setName: name, fromOnboarding: false }, source, config);
    return saveDraft(db, { ...draft, unchecked: [], makeDefault: false }, null, config);
  }

  /** What makes two rules the same: their request side, state, and responses with their bodies' bytes. */
  const comparable = (rule: MockRule, setPublicId: string) => ({
    method: rule.method,
    origin: rule.origin,
    pattern: rule.pattern,
    queryMode: rule.queryMode,
    query: rule.query,
    queryIgnored: rule.queryIgnored,
    bodyMode: rule.bodyMode,
    body: rule.body && readBody(setDirectory(config, setPublicId), rule.body.digest)?.toString("base64"),
    enabled: rule.enabled,
    responses: rule.responses.map((response) => ({ ...response, body: response.body && { type: response.body.type, bytes: readBody(setDirectory(config, setPublicId), response.body.digest)?.toString("base64") } })),
  });

  it("writes HAR 1.2, one entry for each response of each rule with one, each recording its rule", () => {
    const set = createSet(db, orders.id, { name: "Happy path" }, null);
    createRule(db, orders.id, set.publicId, { method: "*", pattern: "/v1/accounts/:id", queryMode: "ignore_listed", query: [["limit", "5"]], queryIgnored: ["_"], bodyMode: "ignore", responses: [200, 404].map((status) => ({ status, headers: [["X-Request-Id", "1"]], contentType: "application/json", body: new TextEncoder().encode(`{"status":${status}}`), latencyMs: 40 })) }, null, config);
    addRulesFromCalls(db, orders.id, set.publicId, [{ method: "GET", url: "https://api.orders.test/v1/rates" }], null, config);
    const har = exportHar(db, set, config);
    expect(har.log.version).toBe("1.2");
    expect(har.log.creator.name).toBe("Frontend Registry");
    expect(har.log.entries).toHaveLength(2);
    const [first] = har.log.entries;
    expect(first!.request).toMatchObject({ method: "GET", url: `${EXPORT_ORIGIN}/v1/accounts/:id?limit=5`, queryString: [{ name: "limit", value: "5" }] });
    expect(first!.response).toMatchObject({ status: 200, headers: [{ name: "Content-Type", value: "application/json" }, { name: "X-Request-Id", value: "1" }], content: { mimeType: "application/json", text: '{"status":200}' } });
    expect(har.log.entries.map((entry) => entry._frontendRegistry)).toEqual(
      [0, 1].map(() => ({ rule: expect.stringMatching(/^mkr_/), method: "*", pattern: "/v1/accounts/:id", queryMode: "ignore_listed", ignored: ["_"], bodyMode: "ignore", enabled: true, position: 0 })),
    );
    expect(exportFileName("orders-portal", set)).toBe("orders-portal-happy-path.har");
  });

  it("Exporting and importing again: the imported Chrome fixture comes back with the same rules, patterns, matching, responses, and order", () => {
    const happy = imported(CHROME, "Happy path");
    const exported = JSON.stringify(exportHar(db, happy, config));
    const again = imported(exported, "Happy path again");
    const before = allRules(db, happy.id).map((rule) => comparable(rule, happy.publicId));
    const after = allRules(db, again.id).map((rule) => comparable(rule, again.publicId));
    expect(after).toHaveLength(11);
    expect(after).toEqual(before);
  });

  it("restores rules written without an origin, off, or matching any method", () => {
    const set = createSet(db, orders.id, { name: "Written" }, null);
    createRule(db, orders.id, set.publicId, { method: "ANY", pattern: "/v1/files/*", queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "json", body: { bytes: new TextEncoder().encode('{"q":1}'), type: "application/json" }, enabled: false, responses: [{ status: 503, headers: [], contentType: "text/plain", body: new TextEncoder().encode("down"), latencyMs: 0 }] }, null, config);
    const again = imported(JSON.stringify(exportHar(db, set, config)), "Written again");
    expect(allRules(db, again.id).map((rule) => comparable(rule, again.publicId))).toEqual(allRules(db, set.id).map((rule) => comparable(rule, set.publicId)));
  });
});
