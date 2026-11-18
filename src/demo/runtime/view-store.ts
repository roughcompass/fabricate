import { type AppDefinition, DEFAULT_PROFILE, type EnvironmentId, type LoadEntry, builtInProfile, memberById } from "@/lib/demo/catalog";
import { resolveRouting } from "@/lib/demo/routing";
import type { ShareState } from "@/lib/demo/shares";
import { readStored, writeStored } from "./storage";

/**
 * The state of one view of a running application, kept outside React and
 * read with useSyncExternalStore. Theme, session profile, and microfrontend
 * overrides persist in the browser for the view; the server renders the
 * defaults (or a share link's captured state), so hydration never mismatches.
 */

/** The id of a share link's profile snapshot, which the recipient sees without it joining their own profiles. */
export const SHARED_PROFILE_ID = "shared";

// A built-in profile, a share link's snapshot, or one of the visitor's own. Which exist is resolved on render.
const PROFILE_ID = /^(?:[a-z]{1,20}|dpf_[a-z0-9]{16})$/;

export type RuntimeTheme = "light" | "dark";

export interface Override {
  readonly version: string;
  readonly environment: EnvironmentId;
}

export interface ViewState {
  readonly theme: RuntimeTheme;
  /** The active session profile's id; one that no longer resolves falls back to Jordan Lee. */
  readonly profileId: string;
  readonly overrides: Readonly<Record<string, Override>>;
}

export interface LoadRecord {
  readonly member: string;
  readonly version: string;
  /** When the load began, in milliseconds from the route's start: for the page's first route, the navigation itself. */
  readonly startMs: number;
  /** Measured from the load's start until the member painted; null while it is still loading. */
  readonly durationMs: number | null;
  readonly kind: "load" | "swap";
  /** For a swap, the version it replaced. */
  readonly from?: string;
}

export interface Activity {
  /** The current route's loads, with any version swaps appended. */
  readonly loads: readonly LoadRecord[];
  /** Members reloading after a version change. */
  readonly swapping: ReadonlySet<string>;
  /** Increments on navigation, version changes, and settings changes, so audits can tell they are stale. */
  readonly changes: number;
}

type Listener = () => void;

const STATE_KEY = "view";
const SHARE_KEY = "applied-share";

export interface ViewStore {
  subscribe(listener: Listener): () => void;
  getState(): ViewState;
  getServerState(): ViewState;
  getActivity(): Activity;
  setTheme(theme: RuntimeTheme): void;
  setProfile(profileId: string): void;
  /** Applies overrides, reloading only the members whose version changed. */
  applyOverrides(overrides: Readonly<Record<string, Override>>): void;
  /**
   * Records a route's loads. `startedAt` is when the runtime began loading the
   * route's regions, on the performance clock; each region's `startMs` is its
   * scripted request delay from then. The shell's load is recorded only for
   * the page's first route, as the navigation until the runtime started.
   */
  startRoute(path: string, shell: LoadEntry, regions: readonly LoadEntry[], startedAt: number): void;
  /** Finishes the member's pending loads when it paints, `at` on the performance clock. */
  markPainted(member: string, at: number): void;
  markChanged(): void;
}

function parseState(app: AppDefinition, value: unknown): ViewState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const theme = raw.theme === "dark" ? "dark" : "light";
  // Views stored before profiles kept a persona id, which is a built-in profile's id.
  const stored = raw.profileId ?? raw.personaId;
  const profileId = typeof stored === "string" && PROFILE_ID.test(stored) ? stored : DEFAULT_PROFILE.id;
  const overrides: Record<string, Override> = {};
  for (const [member, override] of Object.entries((raw.overrides ?? {}) as Record<string, Override>)) {
    const known = memberById(app, member);
    if (known && known.versions.some((version) => version.version === override?.version) && ["production", "sandbox", "dev"].includes(override?.environment)) overrides[member] = { version: override.version, environment: override.environment };
  }
  return { theme, profileId, overrides };
}

/** A share link's state: its snapshot profile, or for a link from before profiles, the built-in profile its persona names. */
export function stateFromShare(app: AppDefinition, share: ShareState | null): ViewState {
  if (!share) return { theme: "light", profileId: DEFAULT_PROFILE.id, overrides: {} };
  const profileId = share.profile ? SHARED_PROFILE_ID : (builtInProfile(share.persona) ?? DEFAULT_PROFILE).id;
  return parseState(app, { theme: share.theme, profileId, overrides: share.overrides })!;
}

