import { LEGACY_NAMES } from "@/lib/legacy-names";
import { SIDEBAR_HIDDEN_COOKIE, SIDEBAR_WIDTH_COOKIE } from "./sidebar";
import { THEME_COOKIE } from "./theme";

/** How long a preference lasts in the browser. */
export const PREFERENCE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The operator's preference cookies. The theme's is httpOnly; the sidebar's
 * aren't, because the browser writes them itself while the operator resizes
 * or hides the sidebar.
 */
const PREFERENCE_COOKIES = [
  { name: THEME_COOKIE, httpOnly: true },
  { name: SIDEBAR_HIDDEN_COOKIE, httpOnly: false },
  { name: SIDEBAR_WIDTH_COOKIE, httpOnly: false },
] as const;

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/** A cookie for a response to set. */
export interface PreferenceCookie {
  readonly name: string;
  readonly value: string;
  readonly path: "/";
  readonly maxAge: number;
  readonly sameSite: "lax";
  readonly httpOnly?: true;
}

/** The name a preference cookie had before the rename, read for one release. */
export function legacyCookieName(name: string): string | undefined {
  return LEGACY_NAMES.cookies[name];
}

/** A preference cookie's value, under its name or, for one release, the name it had before the rename. */
export function preferenceCookie(jar: CookieReader, name: string): string | undefined {
  const legacy = legacyCookieName(name);
  return jar.get(name)?.value ?? (legacy === undefined ? undefined : jar.get(legacy)?.value);
}

/**
 * How to move the preferences a browser still keeps under their old names to
 * the new ones: set each under its new name, with the same lifetime and
 * attributes, and delete the old one. A cookie already under its new name
 * wins, so only the old one is deleted.
 */
export function preferenceCookieRenames(request: CookieReader): { set: PreferenceCookie[]; remove: string[] } {
  const set: PreferenceCookie[] = [];
  const remove: string[] = [];
  for (const { name, httpOnly } of PREFERENCE_COOKIES) {
    const legacy = legacyCookieName(name);
    const old = legacy === undefined ? undefined : request.get(legacy)?.value;
    if (legacy === undefined || old === undefined) continue;
    if (request.get(name) === undefined) set.push({ name, value: old, path: "/", maxAge: PREFERENCE_MAX_AGE, sameSite: "lax", ...(httpOnly ? { httpOnly } : {}) });
    remove.push(legacy);
  }
  return { set, remove };
}
