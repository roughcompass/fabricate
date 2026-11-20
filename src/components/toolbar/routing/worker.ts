import { type RoutingCommand, type RoutingTable, ROUTING_MESSAGE, prefixes, referrerIsView, rewriteHtmlImportMaps, rewriteImportMap, routeUrl } from "./table";

/*
 * The routing service worker (restore-toolbar-tools-and-branch-previews,
 * design decision 7). The toolbar registers it with the scope of the build
 * it routes, `/previews/<build>/`, and arms it before each frame load with
 * the view's routing table. It never routes on its own: it routes a frame's
 * navigation only when the frame was opened from an armed view's running
 * address, or from a document it already routes, and then every request of
 * the document that navigation creates. Requests under a routed
 * microfrontend's entry are answered from the chosen build, and the page's
 * import maps name the chosen build's files. Preview mode, a repository's
 * preview page, other tabs, and top-level pages are never routed.
 *
 * A table lasts while the toolbar keeps arming it, every few seconds; one
 * not armed for a while is dropped, and so are its documents.
 *
 * Built into src/components/toolbar/routing/routing-worker.generated.ts by
 * scripts/build-inspector.ts, and served by src/app/toolbar/routing-worker.js.
 */

/** The parts of a service worker's global scope this worker uses; the project's types are a page's, not a worker's. */
interface WorkerClient {
  readonly id: string;
  readonly url: string;
  readonly frameType: string;
}
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface MessageEventLike extends ExtendableEvent {
  readonly data: unknown;
  readonly ports: readonly MessagePort[];
}
interface FetchEventLike extends ExtendableEvent {
  readonly request: Request;
  readonly clientId: string;
  readonly resultingClientId: string;
  respondWith(response: Response | Promise<Response>): void;
}
interface WorkerScope {
  readonly location: Location;
  readonly clients: { matchAll(options: { type: "window" }): Promise<WorkerClient[]>; get(id: string): Promise<WorkerClient | undefined> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
}

declare const self: WorkerScope;

/** How long a table lasts once armed; the toolbar arms it again every few seconds. */
const ARMED_MS = 90_000;

interface Armed {
  readonly table: RoutingTable;
  readonly at: number;
}

/** Armed tables, by view. */
const armed = new Map<string, Armed>();
/** The documents routed, by client ID, with their view and their address when they were created. */
const routed = new Map<string, { view: string; url: string }>();

function live(view: string): RoutingTable | null {
  const entry = armed.get(view);
  if (!entry) return null;
  if (Date.now() - entry.at > ARMED_MS) {
    armed.delete(view);
    for (const [client, document] of routed) if (document.view === view) routed.delete(client);
    return null;
  }
  return entry.table;
}

self.addEventListener("install", () => void self.skipWaiting());

self.addEventListener("message", (event) => {
  const command = event.data as RoutingCommand | null;
  if (!command || command.type !== ROUTING_MESSAGE) return;
  if (command.command === "disarm") {
    armed.delete(command.view);
    for (const [client, document] of routed) if (document.view === command.view) routed.delete(client);
  } else {
    armed.set(command.table.view, { table: command.table, at: Date.now() });
    // A worker that was stopped forgot its documents; the frame's address names the one to route again.
    if (command.frame) {
      const frame = command.frame;
      event.waitUntil(
        self.clients.matchAll({ type: "window" }).then((clients) => {
          for (const client of clients) if (client.frameType === "nested" && client.url === frame && !routed.has(client.id)) routed.set(client.id, { view: command.table.view, url: client.url });
        }),
      );
    }
  }
  event.ports[0]?.postMessage({ type: ROUTING_MESSAGE, ok: true });
});

/** The view whose table routes a frame navigation from +referrer+ into +url+: an armed view's running address, or a document already routed. */
async function viewOfNavigation(referrer: string, url: string): Promise<string | null> {
  for (const [view, entry] of armed) if (url.startsWith(new URL(entry.table.scope, self.location.origin).href) && referrerIsView(referrer, view, self.location.origin) && live(view)) return view;
  for (const [client, document] of routed) {
    if (document.url !== referrer) continue;
    // A document that went away routes nothing.
    if (!(await self.clients.get(client))) {
      routed.delete(client);
      continue;
    }
    if (live(document.view)) return document.view;
  }
  return null;
}

/**
 * The routed frame's page, with its import maps naming the chosen builds'
 * files. Fetched from here, a navigation isn't one to the server, so a route
 * that names no file falls back to the build's page here, as serving falls
 * back for a navigation. The response is made anew, so the page keeps the
 * address it was opened at.
 */
async function routedPage(request: Request, table: RoutingTable): Promise<Response> {
  let response = await fetch(request);
  const last = new URL(request.url).pathname.split("/").at(-1) ?? "";
  if (response.status === 404 && !last.includes(".")) response = await fetch(new URL(table.scope, self.location.origin).href, { credentials: "same-origin" });
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(rewriteHtmlImportMaps(html, table.routes), { status: response.status, statusText: response.statusText, headers });
}

/** An external import map's JSON, rewritten the same way; anything else as it is. */
async function routedJson(response: Response, table: RoutingTable): Promise<Response> {
  if (!(response.headers.get("content-type") ?? "").includes("json")) return response;
  const text = await response.clone().text();
  const rewritten = rewriteImportMap(text, table.routes);
  if (rewritten === null) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(rewritten, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    // Only a frame's navigation, never a top-level page.
    if (request.destination !== "iframe" && request.destination !== "frame") return;
    if (!armed.size) return;
    event.respondWith(
      (async () => {
        const view = await viewOfNavigation(request.referrer, request.url);
        const table = view ? live(view) : null;
        if (!view || !table) return fetch(request);
        if (event.resultingClientId) routed.set(event.resultingClientId, { view, url: request.url });
        return routedPage(request, table);
      })(),
    );
    return;
  }

  const document = routed.get(event.clientId);
  const table = document ? live(document.view) : null;
  if (!table) return;
  const target = routeUrl(request.url, prefixes(table));
  if (target) event.respondWith(fetch(target, { credentials: "same-origin" }));
  else if (/\.json(\?|#|$)|importmap/i.test(new URL(request.url).pathname)) event.respondWith(fetch(request).then((response) => routedJson(response, table)));
});
