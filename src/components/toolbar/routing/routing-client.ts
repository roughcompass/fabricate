import { type WorkerRefusal, routingKey } from "./view-worker";

/*
 * The toolbar's side of version routing (restore-toolbar-tools-and-branch-
 * previews, design decision 7): the routed builds a view keeps in the
 * Frontend Registry's own local storage, and why routing can't run. The
 * view's worker, registered with the scope of the build the view shows, is
 * armed with the view's routing before each frame load, and again every few
 * seconds while the page is open, by the view's coordinator
 * (view-worker.ts), which adds the view's mock set to the same table.
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

/** Why routing can't run, in Microfrontends' words, for a refusal of the view's worker or a worker that couldn't start. */
export function routingRefusalText(refusal: WorkerRefusal | "failed"): string {
  switch (refusal) {
    case "insecure":
      return "Routing needs HTTPS. Browsers allow the service worker it uses only on pages served over HTTPS or from localhost.";
    case "unsupported":
      return "This browser doesn't allow service workers here, so routing can't run.";
    case "foreign":
      return "Routing can't run beside the application's own service worker for its build's path.";
    case "failed":
      return "The routing service worker couldn't start in this browser, so routing isn't applied.";
  }
}
