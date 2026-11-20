/*
 * Version routing's rules (restore-toolbar-tools-and-branch-previews, design
 * decision 7), shared by the toolbar, which builds a view's routing table,
 * and the routing service worker, which applies it to the frame of that view
 * only. No browser or React dependencies, so the rules can be tested
 * directly.
 */

/** Where the Frontend Registry serves the routing worker, with `Service-Worker-Allowed: /previews/` (src/app/toolbar/routing-worker.js). */
export const ROUTING_WORKER_SCRIPT = "/toolbar/routing-worker.js";

/** Tags the toolbar's messages to the worker. */
export const ROUTING_MESSAGE = "frontend-registry:routing";

export type RoutedMechanism = "module-federation" | "import-map";

/** A microfrontend routed to another build. */
export interface RoutedEntry {
  /** A remote's alias or an import map's specifier. */
  readonly name: string;
  readonly mechanism: RoutedMechanism;
  /** Its entry's address as built, absolute. */
  readonly from: string;
  /** The same file in the chosen build, absolute, on the Frontend Registry's origin. */
  readonly to: string;
}

/** What the toolbar arms the worker with for one view. */
export interface RoutingTable {
  /** The running application's address the table is for, on the Frontend Registry's origin: `/run/<slug>`, or `/run/<slug>@<key>`. */
  readonly view: string;
  /** The build's path, the worker's scope: `/previews/<build>/`. */
  readonly scope: string;
  readonly routes: readonly RoutedEntry[];
  /** The entries of microfrontends that stay as built, whose directories no route may take. */
  readonly kept: readonly string[];
}

/** A message from the toolbar to the worker. */
export type RoutingCommand = { readonly type: typeof ROUTING_MESSAGE; readonly command: "arm"; readonly table: RoutingTable; readonly frame: string | null } | { readonly type: typeof ROUTING_MESSAGE; readonly command: "disarm"; readonly view: string };

export interface Prefix {
  readonly from: string;
  /** Null keeps addresses under +from+ as they are. */
  readonly to: string | null;
}

/** The directory of an address, with its slash: `http://h/a/remoteEntry.js` is `http://h/a/`. */
export function directoryOf(address: string): string {
  const url = new URL(address);
  return `${url.origin}${url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1)}`;
}

/**
 * The address prefixes a table rewrites, longest first. Each routed entry
 * maps its directory to the directory of the same file in the chosen build,
 * and its origin to that build's root, so chunks that resolve relative to the
 * entry or to its origin follow it. The directories of entries kept as built
 * map to themselves, so a route on their origin can't take them. Where two
 * routes claim one prefix, the first keeps it.
 */
export function prefixes(table: Pick<RoutingTable, "routes" | "kept" | "scope">): Prefix[] {
  const found = new Map<string, string | null>();
  const add = (from: string, to: string | null) => {
    if (!found.has(from)) found.set(from, to);
  };
  for (const route of table.routes) add(directoryOf(route.from), directoryOf(route.to));
  for (const kept of table.kept) {
    try {
      add(directoryOf(kept), null);
    } catch {
      // An address that isn't absolute can't be taken by a route either.
    }
  }
  for (const route of table.routes) {
    const to = new URL(route.to);
    // The chosen build's root: the scope's form of the target's own path.
    const root = `${to.origin}${to.pathname.match(/^\/previews\/[^/]+\//)?.[0] ?? "/"}`;
    add(`${new URL(route.from).origin}/`, root);
  }
  return [...found].map(([from, to]) => ({ from, to })).sort((left, right) => right.from.length - left.from.length);
}

/** The address +url+ is routed to, or null when it stays as it is. The longest prefix decides. */
export function routeUrl(url: string, rules: readonly Prefix[]): string | null {
  const rule = rules.find((candidate) => url.startsWith(candidate.from));
  if (!rule || rule.to === null) return null;
  const routed = `${rule.to}${url.slice(rule.from.length)}`;
  return routed === url ? null : routed;
}

/** An import map's JSON with each routed specifier's address replaced; null when it names none of them, or isn't an import map. */
export function rewriteImportMap(json: string, routes: readonly RoutedEntry[]): string | null {
  const routed = routes.filter((route) => route.mechanism === "import-map");
  if (!routed.length) return null;
  let map: { imports?: Record<string, unknown>; scopes?: Record<string, Record<string, unknown>> };
  try {
    map = JSON.parse(json) as typeof map;
  } catch {
    return null;
  }
  if (!map || typeof map !== "object") return null;
  let changed = false;
  const rewrite = (imports: Record<string, unknown> | undefined) => {
    if (!imports || typeof imports !== "object") return;
    for (const route of routed) {
      if (typeof imports[route.name] === "string" && imports[route.name] !== route.to) {
        imports[route.name] = route.to;
        changed = true;
      }
    }
  };
  rewrite(map.imports);
  for (const scope of Object.values(map.scopes ?? {})) rewrite(scope);
  return changed ? JSON.stringify(map) : null;
}

const IMPORT_MAP_SCRIPT = /(<script\b[^>]*\btype\s*=\s*["'](?:systemjs-importmap|importmap)["'][^>]*>)([\s\S]*?)(<\/script>)/gi;

/** A page's HTML with the routed specifiers replaced in each inline import map, native or SystemJS. */
export function rewriteHtmlImportMaps(html: string, routes: readonly RoutedEntry[]): string {
  return html.replace(IMPORT_MAP_SCRIPT, (block, open: string, json: string, close: string) => {
    // An external map's block holds no JSON; its file is rewritten when the page requests it.
    if (/\bsrc\s*=/.test(open)) return block;
    const rewritten = rewriteImportMap(json, routes);
    return rewritten === null ? block : `${open}${rewritten}${close}`;
  });
}

/** Whether +referrer+, an address on +origin+, is the view +view+'s running address, at any of its routes. */
export function referrerIsView(referrer: string, view: string, origin: string): boolean {
  try {
    const url = new URL(referrer);
    return url.origin === origin && (url.pathname === view || url.pathname.startsWith(`${view}/`));
  } catch {
    return false;
  }
}

/** A registration a routing table can use: none, or the worker's own; another script's registration for the scope is the application's. */
export function foreignWorker(scriptUrls: readonly (string | null | undefined)[], ours: string): boolean {
  return scriptUrls.some((url) => typeof url === "string" && url !== ours);
}