export function createViewStore(app: AppDefinition, deployed: EnvironmentId, viewKey: string, share: ShareState | null, shareToken: string | null): ViewStore {
  const listeners = new Set<Listener>();
  const serverState = stateFromShare(app, share);
  let state = serverState;
  let loadedFromBrowser = false;
  let activity: Activity = { loads: [], swapping: new Set(), changes: 0 };
  // Load times are on the performance clock, from the navigation for the first route and from its start for later ones.
  let routeStartedAt = 0;
  let firstPath: string | null = null;
  let navigated = false;
  // A swapped member with no region on the page never paints, so its swap finishes when the swap does.
  let regions: ReadonlySet<string> = new Set();

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const persist = () => writeStored(viewKey, STATE_KEY, state);

  // A share link's state applies once per token; after that the recipient's own changes win.
  const loadFromBrowser = () => {
    loadedFromBrowser = true;
    if (shareToken && readStored(viewKey, SHARE_KEY, (value) => (typeof value === "string" ? value : null)) !== shareToken) {
      writeStored(viewKey, SHARE_KEY, shareToken);
      persist();
      return;
    }
    state = readStored(viewKey, STATE_KEY, (value) => parseState(app, value)) ?? serverState;
  };

  const setActivity = (next: Partial<Activity>) => {
    activity = { ...activity, ...next };
    notify();
  };

  const markPainted = (member: string, at: number) => {
    const end = at - routeStartedAt;
    // A load a swap replaced before it painted finishes with the swap.
    if (!activity.loads.some((load) => load.member === member && load.durationMs === null)) return;
    setActivity({ loads: activity.loads.map((load) => (load.member === member && load.durationMs === null ? { ...load, durationMs: Math.max(0, end - load.startMs) } : load)) });
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState() {
      if (!loadedFromBrowser && typeof window !== "undefined") loadFromBrowser();
      return state;
    },
    getServerState() {
      return serverState;
    },
    getActivity() {
      return activity;
    },
    setTheme(theme) {
      if (state.theme === theme) return;
      state = { ...state, theme };
      persist();
      setActivity({ changes: activity.changes + 1 });
    },
    setProfile(profileId) {
      if (state.profileId === profileId || !PROFILE_ID.test(profileId)) return;
      state = { ...state, profileId };
      persist();
      setActivity({ changes: activity.changes + 1 });
    },
    applyOverrides(overrides) {
      const before = effectiveVersions(app, deployed, state.overrides);
      state = { ...state, overrides: parseState(app, { ...state, overrides })!.overrides };
      persist();
      const after = effectiveVersions(app, deployed, state.overrides);
      const changed = Object.keys(after).filter((member) => after[member] !== before[member]);
      if (!changed.length) {
        setActivity({ changes: activity.changes + 1 });
        return;
      }
      const startMs = Math.max(0, performance.now() - routeStartedAt);
      const swaps = changed.map((member): LoadRecord => ({ member, version: after[member]!, startMs, durationMs: null, kind: "swap", from: before[member] }));
      setActivity({ loads: [...activity.loads, ...swaps], swapping: new Set([...activity.swapping, ...changed]), changes: activity.changes + 1 });
      for (const swap of swaps) {
        window.setTimeout(() => {
          const swapping = new Set(activity.swapping);
          swapping.delete(swap.member);
          setActivity({ swapping });
          if (!regions.has(swap.member)) markPainted(swap.member, performance.now());
        }, memberById(app, swap.member)!.swapMs);
      }
    },
    startRoute(path, shell, routeRegions, startedAt) {
      // Strict Mode starts the first route twice, so the first route is the one before any other path.
      firstPath ??= path;
      if (path !== firstPath) navigated = true;
      routeStartedAt = navigated ? startedAt : 0;
      regions = new Set(routeRegions.map((entry) => entry.member));
      const offset = startedAt - routeStartedAt;
      const shellLoad: LoadRecord[] = navigated ? [] : [{ member: shell.member, version: shell.version, startMs: 0, durationMs: startedAt, kind: "load" }];
      const loads = routeRegions.map((entry): LoadRecord => ({ member: entry.member, version: entry.version, startMs: offset + entry.startMs, durationMs: null, kind: "load" }));
      setActivity({ loads: [...shellLoad, ...loads], swapping: new Set(), changes: activity.changes + 1 });
    },
    markPainted,
    markChanged() {
      setActivity({ changes: activity.changes + 1 });
    },
  };
}

/** Each member's version under the routing rules: its valid override, or its default. */
export function effectiveVersions(app: AppDefinition, deployed: EnvironmentId, overrides: Readonly<Record<string, Override>>): Record<string, string> {
  return Object.fromEntries(Object.values(resolveRouting(app, deployed, overrides)).map((routing) => [routing.member, routing.version]));
}
