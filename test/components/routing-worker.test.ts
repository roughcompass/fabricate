import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTING_MESSAGE, type RoutingTable, foreignWorker, prefixes, referrerIsView, rewriteHtmlImportMaps, rewriteImportMap, routeUrl } from "@/components/toolbar/routing/table";
import { DESK, HAPPY, MOCKS, ORDERS, ORDERS_API, ORIGIN, mockWorker, workerScope } from "../support/view-worker";

/*
 * Version routing (restore-toolbar-tools-and-branch-previews, design
 * decision 7, tasks 9.2 and 9.6): the routing table's rules, and the routing
 * service worker that applies them only to frames opened from an armed
 * view.
 */

const PANEL = `${ORIGIN}/previews/pvw_panel/`;

const TABLE: RoutingTable = {
  view: "/run/quotes-desk",
  scope: "/previews/pvw_desk/",
  routes: [
    { name: "quotesPanel", mechanism: "module-federation", from: "http://127.0.0.1:9311/remoteEntry.js", to: `${PANEL}remoteEntry.js` },
    { name: "@fixtures/quotes-panel", mechanism: "import-map", from: "http://127.0.0.1:9312/ticker.js", to: `${PANEL}ticker.js` },
  ],
  kept: [],
};

describe("routing a Module Federation remote", () => {
  it("maps an entry at the origin's root, and the chunks beside it, to the chosen build", () => {
    const rules = prefixes(TABLE);
    expect(routeUrl("http://127.0.0.1:9311/remoteEntry.js", rules)).toBe(`${PANEL}remoteEntry.js`);
    expect(routeUrl("http://127.0.0.1:9311/473.chunk.js", rules)).toBe(`${PANEL}473.chunk.js`);
    // Anything else stays as it is.
    expect(routeUrl("http://127.0.0.1:9400/other.js", rules)).toBeNull();
    expect(routeUrl(`${ORIGIN}/previews/pvw_desk/main.js`, rules)).toBeNull();
  });

  it("maps an entry in a directory by its directory, and the rest of its origin to the build's root, the longest prefix first", () => {
    const rules = prefixes({ scope: "/previews/pvw_shell/", kept: [], routes: [{ name: "mfBilling", mechanism: "module-federation", from: "http://127.0.0.1:9102/assets/remoteEntry.js", to: `${ORIGIN}/previews/pvw_billing/assets/remoteEntry.js` }] });
    expect(rules.map((rule) => rule.from)).toEqual(["http://127.0.0.1:9102/assets/", "http://127.0.0.1:9102/"]);
    expect(routeUrl("http://127.0.0.1:9102/assets/remoteEntry.js", rules)).toBe(`${ORIGIN}/previews/pvw_billing/assets/remoteEntry.js`);
    expect(routeUrl("http://127.0.0.1:9102/assets/__federation_expose_Billing.js", rules)).toBe(`${ORIGIN}/previews/pvw_billing/assets/__federation_expose_Billing.js`);
    expect(routeUrl("http://127.0.0.1:9102/vendor.js", rules)).toBe(`${ORIGIN}/previews/pvw_billing/vendor.js`);
  });

  it("leaves a remote kept as built alone, though another on its origin is routed", () => {
    const rules = prefixes({
      scope: "/previews/pvw_shell/",
      routes: [{ name: "a", mechanism: "module-federation", from: "https://cdn.example.com/a/remoteEntry.js", to: `${ORIGIN}/previews/pvw_a/remoteEntry.js` }],
      kept: ["https://cdn.example.com/b/remoteEntry.js"],
    });
    expect(routeUrl("https://cdn.example.com/a/remoteEntry.js", rules)).toBe(`${ORIGIN}/previews/pvw_a/remoteEntry.js`);
    expect(routeUrl("https://cdn.example.com/b/remoteEntry.js", rules)).toBeNull();
  });
});

