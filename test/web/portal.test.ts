import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { portals } from "@/lib/db/schema";
import { portalSwitcherList } from "@/lib/onboarding/catalog";
import { createPortal } from "@/lib/onboarding/portals";
import { ensurePortal } from "@/lib/ownership/records";
import { currentPortal } from "@/lib/web/portal";
import { createTestDb } from "../support/db";
import { ana, onboardPortal, portalInput } from "../support/onboarding";

/*
 * The current Portal (portal-switcher spec; make-applications-first-class
 * task 2.4): the Portals the switcher lists, each with its lifecycle, and
 * which Portal a remembered cookie value still names.
 */

describe("the Portal switcher", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("lists every onboarded Portal with its lifecycle, sorted by name, and leaves claim-only Portals out (Three Portals, Claim-only Portal)", () => {
    onboardPortal(db, "Treasury");
    createPortal(db, portalInput("access", { platform: "mobile", sealId: "1042" }), ana);
    const markets = onboardPortal(db, "Markets");
    db.update(portals).set({ lifecycle: "production" }).where(eq(portals.id, markets.id)).run();
    ensurePortal(db, "Lending");

    expect(portalSwitcherList(db).map(({ label, slug, sealId, platform, lifecycle }) => [label, slug, sealId, platform, lifecycle])).toEqual([
      ["access", "access", "1042", "mobile", "prototype"],
      ["Markets", "markets", "88001", "web", "production"],
      ["Treasury", "treasury", "88001", "web", "prototype"],
    ]);
  });

  it("lists nothing before a Portal is onboarded (First visit)", () => {
    ensurePortal(db, "Lending");
    expect(portalSwitcherList(db)).toEqual([]);
  });

  it("resolves a remembered Portal in either lifecycle, and treats a missing, unknown, or claim-only one as All Portals", () => {
    const markets = onboardPortal(db, "Markets");
    const lending = ensurePortal(db, "Lending");
    expect(currentPortal(db, markets.publicId)?.label).toBe("Markets");
    db.update(portals).set({ lifecycle: "production" }).where(eq(portals.id, markets.id)).run();
    expect(currentPortal(db, markets.publicId)?.lifecycle).toBe("production");
    expect(currentPortal(db, undefined)).toBeNull();
    expect(currentPortal(db, "")).toBeNull();
    expect(currentPortal(db, "ptl_0000000000000000")).toBeNull();
    expect(currentPortal(db, "not a public id")).toBeNull();
    expect(currentPortal(db, lending.publicId)).toBeNull();
  });
});
