import type { Post } from "./agent-post";
import { observes } from "./agent-timing";
import type { InspectedComposition, InspectedFederation, InspectedImportMap, InspectedRequest } from "./protocol";

/*
 * The agent's composition module: what the page shows it's composed of at
 * run time, reported once the page starts and again whenever it changes.
 *
 * - Module Federation 2 runtime instances, `globalThis.__FEDERATION__`, with
 *   their remotes and entries;
 * - Module Federation 1 containers: window globals with `get` and `init`;
 * - the scripts and manifests the page requested, from Resource Timing, and
 *   those whose element reported an error;
 * - the page's import maps, native and SystemJS;
 * - the single-spa application containers on the page.
 */

const SINGLE_SPA_PREFIX = "single-spa-application:";
const REQUEST_FILE = /\.(m?js|cjs|json)(\?|#|$)|remoteEntry/i;
const REQUEST_LIMIT = 500;
/** Coalesces a burst of changes, such as a render that adds many elements, into one report. */
const SETTLE_MS = 100;

interface FederationGlobal {
  __INSTANCES__?: { name?: unknown; options?: { remotes?: unknown } }[];
}

function federation(): InspectedFederation[] {
  const instances = (globalThis as { __FEDERATION__?: FederationGlobal }).__FEDERATION__?.__INSTANCES__;
  if (!Array.isArray(instances)) return [];
  return instances.map((instance) => ({
    name: String(instance.name ?? ""),
    remotes: (Array.isArray(instance.options?.remotes) ? instance.options.remotes : []).map((remote: { name?: unknown; alias?: unknown; entry?: unknown }) => ({
      name: String(remote.name ?? ""),
      alias: typeof remote.alias === "string" ? remote.alias : null,
      entry: typeof remote.entry === "string" ? remote.entry : null,
    })),
  }));
}

/**
 * Window globals that are Module Federation 1 containers. Only plain values
 * are read: the browser's own window attributes are accessors, and reading
 * some of them has effects.
 */
function containers(): string[] {
  const found: string[] = [];
  for (const name of Object.keys(window)) {
    const value = (Object.getOwnPropertyDescriptor(window, name)?.value ?? null) as { get?: unknown; init?: unknown } | null;
    if (value && typeof value === "object" && typeof value.get === "function" && typeof value.init === "function") found.push(name);
  }
  return found.sort();
}

function importMaps(): InspectedImportMap[] {
  return [...document.querySelectorAll<HTMLScriptElement>("script[type='importmap'], script[type='systemjs-importmap']")].map((script) => {
    const type = script.type === "importmap" ? "importmap" : "systemjs-importmap";
    if (script.src) return { type, imports: {}, src: script.src };
    try {
      const parsed = JSON.parse(script.textContent ?? "{}") as { imports?: Record<string, unknown> };
      const imports = Object.fromEntries(Object.entries(parsed.imports ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      return { type, imports, src: null };
    } catch {
      return { type, imports: {}, src: null };
    }
  });
}

function regions(): string[] {
  return [...document.querySelectorAll(`[id^='${SINGLE_SPA_PREFIX}']`)].map((element) => element.id.slice(SINGLE_SPA_PREFIX.length));
}

export function reportComposition(post: Post): void {
  const requests: InspectedRequest[] = [];
  const failed = new Set<string>();
  let last = "";
  let timer = 0;

  const send = () => {
    timer = 0;
    const composition: InspectedComposition = { federation: federation(), containers: containers(), requests: [...requests], failed: [...failed], importMaps: importMaps(), regions: regions() };
    const text = JSON.stringify(composition);
    if (text === last) return;
    last = text;
    post({ kind: "composition", composition });
  };
  const changed = () => {
    if (!timer) timer = window.setTimeout(send, SETTLE_MS);
  };

  if (observes("resource")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if (!REQUEST_FILE.test(entry.name) || requests.length >= REQUEST_LIMIT) continue;
        requests.push({ url: entry.name, initiator: entry.initiatorType, status: entry.responseStatus ?? 0 });
      }
      changed();
    }).observe({ type: "resource", buffered: true });
  }
  // A script or stylesheet that fails to load says so on its element; the event doesn't bubble, but the window sees it first.
  window.addEventListener(
    "error",
    (event) => {
      const element = event.target;
      if (element instanceof HTMLScriptElement && element.src) failed.add(element.src);
      else if (element instanceof HTMLLinkElement && element.href) failed.add(element.href);
      else return;
      changed();
    },
    true,
  );
  new MutationObserver(changed).observe(document, { childList: true, subtree: true });
  window.addEventListener("load", changed);
  changed();
}
