import { ROUTING_MESSAGE, ROUTING_WORKER_SCRIPT, type RoutingCommand, type RoutingTable, foreignWorker } from "./table";

/*
 * The toolbar's side of version routing (restore-toolbar-tools-and-branch-
 * previews, design decision 7): the routed builds a view keeps in the
 * Frontend Registry's own local storage, and the routing worker registered
 * with the scope of the build the view shows, armed with the view's table
 * before each frame load and again every few seconds while the page is
 * open.
 */

/** A microfrontend routed in a view, with the build it's routed to as Microfrontends shows it. */
export interface AppliedRoute {
  /** The microfrontend: `remote:<alias>` or `import:<specifier>`. */
  readonly id: string;
  readonly name: string;
  readonly mechanism: "module-federation" | "import-map";
  readonly from: string;
  readonly to: string;
  readonly target: { readonly application: string; readonly slug: string; readonly preview: string | null; readonly label: string; readonly commit: string; readonly build: string };
}

export interface AppliedRouting {
  /** The build's scope the routes apply to: `/previews/<build>/`. */
  readonly scope: string;
  readonly routes: readonly AppliedRoute[];
}

const PREFIX = "frontend-registry:routing:";
export const routingKey = (view: string) => `${PREFIX}${view}`;

/** The routing a view keeps in this browser for the build at +scope+; a table kept for another build of the view doesn't apply. */
export function readRouting(view: string, scope: string): AppliedRouting {
  try {
    const stored = JSON.parse(window.localStorage.getItem(routingKey(view)) ?? "null") as AppliedRouting | null;
    if (stored && stored.scope === scope && Array.isArray(stored.routes)) return stored;
  } catch {
    // Unreadable routing is none.
  }
  return { scope, routes: [] };
}

export function writeRouting(view: string, routing: AppliedRouting): void {
  try {
    if (routing.routes.length) window.localStorage.setItem(routingKey(view), JSON.stringify(routing));
    else window.localStorage.removeItem(routingKey(view));
  } catch {
    // Without storage, routing lasts until the page is left.
  }
}

/** Whether any view other than +view+ keeps routing for the build at +scope+. */
function otherViewRoutes(view: string, scope: string): boolean {
  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(PREFIX) || key === routingKey(view)) continue;
      const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as AppliedRouting | null;
      if (stored?.scope === scope && stored.routes.length) return true;
    }
  } catch {
    // Storage that can't be read keeps nothing routed.
  }
  return false;
}

/** The routing worker's address, absolute, as a registration names its script. */
const workerUrl = () => new URL(ROUTING_WORKER_SCRIPT, window.location.origin).href;

/** Why routing can't run in this browser for the build at +scope+, or null when it can. */
export async function routingRefusal(scope: string): Promise<string | null> {
  if (!window.isSecureContext) return "Routing needs HTTPS. Browsers allow the service worker it uses only on pages served over HTTPS or from localhost.";
  if (!("serviceWorker" in navigator)) return "This browser doesn't allow service workers here, so routing can't run.";
  try {
    const registration = await navigator.serviceWorker.getRegistration(scope);
    if (registration && foreignWorker([registration.active?.scriptURL, registration.waiting?.scriptURL, registration.installing?.scriptURL], workerUrl())) return "Routing can't run beside the application's own service worker for its build's path.";
  } catch {
    return "This browser doesn't allow service workers here, so routing can't run.";
  }
  return null;
}

/** The registration's worker once it's active. */
function activated(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  const active = registration.active;
  if (active && active.state === "activated") return Promise.resolve(active);
  return new Promise((resolve, reject) => {
    const worker = registration.installing ?? registration.waiting ?? active;
    if (!worker) return reject(new Error("The routing worker didn't install"));
    const changed = () => {
      if (worker.state === "activated") resolve(worker);
      else if (worker.state === "redundant") reject(new Error("The routing worker didn't install"));
      else return;
      worker.removeEventListener("statechange", changed);
    };
    worker.addEventListener("statechange", changed);
    changed();
  });
}

/** Sends +command+ to +worker+ and waits until it's been applied. */
function send(worker: ServiceWorker, command: RoutingCommand): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(resolve, 2000);
    channel.port1.onmessage = () => {
      window.clearTimeout(timer);
      resolve();
    };
    worker.postMessage(command, [channel.port2]);
  });
}

/** Registers the routing worker for +table+'s build, and arms it with the table; +frame+ is the frame's address now, if it shows a page. */
export async function armRouting(table: RoutingTable, frame: string | null): Promise<void> {
  const registration = await navigator.serviceWorker.register(ROUTING_WORKER_SCRIPT, { scope: table.scope, updateViaCache: "none" });
  await send(await activated(registration), { type: ROUTING_MESSAGE, command: "arm", table, frame });
}

/** Arms the worker already registered for +table+'s build again, if there is one; never registers it. */
export async function rearmRouting(table: RoutingTable, frame: string | null): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration(table.scope);
  if (registration?.active && registration.active.scriptURL === workerUrl()) await send(registration.active, { type: ROUTING_MESSAGE, command: "arm", table, frame });
}

/** Disarms the view +view+, and unregisters the worker for +scope+ when no other view of that build is routed. */
export async function disarmRouting(view: string, scope: string): Promise<void> {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(scope).catch(() => undefined);
  if (!registration?.active || registration.active.scriptURL !== workerUrl()) return;
  await send(registration.active, { type: ROUTING_MESSAGE, command: "disarm", view });
  if (!otherViewRoutes(view, scope)) await registration.unregister();
}
