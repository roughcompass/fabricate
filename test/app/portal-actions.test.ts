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

const form = (portal?: string) => {
  const data = new FormData();
  if (portal !== undefined) data.set("portal", portal);
  return data;
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
});
