import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTING_MESSAGE, type RoutingTable, foreignWorker, prefixes, referrerIsView, rewriteHtmlImportMaps, rewriteImportMap, routeUrl } from "@/components/toolbar/routing/table";

/*
 * Version routing (restore-toolbar-tools-and-branch-previews, design
 * decision 7, tasks 9.2 and 9.6): the routing table's rules, and the routing
 * service worker that applies them only to frames opened from an armed
 * view.
 */

const ORIGIN = "http://127.0.0.1:3100";
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
});

describe("the application's own service worker", () => {
  it("is any registered script for the scope other than the routing worker", () => {
    const ours = `${ORIGIN}/toolbar/routing-worker.js`;
    expect(foreignWorker([null, undefined], ours)).toBe(false);
    expect(foreignWorker([ours], ours)).toBe(false);
    expect(foreignWorker([`${ORIGIN}/previews/pvw_desk/sw.js`, ours], ours)).toBe(true);
  });
});

/** A service worker's scope the worker registers its listeners on, with its documents, as the browser keeps them. */
function workerScope() {
  const listeners = new Map<string, (event: unknown) => void>();
  const clients = new Map<string, { id: string; url: string; frameType: string }>();
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

  it("stops routing once the view is disarmed", async () => {
    await arm();
    world.clients.set("frame-1", { id: "frame-1", url: `${ORIGIN}/previews/pvw_desk/`, frameType: "nested" });
    await navigation(`${ORIGIN}/previews/pvw_desk/`, `${ORIGIN}/run/quotes-desk`);
    world.listeners.get("message")!({ data: { type: ROUTING_MESSAGE, command: "disarm", view: "/run/quotes-desk" }, ports: [], waitUntil: () => {} });
    expect(await request("http://127.0.0.1:9311/remoteEntry.js", { clientId: "frame-1" })).toBeNull();
  });
});
