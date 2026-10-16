import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectPortalAction } from "@/app/portal-actions";
import { type Db, setDb } from "@/lib/db/client";
import { createTestDb } from "../support/db";
import { onboardPortal } from "../support/onboarding";

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options?: Record<string, unknown>) => jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name),
  }),
}));
const refreshed = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refreshed() }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { location });
  },
}));

const form = (portal?: string, from?: string) => {
  const data = new FormData();
  if (portal !== undefined) data.set("portal", portal);
  if (from !== undefined) data.set("from", from);
  return data;
};
const redirectOf = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return (error as { location?: string }).location ?? null;
  }
  return null;
};

// web-onboarding/portal-switcher spec: the chosen Portal is remembered, and choosing works without JavaScript.
describe("selectPortalAction", () => {
  let db: Db;
  beforeEach(() => {
    jar.clear();
    refreshed.mockClear();
    db = createTestDb();
    setDb(db);
  });
  afterEach(() => setDb(undefined));

  it("remembers a listed Portal for a year, out of the browser's reach, and re-renders the page", async () => {
    const markets = onboardPortal(db, "Markets");
    await selectPortalAction(form(markets.publicId));
    expect(jar.get("fabricate-portal")).toEqual({ value: markets.publicId, options: { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true } });
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("clears the choice for All Portals", async () => {
    const markets = onboardPortal(db, "Markets");
    await selectPortalAction(form(markets.publicId));
    await selectPortalAction(form(""));
    expect(jar.has("fabricate-portal")).toBe(false);
  });

  it.each([["an unknown Portal", "ptl_0000000000000000"], ["no value", undefined], ["a malformed value", "ptl_x' or 1=1"]])("clears the choice for %s", async (_name, value) => {
    const markets = onboardPortal(db, "Markets");
    await selectPortalAction(form(markets.publicId));
    await selectPortalAction(form(value));
    expect(jar.has("fabricate-portal")).toBe(false);
    expect(refreshed).toHaveBeenCalledTimes(2);
  });

  it("opens the chosen Portal's Navigation page when chosen on another Portal's, and the list for All Portals (Switching on a Navigation page)", async () => {
    const access = onboardPortal(db, "Access");
    const markets = onboardPortal(db, "Markets");
    expect(await redirectOf(selectPortalAction(form(markets.publicId, `/navigation/${access.publicId}`)))).toBe(`/navigation/${markets.publicId}`);
    expect(jar.get("fabricate-portal")?.value).toBe(markets.publicId);
    expect(await redirectOf(selectPortalAction(form("", `/navigation/${markets.publicId}`)))).toBe("/navigation");
    // Anywhere else, the page re-renders in place.
    for (const from of ["/applications", "/navigation", "/navigation/new", "https://elsewhere.example/navigation/ptl_x"]) expect(await redirectOf(selectPortalAction(form(markets.publicId, from)))).toBeNull();
  });
});
