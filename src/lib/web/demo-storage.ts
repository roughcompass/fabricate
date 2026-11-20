import { LEGACY_NAMES } from "@/lib/legacy-names";

/** The prefix of every local storage key the toolbar writes, named when it belonged to the template demo and kept so visitors keep their preferences. */
export const DEMO_STORAGE_PREFIX = "frontend-registry-demo";

/**
 * A demo item in local storage, under +key+ or, for one release, under the
 * key it had before the rename (design.md, decision 9). An item found under
 * its old key moves to the new one. Keys start with DEMO_STORAGE_PREFIX.
 */
export function readDemoItem(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, key: string): string | null {
  const value = storage.getItem(key);
  if (value !== null || !key.startsWith(DEMO_STORAGE_PREFIX)) return value;
  const legacyKey = `${LEGACY_NAMES.demoStoragePrefix}${key.slice(DEMO_STORAGE_PREFIX.length)}`;
  const legacy = storage.getItem(legacyKey);
  if (legacy === null) return null;
  try {
    storage.setItem(key, legacy);
    storage.removeItem(legacyKey);
  } catch {
    // Storage can be full or disabled; the old item still counts for this page.
  }
  return legacy;
}