describe("routing an import-map entry", () => {
  it("rewrites the routed specifier in an inline importmap and a systemjs-importmap, and leaves other maps and entries alone", () => {
    const html = [
      '<script type="importmap">{"imports":{"@fixtures/quotes-panel":"http://127.0.0.1:9312/ticker.js","react":"https://cdn/react.js"}}</script>',
      "<script type='systemjs-importmap'>\n{ \"imports\": { \"@fixtures/quotes-panel\": \"http://127.0.0.1:9312/ticker.js\" } }\n</script>",
      '<script type="systemjs-importmap" src="/importmap.json"></script>',
      '<script>{"imports":{"@fixtures/quotes-panel":"x"}}</script>',
    ].join("\n");
    const rewritten = rewriteHtmlImportMaps(html, TABLE.routes);
    expect(rewritten).toContain(`<script type="importmap">{"imports":{"@fixtures/quotes-panel":"${PANEL}ticker.js","react":"https://cdn/react.js"}}</script>`);
    expect(rewritten).toContain(`<script type='systemjs-importmap'>{"imports":{"@fixtures/quotes-panel":"${PANEL}ticker.js"}}</script>`);
    expect(rewritten).toContain('<script type="systemjs-importmap" src="/importmap.json"></script>');
    expect(rewritten).toContain('<script>{"imports":{"@fixtures/quotes-panel":"x"}}</script>');
  });

  it("rewrites an external map's JSON and its scopes, and nothing that isn't an import map", () => {
    expect(JSON.parse(rewriteImportMap('{"imports":{},"scopes":{"/a/":{"@fixtures/quotes-panel":"http://127.0.0.1:9312/ticker.js"}}}', TABLE.routes)!)).toEqual({ imports: {}, scopes: { "/a/": { "@fixtures/quotes-panel": `${PANEL}ticker.js` } } });
    expect(rewriteImportMap('{"imports":{"react":"x"}}', TABLE.routes)).toBeNull();
    expect(rewriteImportMap("not json", TABLE.routes)).toBeNull();
  });
});

describe("the view a frame was opened from", () => {
  it("is the running address at any route, never another application, preview mode, or another origin", () => {
    expect(referrerIsView(`${ORIGIN}/run/quotes-desk`, "/run/quotes-desk", ORIGIN)).toBe(true);
    expect(referrerIsView(`${ORIGIN}/run/quotes-desk/blotter?x=1`, "/run/quotes-desk", ORIGIN)).toBe(true);
    expect(referrerIsView(`${ORIGIN}/run/quotes-desk@feature-dark-blotter/blotter`, "/run/quotes-desk", ORIGIN)).toBe(false);
    expect(referrerIsView(`${ORIGIN}/applications/quotes-desk/preview`, "/run/quotes-desk", ORIGIN)).toBe(false);
    expect(referrerIsView("http://elsewhere.example/run/quotes-desk", "/run/quotes-desk", ORIGIN)).toBe(false);
    expect(referrerIsView("", "/run/quotes-desk", ORIGIN)).toBe(false);
  });

  it("is the share link's view only with its token, and preview mode's with its saved preview (add-mock-sets, task 8.2)", () => {
    expect(referrerIsView(`${ORIGIN}/run/quotes-desk/blotter?share=tok`, "/run/quotes-desk", ORIGIN)).toBe(false);
    expect(referrerIsView(`${ORIGIN}/run/quotes-desk/blotter?x=1&share=tok`, { view: "/run/quotes-desk", share: "tok" }, ORIGIN)).toBe(true);
    expect(referrerIsView(`${ORIGIN}/run/quotes-desk?share=other`, { view: "/run/quotes-desk", share: "tok" }, ORIGIN)).toBe(false);
    // A running application's own query may name anything but `share`.
    expect(referrerIsView(`${ORIGIN}/run/quotes-desk?preview=x`, { view: "/run/quotes-desk", share: null }, ORIGIN)).toBe(true);
    const previewMode = { view: "/applications/quotes-desk/preview", share: null, preview: "feature-dark-blotter" };
    expect(referrerIsView(`${ORIGIN}/applications/quotes-desk/preview?device=mobile&preview=feature-dark-blotter`, previewMode, ORIGIN)).toBe(true);
    expect(referrerIsView(`${ORIGIN}/applications/quotes-desk/preview`, previewMode, ORIGIN)).toBe(false);
    expect(referrerIsView(`${ORIGIN}/applications/quotes-desk/preview?preview=feature-dark-blotter`, { ...previewMode, preview: null }, ORIGIN)).toBe(false);
  });
});

describe("the application's own service worker", () => {
  it("is any registered script for the scope other than the routing worker", () => {
    const ours = `${ORIGIN}/toolbar/routing-worker.js`;
    expect(foreignWorker([null, undefined], ours)).toBe(false);
    expect(foreignWorker([ours], ours)).toBe(false);
    expect(foreignWorker([`${ORIGIN}/previews/pvw_desk/sw.js`, ours], ours)).toBe(true);
  });
});

