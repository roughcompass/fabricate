import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DataPanel } from "@/components/toolbar/data/data-panel";
import { SCREENSHOTS_STILL_APPLY, mockRefusalText } from "@/components/toolbar/data/mock-refusals";
import { addRow, callRow, canCreateRule, outcomeCounts, socketRow } from "@/components/toolbar/data/request-log";
import type { LoggedCall } from "@/components/toolbar/routing/mock-log";
import { ViewWorker, workerRefusal } from "@/components/toolbar/routing/view-worker";

/*
 * The Data tool's panel (add-mock-sets, design decision 15, task 10.5;
 * template-demo/mock-data spec, "Data says where a mock set can't apply"),
 * and its request list's rows.
 */

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));

vi.mock("@/components/toolbar/data/data-state", () => ({ useData: () => state.data }));
vi.mock("@/components/toolbar/view-context", () => ({ useToolbarView: () => ({ slug: "orders-portal", name: "Orders portal", preview: null, key: "orders-portal" }) }));
vi.mock("@/components/toolbar/target-document", () => ({ useTargetDocument: () => ({ base: "/previews/pvw_orders/", state: "ready" }) }));
vi.mock("@/components/toolbar/tool-panel", () => ({ ToolPanel: ({ title, children }: { title: string; children: React.ReactNode }) => createElement("div", { role: "dialog", "aria-label": title }, children) }));

const HAPPY = { publicId: "mks_happy", name: "Happy path", ruleCount: 7, revision: 3, isDefault: true };

describe("Data in a non-secure context", () => {
  it("refuses before registering anything, as routing does", async () => {
    const register = vi.fn();
    const environment = { origin: "http://orders.example", secure: false, container: { register, getRegistration: vi.fn() } as unknown as ServiceWorkerContainer, storage: null };
    expect(await workerRefusal("/previews/pvw_orders/", environment)).toBe("insecure");
    const worker = new ViewWorker({ view: "/run/orders-portal" }, "/previews/pvw_orders/", null, environment);
    worker.setMocks({ application: "orders-portal", set: "mks_happy", revision: 3, latency: "off" });
    expect(await worker.prepare(null)).toMatchObject({ refusal: "insecure", readiness: null });
    expect(register).not.toHaveBeenCalled();
  });

  it("says why no set can apply, that screenshots still apply the default, and offers no choice of set", () => {
    state.data = { sets: [HAPPY], active: { set: HAPPY, source: "application" }, applies: false, problem: null, refusal: mockRefusalText("insecure"), registered: null, latency: "off", requests: [], refresh: () => {} };
    const html = renderToStaticMarkup(createElement(DataPanel));
    expect(html).toContain("Mock sets need HTTPS. Browsers allow the service worker they use only on pages served over HTTPS or from localhost.");
    expect(html).toContain(SCREENSHOTS_STILL_APPLY);
    expect(html).not.toContain('type="radio"');
    expect(html).toContain("Calls are listed while a mock set applies.");
    expect(html).not.toContain("New mock set");
  });
});

describe("Data's request list", () => {
  const call = (overrides: Partial<LoggedCall>): LoggedCall => ({ type: "frontend-registry:mocks", id: "1", view: "v", page: "p", method: "GET", url: "https://api.orders.test/v1/rates", outcome: "failed", rule: null, status: null, error: "Couldn't connect or was blocked by CORS", at: 1, durationMs: 12, body: null, set: "mks_happy", revision: 3, ...overrides });

  it("says each call's outcome in words, and offers Create rule for a call no rule answered", () => {
    const failed = callRow(call({}));
    expect(failed).toMatchObject({ summary: "Failed, couldn't connect or was blocked by CORS", status: "Couldn't connect or was blocked by CORS", outcome: "failed" });
    expect(canCreateRule(failed)).toBe(true);
    const mocked = callRow(call({ id: "2", url: "https://api.orders.test/v1/orders", outcome: "mocked", rule: { id: "mkr_orders", label: "GET /v1/orders", response: 1 }, status: 200, error: null }));
    expect(mocked).toMatchObject({ summary: "Mocked by rule GET /v1/orders", status: "200" });
    expect(canCreateRule(mocked)).toBe(false);
    expect(callRow(call({ id: "3", outcome: "failed", status: 404, error: null })).summary).toBe("Failed, 404");
    expect(callRow(call({ id: "4", outcome: "not-matched", status: 501, error: null })).summary).toBe("Not matched");
    expect(callRow(call({ id: "5", outcome: "passed", status: 200, error: null })).summary).toBe("Passed through");
  });

  it("lists a WebSocket as failed when it never opened, saying WebSockets aren't mocked, and updates it in place", () => {
    const connecting = socketRow({ id: 1, url: "wss://api.orders.test/v1/ticker", state: "connecting" }, 10);
    const failed = socketRow({ id: 1, url: "wss://api.orders.test/v1/ticker", state: "failed" }, 20);
    expect(failed).toMatchObject({ method: "WebSocket", outcome: "failed", summary: "Failed. WebSockets aren't mocked yet.", status: "Never opened" });
    expect(canCreateRule(failed)).toBe(false);
    const rows = addRow(addRow([], connecting), failed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "failed", at: 10 });
  });

  it("keeps the newest 500, newest first, and counts each outcome", () => {
    let rows: ReturnType<typeof addRow> = [];
    for (let index = 0; index < 510; index++) rows = addRow(rows, callRow(call({ id: String(index), outcome: index % 2 ? "mocked" : "failed" })));
    expect(rows).toHaveLength(500);
    expect(rows[0]!.id).toBe("509");
    expect(outcomeCounts(rows)).toEqual({ mocked: 250, passed: 0, "not-matched": 0, failed: 250 });
  });
});
