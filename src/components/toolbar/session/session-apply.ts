/*
 * Applying a session preset to a running application before its build
 * loads (restore-toolbar-tools-and-branch-previews, design decision 8;
 * template-demo/session-presets spec). The toolbar's page shares the
 * frame's origin, so it writes the preset itself: local and session storage
 * items, which the frame shares, cookies for the build's own path, and the
 * query parameters, merged into the frame's address. Before writing, it
 * records what each item and cookie held, or that it was absent, under a
 * Frontend Registry key, so switching to another option restores them,
 * removing those that didn't exist. No React; the browser's storage and
 * cookies come in as an environment, so the rules can be tested directly.
 */

export type PresetStore = "local" | "session" | "cookie" | "query";

export interface AppliedEntry {
  readonly store: PresetStore;
  readonly name: string;
  readonly value: string;
}

/** What a preset replaced in this browser, for one view. */
export interface AppliedSession {
  /** The preset's public ID. */
  readonly preset: string;
  /** The build's path its cookies were set for. */
  readonly scope: string;
  /** Each item and cookie it set, with what it held before; null when it was absent. */
  readonly saved: readonly { readonly store: Exclude<PresetStore, "query">; readonly name: string; readonly previous: string | null }[];
  /** The query parameters it added to the address. */
  readonly query: readonly string[];
}

export interface SessionEnvironment {
  readonly local: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly session: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Sets a cookie as `document.cookie` does. */
  setCookie(text: string): void;
  /** A cookie the build's pages see, when the toolbar can read them, else null. */
  readCookie(name: string): string | null;
}

/** Where a view's applied preset is recorded, among the Frontend Registry's own keys. */
export const sessionKey = (view: string) => `frontend-registry:session:${view}`;

function record(environment: SessionEnvironment, view: string): AppliedSession | null {
  try {
    const stored = JSON.parse(environment.local.getItem(sessionKey(view)) ?? "null") as AppliedSession | null;
    return stored && typeof stored.preset === "string" && Array.isArray(stored.saved) ? stored : null;
  } catch {
    return null;
  }
}

const cookie = (name: string, value: string | null, scope: string) => (value === null ? `${name}=; Path=${scope}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax` : `${name}=${encodeURIComponent(value)}; Path=${scope}; SameSite=Lax`);

/** +address+ with each of +names+ left out of its query. */
export function withoutQuery(address: string, names: readonly string[]): string {
  if (!names.length) return address;
  const url = new URL(address, "http://frontend-registry.invalid");
  for (const name of names) url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Restores what the preset applied for +view+ replaced: each item and cookie
 * to what it held, those that didn't exist removed. Returns the query
 * parameters it had added, which the address leaves out from now on.
 */
export function restoreSession(environment: SessionEnvironment, view: string): readonly string[] {
  const applied = record(environment, view);
  if (!applied) return [];
  for (const { store, name, previous } of applied.saved) {
    if (store === "cookie") environment.setCookie(cookie(name, previous, applied.scope));
    else {
      const storage = store === "local" ? environment.local : environment.session;
      if (previous === null) storage.removeItem(name);
      else storage.setItem(name, previous);
    }
  }
  environment.local.removeItem(sessionKey(view));
  return applied.query;
}

/**
 * Applies the preset +preset+ for +view+, whose build is served at +scope+:
 * records what each item and cookie held, writes the preset's, and returns
 * +address+ with its query parameters merged in, replacing any of the same
 * name.
 */
export function applySession(environment: SessionEnvironment, view: string, scope: string, preset: { readonly publicId: string; readonly entries: readonly AppliedEntry[] }, address: string): string {
  const saved: AppliedSession["saved"][number][] = [];
  const query: string[] = [];
  const url = new URL(address, "http://frontend-registry.invalid");
  for (const { store, name, value } of preset.entries) {
    if (store === "query") {
      url.searchParams.set(name, value);
      if (!query.includes(name)) query.push(name);
      continue;
    }
    if (!saved.some((entry) => entry.store === store && entry.name === name)) {
      const previous = store === "cookie" ? environment.readCookie(name) : (store === "local" ? environment.local : environment.session).getItem(name);
      saved.push({ store, name, previous });
    }
    if (store === "cookie") environment.setCookie(cookie(name, value, scope));
    else (store === "local" ? environment.local : environment.session).setItem(name, value);
  }
  const applied: AppliedSession = { preset: preset.publicId, scope, saved, query };
  environment.local.setItem(sessionKey(view), JSON.stringify(applied));
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A preset's entries summarized by kind: `1 local storage item · 1 cookie · 1 query parameter`. */
export function summarizeEntries(entries: readonly { readonly store: PresetStore }[], countLabel: (count: number, noun: string) => string): string {
  const nouns: Record<PresetStore, string> = { local: "local storage item", session: "session storage item", cookie: "cookie", query: "query parameter" };
  return (["local", "session", "cookie", "query"] as const)
    .map((store) => ({ store, total: entries.filter((entry) => entry.store === store).length }))
    .filter(({ total }) => total > 0)
    .map(({ store, total }) => countLabel(total, nouns[store]))
    .join(" · ");
}