describe("the routing worker", () => {
  let world: ReturnType<typeof workerScope>;
  const fetched: string[] = [];

  beforeEach(async () => {
    vi.resetModules();
    world = workerScope();
    fetched.length = 0;
    vi.stubGlobal("self", world.scope);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string) => {
        const url = typeof input === "string" ? input : input.url;
        fetched.push(url);
        // A route that names no file isn't a navigation once the worker fetches it: the server answers 404.
        if (url.endsWith("/blotter")) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
        return new Response(url.endsWith("/") ? '<script type="importmap">{"imports":{"@fixtures/quotes-panel":"http://127.0.0.1:9312/ticker.js"}}</script>' : "ok", { headers: { "content-type": url.endsWith(".js") ? "text/javascript" : "text/html" } });
      }),
    );
    await import("@/components/toolbar/routing/worker");
  });
  afterEach(() => vi.unstubAllGlobals());

  async function arm(table: RoutingTable = TABLE) {
    const port = { postMessage: vi.fn() };
    let waited: Promise<unknown> = Promise.resolve();
    world.listeners.get("message")!({ data: { type: ROUTING_MESSAGE, command: "arm", table, frame: null }, ports: [port], waitUntil: (promise: Promise<unknown>) => (waited = promise) });
    await waited;
    expect(port.postMessage).toHaveBeenCalledWith({ type: ROUTING_MESSAGE, ok: true });
  }

  /** Dispatches a fetch event, returning what the worker answered, or null when it left the request to the browser. */
  async function request(url: string, options: { mode?: string; destination?: string; referrer?: string; clientId?: string; resultingClientId?: string } = {}): Promise<Response | null> {
    let answered: Promise<Response> | null = null;
    const request = { url, method: "GET", mode: options.mode ?? "no-cors", destination: options.destination ?? "script", referrer: options.referrer ?? "" } as unknown as Request;
    world.listeners.get("fetch")!({ request, clientId: options.clientId ?? "", resultingClientId: options.resultingClientId ?? "", respondWith: (response: Promise<Response>) => (answered = Promise.resolve(response)), waitUntil: () => {} });
    return answered ? await answered : null;
  }

  const navigation = (url: string, referrer: string, resultingClientId = "frame-1") => request(url, { mode: "navigate", destination: "iframe", referrer, resultingClientId });

  it("routes nothing until it's armed", async () => {
    expect(await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/run/quotes-desk`)).toBeNull();
    expect(await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "frame-1" })).toBeNull();
  });

  it("routes the frame an armed view opens: its import map names the chosen build, and its remote's requests go there", async () => {
    await arm();
    world.clients.set("frame-1", { id: "frame-1", url: `${ORIGIN}/previews/pvw_desk/`, frameType: "nested" });
    const page = await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/run/quotes-desk/`);
    expect(await page!.text()).toBe(`<script type="importmap">{"imports":{"@fixtures/quotes-panel":"${PANEL}ticker.js"}}</script>`);
    await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "frame-1" });
    expect(fetched.at(-1)).toBe(`${PANEL}remoteEntry.js`);
    // A later navigation of that frame stays routed, and a route that names no file opens the build's page, as serving does for a navigation.
    world.clients.set("frame-2", { id: "frame-2", url: `${ORIGIN}/previews/pvw_desk/blotter`, frameType: "nested" });
    const next = await navigation(`${ORIGIN}/previews/pvw_desk/blotter`, `${ORIGIN}/previews/pvw_desk/`, "frame-2");
    expect(next!.status).toBe(200);
    expect(await next!.text()).toContain(`${PANEL}ticker.js`);
    expect(fetched.slice(-2)).toEqual([`${ORIGIN}/previews/pvw_desk/blotter`, `${ORIGIN}/previews/pvw_desk/`]);
  });

  it("leaves preview mode, another application's view, a top-level page, and an unrouted document alone", async () => {
    await arm();
    // Preview mode's frame of the same build.
    const previewMode = await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/applications/quotes-desk/preview`, "preview-frame");
    expect(await previewMode!.text()).toContain("http://127.0.0.1:9312/ticker.js");
    expect(await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "preview-frame" })).toBeNull();
    // A tab that opened the build itself.
    expect(await request(`${ORIGIN}/previews/pvw_desk/`, { mode: "navigate", destination: "document", referrer: `${ORIGIN}/run/quotes-desk` })).toBeNull();
    // The view of a saved preview of the same application isn't this view.
    const other = await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/run/quotes-desk@feature-dark-blotter`, "other-frame");
    expect(await other!.text()).toContain("http://127.0.0.1:9312/ticker.js");
  });

  it("arms a share link's view and the visitor's own view of one build as two views (add-mock-sets, task 8.2)", async () => {
    const BLUE = `${ORIGIN}/previews/pvw_blue/`;
    await arm();
    await arm({ ...TABLE, share: "tok", routes: [{ ...TABLE.routes[0]!, to: `${BLUE}remoteEntry.js` }] } as RoutingTable);
    await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/run/quotes-desk?share=tok`, "shared-frame");
    await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/run/quotes-desk`, "own-frame");
    await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "shared-frame" });
    expect(fetched.at(-1)).toBe(`${BLUE}remoteEntry.js`);
    await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "own-frame" });
    expect(fetched.at(-1)).toBe(`${PANEL}remoteEntry.js`);
    // Another share link's frame is neither.
    const other = await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/run/quotes-desk?share=other`, "other-frame");
    expect(await other!.text()).toContain("http://127.0.0.1:9312/ticker.js");
    // Disarming the share link's view leaves the visitor's own.
    world.listeners.get("message")!({ data: { type: ROUTING_MESSAGE, command: "disarm", view: "/run/quotes-desk", share: "tok" }, ports: [], waitUntil: () => {} });
    expect(await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "shared-frame" })).toBeNull();
    await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "own-frame" });
    expect(fetched.at(-1)).toBe(`${PANEL}remoteEntry.js`);
  });

  it("handles a dedicated worker a routed document starts, from its script's request (add-mock-sets, task 8.2)", async () => {
    await arm();
    await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/run/quotes-desk`);
    // The worker's script itself is left to the browser, as any file of the build.
    expect(await request(`${ORIGIN}/previews/pvw_desk/rates-worker.js`, { clientId: "frame-1", destination: "worker", resultingClientId: "worker-1" })).toBeNull();
    await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "worker-1" });
    expect(fetched.at(-1)).toBe(`${PANEL}remoteEntry.js`);
    // A worker that an unhandled page starts isn't handled.
    await request(`${ORIGIN}/previews/pvw_desk/rates-worker.js`, { clientId: "a-tab", destination: "worker", resultingClientId: "worker-2" });
    expect(await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "worker-2" })).toBeNull();
  });

  it("stops routing once the view is disarmed", async () => {
    await arm();
    world.clients.set("frame-1", { id: "frame-1", url: `${ORIGIN}/previews/pvw_desk/`, frameType: "nested" });
    await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/run/quotes-desk`);
    world.listeners.get("message")!({ data: { type: ROUTING_MESSAGE, command: "disarm", view: "/run/quotes-desk" }, ports: [], waitUntil: () => {} });
    expect(await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "frame-1" })).toBeNull();
  });
});

/*
 * Answering a view's API calls from its mock set (add-mock-sets, design
 * decision 2, task 8.3; template-demo/mock-data spec, "A mock set applies
 * before the build loads" and "The page's and its workers' API calls are
 * answered"; applications/mock-sets spec, "Mock sets answer API calls only,
 * never the build's own files").
 */

describe("the view's worker with a mock set", () => {
  const worker = mockWorker();
  beforeEach(() => worker.start());
  afterEach(() => vi.unstubAllGlobals());
  const { fetched, logged, arm, dispatch, open, call, file } = worker;
  const world = () => worker.world;
  const serve = (set: () => Response) => worker.serve(set);

  it("fetches the set by revision before it says the view is armed, so the build's first call is answered (The first call)", async () => {
    expect(await arm()).toEqual({ type: ROUTING_MESSAGE, ok: true, mocks: { ok: true, revision: 3 } });
    expect(fetched).toEqual([`GET ${ORIGIN}/api/applications/orders-portal/mock-sets/mks_happy/compiled?revision=3`]);
    await open();
    const answer = await call(`${ORDERS_API}/v1/orders?limit=5&_=1763650000000`);
    expect(await answer!.json()).toEqual({ orders: [1, 2, 3] });
    expect(logged).toEqual([expect.objectContaining({ outcome: "mocked", method: "GET", url: `${ORDERS_API}/v1/orders?limit=5&_=1763650000000`, rule: { id: "mkr_orders", label: "GET /v1/orders", response: 1 }, status: 200, view: expect.any(String), set: "mks_happy", revision: 3 })]);
    // Arming again with the revision it holds fetches nothing.
    await arm();
    expect(fetched.filter((each) => each.includes("/compiled"))).toHaveLength(1);
  });

  it("says why when the set can't be made ready, and the frame's calls go to their own addresses as without a set", async () => {
    serve(() => new Response("Broken", { status: 500 }));
    expect(await arm()).toEqual({ type: ROUTING_MESSAGE, ok: true, mocks: { ok: false, reason: "The mock set couldn't be fetched: the Frontend Registry answered 500." } });
    await open();
    expect(await call(`${ORDERS_API}/v1/orders`)).toBeNull();
    serve(() => new Response("Gone", { status: 404 }));
    expect(await arm({ ...ORDERS, mocks: { ...MOCKS, revision: 4 } })).toMatchObject({ mocks: { ok: false, reason: "The mock set no longer exists." } });
  });

  it("answers a call to another origin, of any method, without sending anything there (A call to another origin, Two searches)", async () => {
    await arm();
    await open();
    expect(await (await call(`${ORDERS_API}/v1/orders/search`, "frame-1", { method: "POST", body: '{ "status": "closed" }', headers: { "content-type": "application/json" } }))!.json()).toEqual({ orders: ["closed"] });
    expect(await (await call(`${ORDERS_API}/v1/orders/search`, "frame-1", { method: "POST", body: '{"status":"open"}' }))!.json()).toEqual({ orders: ["open"] });
    expect(fetched.filter((each) => each.includes("api.orders.test"))).toEqual([]);
  });

  it("answers the calls of a dedicated worker the frame's document starts (A worker's call)", async () => {
    await arm();
    await open();
    expect(await file(`${ORIGIN}${DESK}assets/rates-worker.js`, "worker", "frame-1", "rates-worker")).toBeNull();
    expect(await (await call(`${ORDERS_API}/v1/orders`, "rates-worker"))!.json()).toEqual({ orders: [1, 2, 3] });
  });

  it("answers a worker started from a blob: address only while one view of the build is armed, and never another page of the scope", async () => {
    await arm();
    await open();
    world().clients.set("blob-worker", { id: "blob-worker", url: "blob:x", frameType: "none", type: "worker" });
    world().clients.set("preview-page", { id: "preview-page", url: `${ORIGIN}${DESK}`, frameType: "top-level", type: "window" });
    expect(await (await call(`${ORDERS_API}/v1/orders`, "blob-worker"))!.json()).toEqual({ orders: [1, 2, 3] });
    // The repository's preview page of the same build, opened in another tab, isn't the view's: its calls go to their own addresses.
    const page = await call(`${ORDERS_API}/v1/orders`, "preview-page");
    expect(page === null || page.type === "error").toBe(true);
    expect(await call(`${ORDERS_API}/v1/orders`, "preview-page")).toBeNull();
    // With a second view of the build armed, an unknown worker can't be told apart, and isn't answered.
    await arm({ ...ORDERS, share: "tok" });
    world().clients.set("other-blob", { id: "other-blob", url: "blob:y", frameType: "none", type: "worker" });
    expect(await call(`${ORDERS_API}/v1/orders`, "other-blob")).toBeNull();
  });

  it("leaves the repository's preview page and top-level pages alone (The repository's preview page)", async () => {
    await arm();
    expect(await dispatch({ url: `${ORIGIN}${DESK}`, method: "GET", mode: "navigate", destination: "document", referrer: `${ORIGIN}/run/orders-portal` }, "", "tab")).toBeNull();
    world().clients.set("tab", { id: "tab", url: `${ORIGIN}${DESK}`, frameType: "top-level", type: "window" });
    const answer = await call(`${ORDERS_API}/v1/orders`, "tab");
    expect(answer === null || answer.type === "error").toBe(true);
    expect(logged).toEqual([]);
  });

  it("gives the build's own files first, and lets a rule answer under its path only where the build has none (The build's own JSON, A script, A relative call)", async () => {
    await arm();
    await open();
    expect(await (await call(`${ORIGIN}${DESK}config.json`))!.json()).toEqual({ from: "the build" });
    // A script is never an API call: the browser loads the build's own.
    expect(await file(`${ORIGIN}${DESK}assets/index.js`, "script")).toBeNull();
    // `api/accounts`, relative to the build's page, isn't a file of the build.
    expect(await (await call(`${ORIGIN}${DESK}api/accounts`))!.json()).toEqual({ accounts: [42] });
    // A root-relative call is matched as it is.
    expect(await (await call(`${ORIGIN}/api/accounts`))!.json()).toEqual({ accounts: [42] });
    expect(logged.map((entry) => entry.outcome)).toEqual(["passed", "mocked", "mocked"]);
    // The toolbar's own files are never matched.
    await call(`${ORIGIN}/toolbar/inspector.js`);
    expect(logged.at(-1)).toMatchObject({ outcome: "failed", status: 404 });
  });

  it("passes calls no rule matches to their own addresses, saying they failed, or answers them as not mocked (Passing through, Answering as not mocked)", async () => {
    await arm();
    await open();
    const passed = await call(`${ORDERS_API}/v1/rates`);
    expect(passed!.type).toBe("error");
    expect(fetched.at(-1)).toBe(`GET ${ORDERS_API}/v1/rates`);
    expect(logged.at(-1)).toMatchObject({ outcome: "failed", status: null, error: "Couldn't connect or was blocked by CORS", rule: null });

    serve(() => Response.json({ ...HAPPY, revision: 4, unmatched: "not-mocked" }));
    await arm({ ...ORDERS, mocks: { ...MOCKS, revision: 4 } });
    const before = fetched.length;
    const answer = await call(`${ORDERS_API}/v1/rates`, "frame-1", { method: "POST", body: "rate=1" });
    expect(answer!.status).toBe(501);
    expect(answer!.headers.get("X-Frontend-Registry-Mock")).toBe("not-matched");
    expect(await answer!.json()).toEqual({ error: "Not mocked", set: "Happy path", method: "POST", url: `${ORDERS_API}/v1/rates` });
    expect(fetched.slice(before)).toEqual([]);
    // The request's body is kept, so a rule can be made from the call.
    expect(logged.at(-1)).toMatchObject({ outcome: "not-matched", status: 501, body: "rate=1" });
  });

  it("gives a rule's responses in order, then the last again, and starts over on a new document and a new revision (Polling an export, Reloading)", async () => {
    await arm();
    await open();
    const poll = async () => ((await (await call(`${ORDERS_API}/v1/exports/9`))!.json()) as { state: string }).state;
    expect([await poll(), await poll(), await poll(), await poll()]).toEqual(["pending", "pending", "ready", "ready"]);
    expect(logged.map((entry) => entry.rule?.response)).toEqual([1, 2, 3, 3]);
    await open("frame-2");
    expect(await (await call(`${ORDERS_API}/v1/exports/9`, "frame-2"))!.json()).toEqual({ state: "pending" });
    await call(`${ORDERS_API}/v1/exports/9`, "frame-2");
    serve(() => Response.json({ ...HAPPY, revision: 5 }));
    await arm({ ...ORDERS, mocks: { ...MOCKS, revision: 5 } });
    expect(await (await call(`${ORDERS_API}/v1/exports/9`, "frame-2"))!.json()).toEqual({ state: "pending" });
  });

  it("keeps an event stream open after its events (An event stream)", async () => {
    await arm();
    await open();
    const answer = await call(`${ORDERS_API}/v1/orders/stream`, "frame-1", { headers: { accept: "text/event-stream" } });
    expect(answer!.headers.get("content-type")).toBe("text/event-stream");
    const reader = answer!.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 1\n\ndata: 2\n\ndata: 3\n\n");
    const next = await Promise.race([reader.read().then(() => "more"), new Promise((resolve) => setTimeout(() => resolve("open"), 50))]);
    expect(next).toBe("open");
    await reader.cancel();
  });

  it("fetches a large body once, by its digest, and waits the latency chosen", async () => {
    await arm({ ...ORDERS, mocks: { ...MOCKS, latency: "recorded" } });
    await open();
    const started = Date.now();
    expect(await (await call(`${ORDERS_API}/v1/report`))!.json()).toEqual({ rows: 500 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    await call(`${ORDERS_API}/v1/report`);
    expect(fetched.filter((each) => each.includes("/bodies/"))).toEqual([`GET ${ORIGIN}/api/applications/orders-portal/mock-sets/mks_happy/bodies/d1g3st`]);
  });

  it("handles only GET requests, as routing always has, without a set", async () => {
    await arm({ ...ORDERS, mocks: null });
    await open();
    expect(await call(`${ORDERS_API}/v1/orders/search`, "frame-1", { method: "POST", body: "{}" })).toBeNull();
    expect(await call(`${ORDERS_API}/v1/orders`)).toBeNull();
    expect(logged).toEqual([]);
  });
});
