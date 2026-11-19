import { describe, expect, it } from "vitest";
import { DEMO_STORAGE_PREFIX, readDemoItem } from "@/lib/web/demo-storage";

function storage(entries: Record<string, string>) {
  const items = new Map(Object.entries(entries));
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };
}

// The demo's local storage is read under its old and new keys, and written under the new ones (design.md, decision 9).
describe("the template demo's local storage", () => {
  const key = `${DEMO_STORAGE_PREFIX}:toolbar`;

  it("uses the new prefix", () => {
    expect(key).toBe("frontend-registry-demo:toolbar");
  });

  it("reads an item under its new key", () => {
    expect(readDemoItem(storage({ [key]: "new", "fabricate-demo:toolbar": "old" }), key)).toBe("new");
  });

  it("honors an item under its old key and moves it to the new one", () => {
    const store = storage({ "fabricate-demo:app_1:1:0:view": "old" });

    expect(readDemoItem(store, `${DEMO_STORAGE_PREFIX}:app_1:1:0:view`)).toBe("old");
    expect([...store.items]).toEqual([[`${DEMO_STORAGE_PREFIX}:app_1:1:0:view`, "old"]]);
  });

  it("finds nothing when neither key holds the item", () => {
    expect(readDemoItem(storage({}), key)).toBeNull();
  });

  it("keeps the old item for this page when storage refuses the write", () => {
    const store = { ...storage({ "fabricate-demo:toolbar": "old" }), setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(readDemoItem(store, key)).toBe("old");
  });
});
