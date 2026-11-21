import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggedCall } from "@/components/toolbar/routing/mock-log";
import { viewId } from "@/components/toolbar/routing/table";
import { ORDERS, ORDERS_API, ORIGIN, mockWorker } from "../support/view-worker";

/*
 * The view's worker's request log (add-mock-sets, design decision 2, task
 * 8.4): each API call it handles for a view applying a set is sent to the
 * toolbar, tagged with the view and the page that made it, so a tab lists
 * only its own frame's calls, with what answered each and, for a call that
 * wasn't matched or that failed, its body up to 64 KB.
 */

describe("the request log", () => {
  const worker = mockWorker();
  beforeEach(() => worker.start());
  afterEach(() => vi.unstubAllGlobals());
  const VIEW = viewId(ORDERS);
  /** Whether +entry+ is a call of the page +page+ that a tab's frame shows for +view+, as the Data tool lists them. */
  const callOfFrame = (entry: LoggedCall, view: string, page: string | null) => entry.view === view && page !== null && entry.page === page;

  it("tags each call with its view and page, so two tabs on one view each list only their own frame's calls", async () => {
    await worker.arm();
    // Two tabs of Orders portal: two frames of the same view, each with its own page.
    await worker.open("tab-1-frame");
    await worker.open("tab-2-frame");
    worker.announce("tab-1-frame", "page-1");
    worker.announce("tab-2-frame", "page-2");
    await worker.call(`${ORDERS_API}/v1/orders`, "tab-1-frame");
    await worker.call(`${ORDERS_API}/v1/exports/9`, "tab-2-frame");
    await worker.call(`${ORDERS_API}/v1/rates`, "tab-2-frame");
    expect(worker.logged.map((entry) => [entry.view, entry.page])).toEqual([
      [VIEW, "page-1"],
      [VIEW, "page-2"],
      [VIEW, "page-2"],
    ]);
    const tab = (page: string) => worker.logged.filter((entry) => callOfFrame(entry, VIEW, page)).map((entry) => entry.url);
    expect(tab("page-1")).toEqual([`${ORDERS_API}/v1/orders`]);
    expect(tab("page-2")).toEqual([`${ORDERS_API}/v1/exports/9`, `${ORDERS_API}/v1/rates`]);
    // Another view's tab, or a frame whose page isn't known yet, lists none of them.
    expect(worker.logged.filter((entry) => callOfFrame(entry, viewId({ view: "/run/orders-portal", share: "tok" }), "page-1"))).toEqual([]);
    expect(worker.logged.filter((entry) => callOfFrame(entry, VIEW, null))).toEqual([]);
  });

  it("logs a dedicated worker's calls under the page that started it", async () => {
    await worker.arm();
    await worker.open();
    await worker.file(`${ORIGIN}/previews/pvw_desk/assets/rates-worker.js`, "worker", "frame-1", "rates-worker");
    // The page names itself after its worker started.
    worker.announce("frame-1", "page-1");
    await worker.call(`${ORDERS_API}/v1/rates`, "rates-worker");
    expect(worker.logged.at(-1)).toMatchObject({ page: "page-1", outcome: "failed" });
  });

  it("names the frame's page again after the worker was stopped, from the toolbar's arm", async () => {
    worker.world.clients.set("frame-1", { id: "frame-1", url: `${ORIGIN}/previews/pvw_desk/accounts`, frameType: "nested", type: "window" });
    await worker.arm(ORDERS, { frame: `${ORIGIN}/previews/pvw_desk/accounts`, page: "page-1" });
    await worker.call(`${ORDERS_API}/v1/orders`, "frame-1");
    expect(worker.logged.at(-1)).toMatchObject({ page: "page-1", outcome: "mocked" });
  });

  it("gives each call its method, address, outcome, rule and response, status or error, and time, and the body only of calls not answered by a rule", async () => {
    await worker.arm();
    await worker.open();
    const before = Date.now();
    await worker.call(`${ORDERS_API}/v1/orders/search`, "frame-1", { method: "POST", body: '{"status":"closed"}' });
    await worker.call(`${ORDERS_API}/v1/rates`, "frame-1", { method: "POST", body: '{"currency":"EUR"}' });
    await worker.call(`${ORDERS_API}/v1/rates`, "frame-1", { method: "POST", body: "x".repeat(64 * 1024 + 1) });
    const [mocked, failed, large] = worker.logged;
    expect(mocked).toMatchObject({ type: "frontend-registry:mocks", method: "POST", outcome: "mocked", rule: { id: "mkr_search_closed", label: "POST /v1/orders/search", response: 1 }, status: 200, error: null, body: null });
    expect(failed).toMatchObject({ method: "POST", url: `${ORDERS_API}/v1/rates`, outcome: "failed", rule: null, status: null, error: "Couldn't connect or was blocked by CORS", body: '{"currency":"EUR"}' });
    expect(large).toMatchObject({ outcome: "failed", body: null });
    expect(mocked!.at).toBeGreaterThanOrEqual(before);
    expect(mocked!.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Set(worker.logged.map((entry) => entry.id)).size).toBe(3);
  });
});
