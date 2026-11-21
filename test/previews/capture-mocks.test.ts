import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { getApplication } from "@/lib/applications/records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { previewBuilds, screenshotFailedCalls } from "@/lib/db/schema";
import { compileSet } from "@/lib/mocks/compile";
import { setApplicationDefault } from "@/lib/mocks/defaults";
import type { RuleInput } from "@/lib/mocks/model";
import { createRule, createSet, findSet } from "@/lib/mocks/records";
import { setDirectory } from "@/lib/mocks/storage";
import { launchBrowser } from "@/lib/previews/browser";
import { runScreenshot } from "@/lib/previews/capture";
import { applyMocks, recordedAddress } from "@/lib/previews/capture-mocks";
import type { PreviewBuild } from "@/lib/previews/records";
import { findScreenshot } from "@/lib/previews/screenshots";
import { startPreviewServer } from "@/lib/previews/static-server";
import { previewBasePath } from "@/lib/previews/toolchain";
import type { Repository } from "@/lib/repositories/repository-records";
import { buildRepository } from "../support/builders";
import { onboard } from "../support/applications";
import { useAppDb } from "../support/next";
import { publishFiles } from "../support/previews";

/*
 * Screenshots with mock sets (add-mock-sets, design decision 11, tasks 7.1
 * and 7.2): a capture applies the default set through the matching engine,
 * the build's own files winning, and records the API calls that still
 * failed: those that couldn't connect, were blocked by CORS, or were
 * answered as not mocked, and not a rule's own error.
 */

/** A build like the Orders portal's, which calls a fake API host, its own config.json, and a relative API path, and lists each answer. */
function page(corsOrigin: string, many = 0): string {
  return `<!doctype html><html lang="en"><head><title>Orders</title></head><body><h1>Orders portal</h1><ul id="out"></ul><script>
const show = (key, text) => { const item = document.createElement("li"); item.id = key; item.textContent = text; document.getElementById("out").append(item); };
const request = new XMLHttpRequest();
request.open("GET", "https://api.orders.test/v1/orders?limit=5&_=" + Date.now());
request.onload = () => show("orders", request.status + " " + request.responseText);
request.onerror = () => show("orders", "failed");
request.send();
const call = (key, url) => fetch(url).then((response) => response.text().then((text) => show(key, response.status + " " + text)), () => show(key, "failed"));
call("config", "config.json");
call("accounts", "api/accounts");
call("rates", "https://api.orders.test/v1/rates");
call("missing", "https://api.orders.test/v1/missing");
call("cors", ${JSON.stringify(`${corsOrigin}/v1/cors`)});
for (let index = 0; index < ${many}; index++) fetch("https://api.orders.test/v1/many/" + index).catch(() => {});
</script></body></html>`;
}

const json = (value: unknown, status = 200) => ({ status, headers: [] as [string, string][], contentType: "application/json", body: new TextEncoder().encode(JSON.stringify(value)), latencyMs: 0 });
const rule = (pattern: string, response: ReturnType<typeof json>): RuleInput => ({ method: "GET", pattern, queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "ignore", responses: [response] });

describe("a failed call's address", () => {
  it("is the path a mock set matches it by, for a call to the capture's own server, and the address as called otherwise", () => {
    const origin = "http://127.0.0.1:64818";
    expect(recordedAddress(`${origin}/__analytics`, origin, "/previews/pvw_orders/")).toBe("/__analytics");
    expect(recordedAddress(`${origin}/previews/pvw_orders/api/accounts?page=2`, origin, "/previews/pvw_orders/")).toBe("/api/accounts?page=2");
    expect(recordedAddress("https://api.orders.test/v1/rates", origin, "/previews/pvw_orders/")).toBe("https://api.orders.test/v1/rates");
    // Another port on the same host is another server.
    expect(recordedAddress("http://127.0.0.1:9311/remoteEntry.js", origin, "/previews/pvw_orders/")).toBe("http://127.0.0.1:9311/remoteEntry.js");
  });
});

