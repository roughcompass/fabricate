import { expect, vi } from "vitest";
import type { LoggedCall } from "@/components/toolbar/routing/mock-log";
import { type ArmedMocks, ROUTING_MESSAGE, type ViewTable } from "@/components/toolbar/routing/table";
import type { CompiledResponse, CompiledRule, CompiledSet } from "@/lib/mocks/compiled";
import { parsePattern } from "@/lib/mocks/engine";

/*
 * The view's service worker (src/components/toolbar/routing/worker.ts) run
 * in a test: its global scope as the browser gives it, the Frontend
 * Registry and a build it fetches from, and the calls it logs.
 */

export const ORIGIN = "http://127.0.0.1:3100";
export const ORDERS_API = "https://api.orders.test";
/** The build's path, the worker's scope. */
export const DESK = "/previews/pvw_desk/";

/** A service worker's scope the worker registers its listeners on, with its documents, as the browser keeps them. */
export function workerScope() {
  const listeners = new Map<string, (event: unknown) => void>();
  const clients = new Map<string, { id: string; url: string; frameType: string; type?: string }>();
  return {
    listeners,
    clients,
    scope: {
      location: new URL(`${ORIGIN}/toolbar/routing-worker.js`),
      clients: { matchAll: async () => [...clients.values()], get: async (id: string) => clients.get(id) },
      skipWaiting: async () => {},
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    },
  };
}

const json = (value: unknown, status = 200, latencyMs = 0): CompiledResponse => ({ status, headers: [], contentType: "application/json", latencyMs, body: { inline: JSON.stringify(value), base64: false } });
const rule = (id: string, method: string | null, pattern: string, responses: CompiledResponse[], extra: Partial<CompiledRule> = {}): CompiledRule => ({
  id,
  label: `${method ?? "Any"} ${pattern}`,
  method,
  origin: null,
  path: parsePattern(pattern)!,
  query: { mode: "ignore-all", params: [], ignored: [] },
  body: { mode: "ignore" },
  responses,
  ...extra,
});

/** Orders portal's "Happy path", compiled, its rules in precedence order. */
export const HAPPY: CompiledSet = {
  set: "mks_happy",
  name: "Happy path",
  revision: 3,
  hosts: { mode: "any" },
  unmatched: "pass",
  rules: [
    rule("mkr_search_closed", "POST", "/v1/orders/search", [json({ orders: ["closed"] })], { body: { mode: "json", value: { status: "closed" } } }),
    rule("mkr_search_open", "POST", "/v1/orders/search", [json({ orders: ["open"] })], { body: { mode: "json", value: { status: "open" } } }),
    rule("mkr_stream", "GET", "/v1/orders/stream", [{ status: 200, headers: [], contentType: "text/event-stream", latencyMs: 0, body: { inline: "data: 1\n\ndata: 2\n\ndata: 3\n\n", base64: false } }]),
    rule("mkr_export", "GET", "/v1/exports/9", [json({ state: "pending" }), json({ state: "pending" }), json({ state: "ready" })]),
    rule("mkr_report", "GET", "/v1/report", [{ status: 200, headers: [], contentType: "application/json", latencyMs: 40, body: { digest: "d1g3st", size: 20_000 } }]),
    rule("mkr_orders", "GET", "/v1/orders", [json({ orders: [1, 2, 3] })]),
    rule("mkr_accounts", "GET", "/api/accounts", [json({ accounts: [42] })]),
    rule("mkr_config", "GET", "/config.json", [json({ from: "the rule" })]),
    rule("mkr_assets", "GET", "/assets/*", [json({ from: "the rule" })]),
  ],
};

export const MOCKS: ArmedMocks = { application: "orders-portal", set: "mks_happy", revision: 3, latency: "off" };
/** Orders portal's own view, applying "Happy path". */
export const ORDERS: ViewTable = { view: "/run/orders-portal", share: null, scope: DESK, routes: [], kept: [], mocks: MOCKS };

/**
 * The worker loaded afresh by `start`, with the Frontend Registry serving
 * the set's endpoints, the build serving its page, `config.json`, and a
 * script, and every other host unreachable, as `.test` hosts are.
 */
