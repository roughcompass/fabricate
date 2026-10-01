/**
 * Browser-held state for one view of a running application: theme, persona,
 * microfrontend overrides, and toolbar preferences (design.md, decision 11).
 * Keys include the view key, which carries the workspace's reset epoch, so a
 * reset leaves earlier state unread.
 */

const PREFIX = "fabricate-demo";

export function storageKey(viewKey: string, name: string): string {
  return `${PREFIX}:${viewKey}:${name}`;
}

export function readStored<T>(viewKey: string, name: string, parse: (value: unknown) => T | null): T | null {
  try {
    const raw = window.localStorage.getItem(storageKey(viewKey, name));
    return raw === null ? null : parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStored(viewKey: string, name: string, value: unknown): void {
  try {
    window.localStorage.setItem(storageKey(viewKey, name), JSON.stringify(value));
  } catch {
    // Storage can be full or disabled; the demo keeps working without persistence.
  }
}