describe("screenshots with mock sets", () => {
  const original = getConfig();
  const app = useAppDb();
  let storage: string;
  let config: FrontendRegistryConfig;
  let repository: Repository;
  let cors: http.Server;
  let corsOrigin: string;
  let browser: Browser;

  beforeAll(async () => {
    // A host that answers without CORS headers.
    cors = http.createServer((_request, response) => response.writeHead(200, { "Content-Type": "application/json" }).end("{}"));
    await new Promise<void>((resolve) => cors.listen(0, "127.0.0.1", resolve));
    corsOrigin = `http://127.0.0.1:${(cors.address() as AddressInfo).port}`;
    browser = await launchBrowser(original);
  });
  afterAll(async () => {
    await browser.close();
    await new Promise((resolve) => cors.close(resolve));
  });
  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "capture-mocks-")));
    repository = buildRepository(app.db, { name: "spa-orders", cloneUrl: "https://git.example.com/acme/spa-orders.git" });
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [repository.canonicalUrl], storage, browser: null } });
    setConfig(config);
  });
  afterEach(() => {
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  /** Orders portal with its first build published, and a "Happy path" set answering as +unmatched+ says. */
  function ordersPortal(options: { unmatched?: "pass" | "not_mocked"; many?: number; default?: boolean } = {}) {
    const created = onboard(app.db, config, repository);
    const preview = app.db.select().from(previewBuilds).where(eq(previewBuilds.id, created.latestPreviewId!)).get()!;
    const published: PreviewBuild = publishFiles(app.db, config, preview, { "index.html": page(corsOrigin, options.many), "config.json": '{"from":"build"}' });
    const set = createSet(app.db, created.id, { name: "Happy path", unmatched: options.unmatched ?? "pass" }, null);
    for (const each of [rule("/v1/orders", json({ orders: [{ id: "1001" }] })), rule("/config.json", json({ from: "rule" })), rule("/api/accounts", json({ accounts: 3 })), rule("/v1/missing", json({ error: "Not found" }, 404))]) createRule(app.db, created.id, set.publicId, each, null, config);
    if (options.default !== false) setApplicationDefault(app.db, created.id, set.publicId);
    return { application: created, preview: published, set: findSet(app.db, created.id, set.publicId)! };
  }

  /** What the build shows with +set+ applied, by each call's key, and the calls that failed. */
  async function shown(preview: PreviewBuild, set: ReturnType<typeof ordersPortal>["set"]) {
    const server = await startPreviewServer({ db: app.db, config });
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      const tab = await context.newPage();
      const session = await context.newCDPSession(tab);
      const failures = await applyMocks(context, tab, session, { origin: server.origin, base: previewBasePath(preview.publicId), mocks: { set: compileSet(app.db, set, config), directory: setDirectory(config, set.publicId) } });
      await tab.goto(`${server.origin}${previewBasePath(preview.publicId)}`);
      await tab.locator("#out li").nth(5).waitFor({ timeout: 15_000 });
      await tab.waitForLoadState("networkidle").catch(() => {});
      const texts = Object.fromEntries(await tab.locator("#out li").evaluateAll((items) => items.map((item) => [item.id, item.textContent ?? ""])));
      return { texts: texts as Record<string, string>, failures: failures() };
    } finally {
      await context.close();
      await server.close();
    }
  }

  it("shows the set's recent orders, lets the build's own config.json win over a rule, answers a relative call, and passes unmatched calls through", async () => {
    const { preview, set } = ordersPortal();
    const { texts, failures } = await shown(preview, set);
    expect(texts.orders).toBe('200 {"orders":[{"id":"1001"}]}');
    expect(texts.config).toBe('200 {"from":"build"}');
    expect(texts.accounts).toBe('200 {"accounts":3}');
    // Unmatched calls pass through: the fake API host can't be reached.
    expect(texts.rates).toBe("failed");
    // A mocked error: a rule's own 404 isn't a failure.
    expect(texts.missing).toBe('404 {"error":"Not found"}');
    expect(failures.calls.map((call) => [call.url, call.kind])).toEqual(
      expect.arrayContaining([
        ["https://api.orders.test/v1/rates", "connect"],
        [`${corsOrigin}/v1/cors`, "cors"],
      ]),
    );
    expect(failures.calls.map((call) => call.url)).not.toContain("https://api.orders.test/v1/missing");
  }, 60_000);

  it("answers unmatched calls as not mocked with the 501, which sends nothing and counts as failed", async () => {
    const { preview, set } = ordersPortal({ unmatched: "not_mocked" });
    const { texts, failures } = await shown(preview, set);
    expect(texts.rates).toBe(`501 ${JSON.stringify({ error: "Not mocked", set: "Happy path", method: "GET", url: "https://api.orders.test/v1/rates" })}`);
    expect(failures.calls.find((call) => call.url === "https://api.orders.test/v1/rates")).toMatchObject({ kind: "not_mocked", status: 501 });
  }, 60_000);

  it("captures with the default set, names it in the text alternative, and records the failed calls, keeping 50 and counting the 51st", async () => {
    const { application, preview } = ordersPortal({ many: 51 });
    const outcome = await runScreenshot(app.db, { preview: preview.publicId, requested: findScreenshot(app.db, preview.id)!.requestedAt.getTime() }, { config });
    expect(outcome).toBe("captured");
    const screenshot = findScreenshot(app.db, preview.id)!;
    expect(screenshot).toMatchObject({ state: "ready", mockSetName: "Happy path", mockSetRevision: 5 });
    // A fake API host: each distinct call is recorded as couldn't connect, with the total: the 51 calls, rates, and the CORS call.
    expect(screenshot.failedCalls).toBe(53);
    const kept = app.db.select().from(screenshotFailedCalls).where(eq(screenshotFailedCalls.screenshotId, screenshot.id)).all();
    expect(kept).toHaveLength(50);
    expect(kept.map((call) => call.position)).toEqual(Array.from({ length: 50 }, (_, index) => index));
    expect(kept.filter((call) => call.kind === "connect").length).toBeGreaterThan(40);
    const shownApplication = getApplication(app.db, application.slug);
    expect(shownApplication.screenshot?.mockSet).toBe("Happy path");
  }, 60_000);

  it("captures without a set when the application has no default, and every call goes to its own address", async () => {
    const { preview } = ordersPortal({ default: false });
    await runScreenshot(app.db, { preview: preview.publicId, requested: findScreenshot(app.db, preview.id)!.requestedAt.getTime() }, { config });
    const screenshot = findScreenshot(app.db, preview.id)!;
    expect(screenshot).toMatchObject({ state: "ready", mockSetPublicId: null, mockSetName: null });
    const kept = app.db.select().from(screenshotFailedCalls).where(eq(screenshotFailedCalls.screenshotId, screenshot.id)).all();
    expect(kept.map((call) => call.url)).toEqual(expect.arrayContaining([expect.stringMatching(/^https:\/\/api\.orders\.test\/v1\/orders\?limit=5&_=/), "https://api.orders.test/v1/missing"]));
  }, 60_000);
});