export function mockWorker() {
  /** Every address the worker fetched, with its method. */
  const fetched: string[] = [];
  const logged: LoggedCall[] = [];
  let compiled: () => Response = () => Response.json(HAPPY);
  const harness = {
    world: workerScope(),
    fetched,
    logged,
    /** Answers the compiled set's endpoint with +answer+ from now on. */
    serve(answer: () => Response) {
      compiled = answer;
    },
    async start() {
      vi.resetModules();
      harness.world = workerScope();
      fetched.length = 0;
      logged.length = 0;
      compiled = () => Response.json(HAPPY);
      vi.stubGlobal("self", harness.world.scope);
      vi.stubGlobal(
        "BroadcastChannel",
        class {
          postMessage(entry: LoggedCall) {
            logged.push(entry);
          }
        },
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: Request | string, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.url;
          const method = typeof input === "string" ? (init?.method ?? "GET") : input.method;
          fetched.push(`${method} ${url}`);
          const path = url.startsWith(ORIGIN) ? new URL(url).pathname : null;
          if (path === "/api/applications/orders-portal/mock-sets/mks_happy/compiled") return compiled();
          if (path === "/api/applications/orders-portal/mock-sets/mks_happy/bodies/d1g3st") return new Response(JSON.stringify({ rows: 500 }));
          // The build: its page, its own config.json and script, and 404 for anything else; it answers 405 to other methods.
          if (path?.startsWith(DESK)) {
            if (method !== "GET") return new Response("Method not allowed", { status: 405 });
            if (path === DESK) return new Response("<p>Orders portal</p>", { headers: { "content-type": "text/html" } });
            if (path === `${DESK}config.json`) return Response.json({ from: "the build" });
            if (path === `${DESK}assets/index.js`) return new Response("console.log(1)", { headers: { "content-type": "text/javascript" } });
            return new Response("Not found", { status: 404 });
          }
          if (path !== null) return new Response("Not found", { status: 404 });
          // `.test` never resolves.
          throw new TypeError("fetch failed");
        }),
      );
      await import("@/components/toolbar/routing/worker");
    },
    /** Arms +table+, returning the worker's answer, which comes once the set is ready. */
    async arm(table: ViewTable = ORDERS, extra: { frame?: string | null; page?: string | null } = {}): Promise<unknown> {
      const port = { postMessage: vi.fn() };
      let waited: Promise<unknown> = Promise.resolve();
      harness.world.listeners.get("message")!({ data: { type: ROUTING_MESSAGE, command: "arm", table, frame: null, ...extra }, ports: [port], waitUntil: (promise: Promise<unknown>) => (waited = promise) });
      expect(port.postMessage).not.toHaveBeenCalled();
      await waited;
      return port.postMessage.mock.calls[0]![0];
    },
    /** Dispatches a fetch event for +request+ from +clientId+, returning what the worker answered, or null when it left it to the browser. */
    async dispatch(request: Request | Record<string, unknown>, clientId: string, resultingClientId = ""): Promise<Response | null> {
      let answered: Promise<Response> | null = null;
      harness.world.listeners.get("fetch")!({ request, clientId, resultingClientId, respondWith: (response: Promise<Response>) => (answered = Promise.resolve(response)), waitUntil: () => {} });
      return answered ? await answered : null;
    },
    /** The frame's navigation from the view's address, which makes +client+ the view's document. */
    open: (client = "frame-1", referrer = `${ORIGIN}/run/orders-portal/accounts`) => harness.dispatch({ url: `${ORIGIN}${DESK}accounts`, method: "GET", mode: "navigate", destination: "iframe", referrer }, "", client),
    /** The frame agent of +client+'s page naming the page to the worker. */
    announce(client: string, page: string) {
      harness.world.listeners.get("message")!({ data: { type: "frontend-registry:mocks", page }, ports: [], source: { id: client }, waitUntil: () => {} });
    },
    /** A call the page makes with fetch or XHR. */
    call: (url: string, client = "frame-1", init?: RequestInit) => harness.dispatch(new Request(url, init), client),
    /** A file the page loads, such as a script. */
    file: (url: string, destination: string, client = "frame-1", resultingClientId = "") => harness.dispatch({ url, method: "GET", mode: "no-cors", destination, referrer: "" }, client, resultingClientId),
  };
  return harness;
}
