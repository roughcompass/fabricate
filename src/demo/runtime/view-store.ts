import { type AppDefinition, DEFAULT_PERSONA, type EnvironmentId, type LoadEntry, PERSONAS, memberById } from "@/lib/demo/catalog";
import { resolveRouting } from "@/lib/demo/routing";
import type { ShareState } from "@/lib/demo/shares";
import { readStored, writeStored } from "./storage";

/**
 * The state of one view of a running application, kept outside React and
 * read with useSyncExternalStore. Theme, persona, and microfrontend overrides
 * persist in the browser for the view; the server renders the defaults (or a
 * share link's captured state), so hydration never mismatches.
 */

export type RuntimeTheme = "light" | "dark";

export interface Override {
  readonly version: string;
  readonly environment: EnvironmentId;
}

export interface ViewState {
  readonly theme: RuntimeTheme;
  readonly personaId: string;
  readonly overrides: Readonly<Record<string, Override>>;
}

export interface LoadRecord extends LoadEntry {
  readonly kind: "load" | "swap";
  /** For a swap, the version it replaced. */
  readonly from?: string;
}

export interface Activity {
  /** The current route's load sequence, with any version swaps appended. */
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
  setPersona(personaId: string): void;
  /** Applies overrides, reloading only the members whose version changed. */
  applyOverrides(overrides: Readonly<Record<string, Override>>): void;
  /** Records a route's scripted load sequence; `startedAt` is when the route began loading. */
  startRoute(entries: readonly LoadEntry[], startedAt: number): void;
  markChanged(): void;
}

function parseState(app: AppDefinition, value: unknown): ViewState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const theme = raw.theme === "dark" ? "dark" : "light";
  const personaId = PERSONAS.some((persona) => persona.id === raw.personaId) ? (raw.personaId as string) : DEFAULT_PERSONA.id;
  const overrides: Record<string, Override> = {};
  for (const [member, override] of Object.entries((raw.overrides ?? {}) as Record<string, Override>)) {
    const known = memberById(app, member);
    if (known && known.versions.some((version) => version.version === override?.version) && ["production", "sandbox", "dev"].includes(override?.environment)) overrides[member] = { version: override.version, environment: override.environment };
  }
  return { theme, personaId, overrides };
}

export function stateFromShare(app: AppDefinition, share: ShareState | null): ViewState {
  if (!share) return { theme: "light", personaId: DEFAULT_PERSONA.id, overrides: {} };
  return parseState(app, { theme: share.theme, personaId: share.persona, overrides: share.overrides })!;
}

export function createViewStore(app: AppDefinition, deployed: EnvironmentId, viewKey: string, share: ShareState | null, shareToken: string | null): ViewStore {
  const listeners = new Set<Listener>();
  const serverState = stateFromShare(app, share);
  let state = serverState;
  let loadedFromBrowser = false;
  let activity: Activity = { loads: [], swapping: new Set(), changes: 0 };
  let routeStartedAt = 0;

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
    setPersona(personaId) {
      if (state.personaId === personaId || !PERSONAS.some((persona) => persona.id === personaId)) return;
      state = { ...state, personaId };
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
      const now = Date.now();
      const swaps = changed.map((member): LoadRecord => ({ member, version: after[member]!, startMs: Math.max(0, now - routeStartedAt), durationMs: memberById(app, member)!.swapMs, kind: "swap", from: before[member] }));
      setActivity({ loads: [...activity.loads, ...swaps], swapping: new Set([...activity.swapping, ...changed]), changes: activity.changes + 1 });
      for (const swap of swaps) {
        window.setTimeout(() => {
          const swapping = new Set(activity.swapping);
          swapping.delete(swap.member);
          setActivity({ swapping });
        }, swap.durationMs);
      }
    },
    startRoute(entries, startedAt) {
      routeStartedAt = startedAt;
      setActivity({ loads: entries.map((entry) => ({ ...entry, kind: "load" })), swapping: new Set(), changes: activity.changes + 1 });
    },
    markChanged() {
      setActivity({ changes: activity.changes + 1 });
    },
  };
}

/** Each member's version under the routing rules: its valid override, or its default. */
export function effectiveVersions(app: AppDefinition, deployed: EnvironmentId, overrides: Readonly<Record<string, Override>>): Record<string, string> {
  return Object.fromEntries(Object.values(resolveRouting(app, deployed, overrides)).map((routing) => [routing.member, routing.version]));
}
