import type { InspectedLoad } from "../inspector/protocol";

/**
 * The Timing tool's load order for a running application (template-demo/
 * toolbar spec, "The timing tool shows module load order"): the scripts,
 * stylesheets, and remote entries its page loaded, as the browser's Resource
 * Timing measured them. No React or browser dependencies, so it can be tested
 * directly.
 */

export type LoadKind = "Script" | "Stylesheet" | "Remote entry";

export interface PageLoad {
  readonly url: string;
  /** The file as the list names it: its path under the build, or its address when it came from elsewhere. */
  readonly file: string;
  readonly kind: LoadKind;
  /** From the start of the page's navigation. */
  readonly startMs: number;
  readonly durationMs: number;
}

function kindOf(load: InspectedLoad, pathname: string): LoadKind {
  if (/remoteEntry/i.test(pathname)) return "Remote entry";
  return /\.css$/i.test(pathname) || load.initiator === "css" ? "Stylesheet" : "Script";
}

/** A load as the list shows it, for a page whose build is served at +base+ on +origin+. */
export function pageLoad(load: InspectedLoad, base: string, origin: string): PageLoad {
  let file = load.url;
  let pathname = load.url;
  try {
    const url = new URL(load.url);
    pathname = url.pathname;
    if (url.origin === origin) file = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
    else file = `${url.host}${url.pathname}`;
  } catch {
    // Not an absolute address: shown as the browser reported it.
  }
  return { url: load.url, file, kind: kindOf(load, pathname), startMs: load.startMs, durationMs: load.durationMs };
}

/** +known+ with the loads in +reported+ it doesn't have yet; the inspector reports buffered entries, then each new one. */
export function addLoads(known: readonly PageLoad[], reported: readonly PageLoad[]): PageLoad[] {
  const seen = new Set(known.map((load) => `${load.url}@${load.startMs}`));
  return [...known, ...reported.filter((load) => !seen.has(`${load.url}@${load.startMs}`))];
}
