import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { availableProfiles, createProfilesStore, resolveProfile, sharedProfileOf } from "@/demo/runtime/profiles";
import { SHARED_PROFILE_ID, createViewStore, stateFromShare } from "@/demo/runtime/view-store";
import { storageKey } from "@/demo/runtime/storage";
import { type Profile, templateBySlug } from "@/lib/demo/catalog";
import type { ShareState } from "@/lib/demo/shares";

const app = templateBySlug("payments-workspace")!.app;
const VIEW = "app_0000000000000001:1:0";
const PRIYA: Profile = { id: "dpf_0123456789abcdef", name: "Priya Shah", persona: "Approver", region: "Mumbai", builtIn: false };
const SHARE: ShareState = { route: "payees", overrides: {}, theme: "dark", persona: "approver" };

/** A browser's localStorage, for the view store in Node. */
function stubWindow(entries: Record<string, unknown> = {}) {
  const storage = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    setTimeout,
  };
  return storage;
}

describe("the view store's session profile", () => {
  beforeEach(() => stubWindow());
  afterEach(() => delete (globalThis as { window?: unknown }).window);

  it("starts as Jordan Lee", () => {
    const store = createViewStore(app, "production", VIEW, null, null);
    expect(store.getServerState().profileId).toBe("analyst");
    expect(store.getState().profileId).toBe("analyst");
  });

  it("reads a view stored before profiles, which kept a persona id", () => {
    stubWindow({ [storageKey(VIEW, "view")]: { theme: "dark", personaId: "approver", overrides: {} } });
    const store = createViewStore(app, "production", VIEW, null, null);
    expect(store.getState()).toMatchObject({ theme: "dark", profileId: "approver" });
  });

  it("prefers the stored profile id, and stores it under its new name", () => {
    const storage = stubWindow({ [storageKey(VIEW, "view")]: { theme: "light", personaId: "approver", profileId: PRIYA.id, overrides: {} } });
    const store = createViewStore(app, "production", VIEW, null, null);
    expect(store.getState().profileId).toBe(PRIYA.id);
    store.setProfile("administrator");
    expect(JSON.parse(storage.get(storageKey(VIEW, "view"))!)).toMatchObject({ profileId: "administrator" });
    expect(JSON.parse(storage.get(storageKey(VIEW, "view"))!)).not.toHaveProperty("personaId");
  });

  it("falls back to Jordan Lee for a malformed stored id, and ignores a malformed new one", () => {
    stubWindow({ [storageKey(VIEW, "view")]: { theme: "light", profileId: "<script>", overrides: {} } });
    const store = createViewStore(app, "production", VIEW, null, null);
    expect(store.getState().profileId).toBe("analyst");
    store.setProfile("Not An Id");
    expect(store.getState().profileId).toBe("analyst");
  });

  it("opens a share link with its profile snapshot, or with the built-in profile a link from before profiles names", () => {
    expect(stateFromShare(app, { ...SHARE, profile: { name: "Priya Shah", persona: "Approver", region: "Mumbai" } }).profileId).toBe(SHARED_PROFILE_ID);
    expect(stateFromShare(app, SHARE).profileId).toBe("approver");
    expect(stateFromShare(app, { ...SHARE, persona: "someone-else" }).profileId).toBe("analyst");
  });
});

describe("resolving a view's profile", () => {
  it("finds a built-in profile, one of the visitor's own, or the share link's snapshot", () => {
    const shared = sharedProfileOf({ ...SHARE, profile: { name: "Robin Chen", persona: "Administrator", region: "Paris" } });
    expect(shared).toEqual({ id: SHARED_PROFILE_ID, name: "Robin Chen", persona: "Administrator", region: "Paris", builtIn: false });
    expect(resolveProfile("approver", [PRIYA], shared).name).toBe("Sam Rivera");
    expect(resolveProfile(PRIYA.id, [PRIYA], shared)).toBe(PRIYA);
    expect(resolveProfile(SHARED_PROFILE_ID, [PRIYA], shared).name).toBe("Robin Chen");
    expect(availableProfiles([PRIYA], shared).map((profile) => profile.name)).toEqual(["Robin Chen", "Jordan Lee", "Sam Rivera", "Alex Morgan", "Priya Shah"]);
  });

  it("falls back to Jordan Lee once a profile is deleted, or for a link without a snapshot", () => {
    expect(resolveProfile(PRIYA.id, [], null).name).toBe("Jordan Lee");
    expect(resolveProfile(SHARED_PROFILE_ID, [PRIYA], sharedProfileOf(SHARE)).name).toBe("Jordan Lee");
    expect(resolveProfile("nobody", [PRIYA], null).name).toBe("Jordan Lee");
  });

  it("tells subscribers when the visitor's profiles change", () => {
    const store = createProfilesStore([PRIYA]);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.setProfiles([]);
    expect(store.getProfiles()).toEqual([]);
    unsubscribe();
    store.setProfiles([PRIYA]);
    expect(calls).toBe(1);
  });
});
