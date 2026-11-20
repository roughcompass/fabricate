import type { InspectedComposition } from "../inspector/protocol";
import type { AppliedRoute } from "../routing/routing-client";

/*
 * What Microfrontends lists (restore-toolbar-tools-and-branch-previews,
 * design decision 7; template-demo/microfrontends spec): each microfrontend
 * the Profile of the build's commit names, with what the page shows of it at
 * run time, and the remote entries and single-spa applications found only on
 * the page. No React or browser dependencies, so the rules can be tested
 * directly.
 */

export type MemberMechanism = "module-federation" | "import-map" | "single-spa" | "found";
export type MemberState = "loaded" | "not-loaded" | "failed" | "routed" | "by-code";

export const MECHANISM_LABELS: Record<MemberMechanism, string> = {
  "module-federation": "Module Federation remote",
  "import-map": "Import-map entry",
  "single-spa": "Single-spa application",
  found: "Found on the page",
};

export const STATE_LABELS: Record<MemberState, string> = { loaded: "Loaded", "not-loaded": "Not loaded yet", failed: "Failed to load", routed: "Routed", "by-code": "Loaded by code" };

/** A build a microfrontend can be routed to, as the composition endpoint answers it. */
export interface Candidate {
  readonly application: { readonly slug: string; readonly name: string };
  readonly preview: { readonly key: string; readonly ref: string } | null;
  readonly label: string;
  readonly build: { readonly preview: string; readonly commit: string } | null;
  readonly hasEntry: boolean;
}

/** A microfrontend from the Profile, as the composition endpoint answers it. */
export interface ProfiledMicrofrontend {
  readonly id: string;
  readonly mechanism: "module-federation" | "import-map";
  readonly name: string;
  readonly container: string | null;
  readonly entry: string | null;
  readonly entryPath: string | null;
  readonly candidates: readonly Candidate[];
}

export interface Member {
  readonly id: string;
  readonly mechanism: MemberMechanism;
  readonly name: string;
  readonly container: string | null;
  /** Its entry's address as built, or as the page requested it; null when code chooses it and the page hasn't yet. */
  readonly entry: string | null;
  readonly entryPath: string | null;
  readonly candidates: readonly Candidate[];
  readonly state: MemberState;
  /** Where it loads from now: the routed build's file, or its address as built. */
  readonly address: string | null;
  readonly route: AppliedRoute | null;
  /** Whether a single-spa container of that name is on the page. */
  readonly region: boolean;
}

const REMOTE_ENTRY = /remoteEntry|mf-manifest/i;
const lastSegment = (url: string) => url.replace(/[?#].*$/, "").split("/").filter(Boolean).at(-1) ?? url;

/** What the page shows of the entry +entry+: failed, loaded, or not requested. */
function runtimeState(entry: string, mechanism: "module-federation" | "import-map", container: string | null, runtime: InspectedComposition | null): MemberState {
  if (!runtime) return "not-loaded";
  if (runtime.failed.includes(entry)) return "failed";
  const request = runtime.requests.find((candidate) => candidate.url === entry);
  if (request && request.status >= 400) return "failed";
  // A module import is a CORS request, whose status a failure leaves at 0; a script tag's is 0 even when it loads.
  if (request && request.status === 0 && (mechanism === "import-map" || request.initiator === "fetch")) return "failed";
  if (request) return "loaded";
  if (container && runtime.containers.includes(container)) return "loaded";
  if (runtime.federation.some((instance) => instance.remotes.some((remote) => remote.entry === entry))) return "loaded";
  return "not-loaded";
}

/**
 * The members Microfrontends lists, from the Profile's +profiled+
 * microfrontends, the page's +runtime+ composition, and the view's +routes+.
 * The build's own files, under +own+, its absolute base, are never a
 * microfrontend it loads, such as a remote's own entry on its own page.
 */
export function membersOf(profiled: readonly ProfiledMicrofrontend[], runtime: InspectedComposition | null, routes: readonly AppliedRoute[], own = ""): Member[] {
  const regions = new Set(runtime?.regions ?? []);
  const members: Member[] = profiled.map((microfrontend) => {
    const route = routes.find((candidate) => candidate.id === microfrontend.id) ?? null;
    const state: MemberState = route ? "routed" : microfrontend.entry === null ? "by-code" : runtimeState(microfrontend.entry, microfrontend.mechanism, microfrontend.container, runtime);
    return { ...microfrontend, state, address: route?.to ?? microfrontend.entry, route, region: regions.has(microfrontend.name) };
  });
  const known = new Set(profiled.flatMap((microfrontend) => (microfrontend.entry ? [microfrontend.entry] : [])));
  // Remote entries the page loaded that the Profile couldn't resolve, by the address requested.
  const found = new Map<string, string>();
  const elsewhere = (url: string) => !(own && url.startsWith(own)) && !known.has(url) && !routes.some((route) => url.startsWith(route.to.slice(0, route.to.lastIndexOf("/") + 1)));
  for (const instance of runtime?.federation ?? []) for (const remote of instance.remotes) if (remote.entry && elsewhere(remote.entry)) found.set(remote.entry, remote.alias ?? remote.name);
  for (const request of runtime?.requests ?? []) if (REMOTE_ENTRY.test(request.url) && elsewhere(request.url) && !found.has(request.url)) found.set(request.url, lastSegment(request.url));
  for (const [entry, name] of found) {
    members.push({ id: `found:${entry}`, mechanism: "found", name, container: null, entry, entryPath: null, candidates: [], state: runtimeState(entry, "module-federation", null, runtime), address: entry, route: null, region: false });
  }
  // Single-spa applications mounted on the page that the Profile doesn't name.
  for (const region of regions) {
    if (members.some((member) => member.name === region)) continue;
    members.push({ id: `region:${region}`, mechanism: "single-spa", name: region, container: null, entry: null, entryPath: null, candidates: [], state: "loaded", address: null, route: null, region: true });
  }
  return members;
}
