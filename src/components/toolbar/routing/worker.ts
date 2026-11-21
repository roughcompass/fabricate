import { isPageAnnouncement } from "./mock-log";
import { type ArmAnswer, type RoutingCommand, type ViewIdentity, type ViewTable, ROUTING_MESSAGE, prefixes, referrerIsView, rewriteHtmlImportMaps, rewriteImportMap, routeUrl, viewId } from "./table";
import { answerCall, apiLike, appliesSet, dropSet, readySet, restartSequences } from "./worker-mocks";

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
 * build's files. A view's API calls are answered from its mock set
 * (worker-mocks.ts), which it fetches before it says the view is armed. A
 * repository's preview page, other tabs, and top-level pages are never
 * handled.
 *
 * Without a mock set, it handles `GET` requests only, as routing always has.
 * With one, it handles API calls of every method.
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
/** The frame agent's id for each client's page, by client ID, as the page told it. */
const pages = new Map<string, string>();
/** The document that started each dedicated worker handled, by the worker's client ID: the worker's calls are its page's. */
const owners = new Map<string, string>();
/** The latest document each view's frame loaded, by view. */
const latest = new Map<string, string>();

/** The page a client's calls are logged under: its own, or the page of the document that started it. */
function pageOf(client: string): string | null {
  return pages.get(client) ?? pages.get(owners.get(client) ?? "") ?? null;
}

function forget(view: string): void {
  armed.delete(view);
  dropSet(view);
  latest.delete(view);
  for (const [client, handled] of routed) {
    if (handled.view !== view) continue;
    routed.delete(client);
    pages.delete(client);
    owners.delete(client);
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
  const port = event.ports[0];
  if (command.command === "disarm") {
    forget(viewId(command));
    port?.postMessage({ type: ROUTING_MESSAGE, ok: true } satisfies ArmAnswer);
    return;
  }
  const view = viewId(command.table);
  const mocks = command.table.mocks ?? null;
  if (!mocks) dropSet(view);
  // A worker that was stopped forgot its documents; the frame's address names the one to handle again.
  const frame = command.frame;
  const adopted = frame
    ? self.clients.matchAll({ type: "window" }).then((clients) => {
        for (const client of clients) {
          if (client.frameType !== "nested" || client.url !== frame || routed.has(client.id)) continue;
          routed.set(client.id, { view, url: client.url });
          // The page told a worker that was stopped who it is; the toolbar tells this one.
          if (command.page && !pages.has(client.id)) pages.set(client.id, command.page);
        }
      })
    : Promise.resolve();
  // The view's set is ready before the worker says it's armed, so the build's first call is answered by it.
  const ready = mocks ? readySet(view, mocks, self.location.origin) : Promise.resolve(null);
  event.waitUntil(
    Promise.all([adopted, ready]).then(([, readiness]) => {
      armed.set(view, { table: command.table, at: Date.now() });
      port?.postMessage({ type: ROUTING_MESSAGE, ok: true, ...(readiness ? { mocks: readiness } : {}) } satisfies ArmAnswer);
    }),
  );
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
  owners.set(event.resultingClientId, event.clientId);
}

/** Clients of the scope found not to be the view's, by client ID, so their requests are left alone from then on. */
const strangers = new Set<string>();

/**
 * The view a client the worker doesn't know belongs to, when exactly one
 * view of the build applies a set: a dedicated worker started from a
 * `blob:` address, which makes no script request, or one the browser gave
 * no ID for. Any other client, such as a repository's preview page, isn't
 * the view's. With two views armed, the client can't be told apart, and
 * isn't answered.
 */
function soleView(): string | null {
  const views = [...armed.keys()].filter((view) => live(view));
  const [view] = views;
  return views.length === 1 && view && appliesSet(view, armed.get(view)!.table) ? view : null;
}

/** Answers an API-like call from a client of +view+ from its set, when the set is ready. */
function answeredBySet(event: FetchEventLike, view: string, table: ViewTable): boolean {
  if (!apiLike(event.request) || !appliesSet(view, table)) return false;
  event.respondWith(answerCall(event.request, table, { view, page: () => pageOf(event.clientId), origin: self.location.origin }));
  return true;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.mode === "navigate") {
    // Only a frame's navigation, never a top-level page.
    if (request.method !== "GET" || (request.destination !== "iframe" && request.destination !== "frame")) return;
    if (!armed.size) return;
    event.respondWith(
      (async () => {
        const view = await viewOfNavigation(request.referrer, request.url);
        const table = view ? live(view) : null;
        if (!view || !table) return fetch(request);
        if (event.resultingClientId) {
          routed.set(event.resultingClientId, { view, url: request.url });
          latest.set(view, event.resultingClientId);
        }
        // A new document in the view's frame starts its rules' answers over.
        restartSequences(view);
        return routedPage(request, table);
      })(),
    );
    return;
  }

  const handled = routed.get(event.clientId);
  const table = handled ? live(handled.view) : null;
  if (!handled || !table) {
    const view = event.clientId && !strangers.has(event.clientId) && apiLike(request) ? soleView() : null;
    if (!view) return;
    event.respondWith(
      (async () => {
        const client = await self.clients.get(event.clientId);
        const current = live(view);
        if (client?.type === "worker" && current && appliesSet(view, current)) {
          routed.set(event.clientId, { view, url: client.url });
          // Its document is taken to be the view's latest.
          const document = latest.get(view);
          if (document) owners.set(event.clientId, document);
          return answerCall(request, current, { view, page: () => pageOf(event.clientId), origin: self.location.origin });
        }
        if (strangers.size > 1000) strangers.clear();
        strangers.add(event.clientId);
        return fetch(request).catch(() => Response.error());
      })(),
    );
    return;
  }
  adoptWorker(event, handled);
  if (answeredBySet(event, handled.view, table)) return;
  if (request.method !== "GET") return;
  const target = routeUrl(request.url, prefixes(table));
  if (target) event.respondWith(fetch(target, { credentials: "same-origin" }));
  else if (/\.json(\?|#|$)|importmap/i.test(new URL(request.url).pathname)) event.respondWith(fetch(request).then((response) => routedJson(response, table)));
});
