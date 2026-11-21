import { isPageAnnouncement } from "./mock-log";
import { type RoutingCommand, type ViewIdentity, type ViewTable, ROUTING_MESSAGE, prefixes, referrerIsView, rewriteHtmlImportMaps, rewriteImportMap, routeUrl, viewId } from "./table";

/*
 * The view's service worker (restore-toolbar-tools-and-branch-previews,
 * design decision 7; add-mock-sets, design decision 2). The toolbar
 * registers it with the scope of the build a view shows, `/previews/<build>/`,
 * and arms it before each frame load with the view's table: its routing,
 * and the mock set it applies. It never acts on its own: it takes a frame's
 * navigation only when the frame was opened from an armed view's address,
 * or from a document it already handles, and then every request of the
 * document that navigation creates, and of the dedicated workers that
 * document starts. Requests under a routed microfrontend's entry are
 * answered from the chosen build, and the page's import maps name the chosen
 * build's files. A repository's preview page, other tabs, and top-level pages
 * are never handled.
 *
 * A view is its address and its share token, so a share link's view and the
 * visitor's own view of one build arm two tables. A table lasts while the
 * toolbar keeps arming it, every few seconds; one not armed for a while is
 * dropped, and so are its clients.
 *
 * Built into src/components/toolbar/routing/routing-worker.generated.ts by
 * scripts/build-inspector.ts, and served by src/app/toolbar/routing-worker.js.
 */

/** The parts of a service worker's global scope this worker uses; the project's types are a page's, not a worker's. */
interface WorkerClient {
  readonly id: string;
  readonly url: string;
  readonly frameType: string;
  readonly type?: string;
}
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface MessageEventLike extends ExtendableEvent {
  readonly data: unknown;
  readonly ports: readonly MessagePort[];
  /** The client that posted the message, for a page's own. */
  readonly source?: { readonly id?: string } | null;
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
  readonly table: ViewTable;
  readonly at: number;
}

/** A client the worker handles: a frame's document, or a dedicated worker one started, with its view and its address when it was created. */
interface Handled {
  readonly view: string;
  readonly url: string;
}

/** Armed tables, by view (viewId). */
const armed = new Map<string, Armed>();
/** The clients handled, by client ID. */
const routed = new Map<string, Handled>();
/** The frame agent's id for each client's page, by client ID, as the page told it; a dedicated worker has its document's. */
const pages = new Map<string, string>();

function forget(view: string): void {
  armed.delete(view);
  for (const [client, handled] of routed) {
    if (handled.view !== view) continue;
    routed.delete(client);
    pages.delete(client);
  }
}

function live(view: string): ViewTable | null {
  const entry = armed.get(view);
  if (!entry) return null;
  if (Date.now() - entry.at > ARMED_MS) {
    forget(view);
    return null;
  }
  return entry.table;
}

self.addEventListener("install", () => void self.skipWaiting());

self.addEventListener("message", (event) => {
  // A page this worker controls names itself, so the calls it logs name the page.
  if (isPageAnnouncement(event.data)) {
    if (event.source?.id) pages.set(event.source.id, event.data.page);
    return;
  }
  const command = event.data as RoutingCommand | null;
  if (!command || command.type !== ROUTING_MESSAGE) return;
  if (command.command === "disarm") forget(viewId(command));
  else {
    const view = viewId(command.table);
    armed.set(view, { table: command.table, at: Date.now() });
    // A worker that was stopped forgot its documents; the frame's address names the one to handle again.
    if (command.frame) {
      const frame = command.frame;
      event.waitUntil(
        self.clients.matchAll({ type: "window" }).then((clients) => {
          for (const client of clients) if (client.frameType === "nested" && client.url === frame && !routed.has(client.id)) routed.set(client.id, { view, url: client.url });
        }),
      );
    }
  }
  event.ports[0]?.postMessage({ type: ROUTING_MESSAGE, ok: true });
});

/** The view whose table takes a frame navigation from +referrer+ into +url+: an armed view's address, or a document already handled. */
async function viewOfNavigation(referrer: string, url: string): Promise<string | null> {
  for (const [view, entry] of armed) if (url.startsWith(new URL(entry.table.scope, self.location.origin).href) && referrerIsView(referrer, entry.table satisfies ViewIdentity, self.location.origin) && live(view)) return view;
  for (const [client, handled] of routed) {
    if (handled.url !== referrer) continue;
    // A document that went away routes nothing.
    if (!(await self.clients.get(client))) {
      routed.delete(client);
      continue;
    }
    if (live(handled.view)) return handled.view;
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
async function routedPage(request: Request, table: ViewTable): Promise<Response> {
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
async function routedJson(response: Response, table: ViewTable): Promise<Response> {
  if (!(response.headers.get("content-type") ?? "").includes("json")) return response;
  const text = await response.clone().text();
  const rewritten = rewriteImportMap(text, table.routes);
  if (rewritten === null) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(rewritten, { status: response.status, statusText: response.statusText, headers });
}

/**
 * A dedicated worker's script, requested by a handled client: the worker
 * it creates is handled under the same view, so its own calls are answered
 * too. The browser names the worker's client in `resultingClientId`, where
 * it gives one.
 */
function adoptWorker(event: FetchEventLike, handled: Handled): void {
  if (event.request.destination !== "worker" || !event.resultingClientId || routed.has(event.resultingClientId)) return;
  routed.set(event.resultingClientId, { view: handled.view, url: event.request.url });
  const page = pages.get(event.clientId);
  if (page) pages.set(event.resultingClientId, page);
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

  const handled = routed.get(event.clientId);
  const table = handled ? live(handled.view) : null;
  if (!handled || !table) return;
  adoptWorker(event, handled);
  const target = routeUrl(request.url, prefixes(table));
  if (target) event.respondWith(fetch(target, { credentials: "same-origin" }));
  else if (/\.json(\?|#|$)|importmap/i.test(new URL(request.url).pathname)) event.respondWith(fetch(request).then((response) => routedJson(response, table)));
});
