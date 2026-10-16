import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { applicationCatalog, portalSwitcherList } from "@/lib/onboarding/catalog";
import { createPortal, getPortal, retirePortal } from "@/lib/onboarding/portals";
import { ensurePortal } from "@/lib/ownership/records";
import { currentPortal } from "@/lib/web/portal";
import { createTestDb } from "../support/db";
import { ana, onboardApplication, onboardPortal, portalInput } from "../support/onboarding";

/*
 * The current Portal (add-portal-switcher task 4.1): the Portals the switcher
 * lists, and which Portal a remembered cookie value still names.
 */

describe("the Portal switcher", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const retire = (publicId: string) => retirePortal(db, publicId, { lockVersion: getPortal(db, publicId).lockVersion, reason: "Merged into Markets", actor: ana });

  it("lists onboarded Portals that aren't Retired, sorted by name (Three Portals, Retired and claim-only Portals)", () => {
    onboardPortal(db, "Treasury");
    createPortal(db, portalInput("access", { platform: "mobile", sealId: "1042" }), ana);
    onboardPortal(db, "Markets");
    const payments = onboardPortal(db, "Payments");
    retire(payments.publicId);
    ensurePortal(db, "Lending");

    expect(portalSwitcherList(db).map(({ label, slug, sealId, platform }) => [label, slug, sealId, platform])).toEqual([
      ["access", "access", "1042", "mobile"],
      ["Markets", "markets", "88001", "web"],
      ["Treasury", "treasury", "88001", "web"],
    ]);
  });

  it("lists nothing before a Portal is onboarded (First visit)", () => {
    ensurePortal(db, "Lending");
    expect(portalSwitcherList(db)).toEqual([]);
  });

  it("resolves a remembered Portal, and treats a missing, unknown, claim-only, or retired one as All Portals (Remembered Portal is retired)", () => {
    const markets = onboardPortal(db, "Markets");
    const lending = ensurePortal(db, "Lending");
    expect(currentPortal(db, markets.publicId)?.label).toBe("Markets");
    expect(currentPortal(db, undefined)).toBeNull();
    expect(currentPortal(db, "")).toBeNull();
    expect(currentPortal(db, "ptl_0000000000000000")).toBeNull();
    expect(currentPortal(db, "not a public id")).toBeNull();
    expect(currentPortal(db, lending.publicId)).toBeNull();
    retire(markets.publicId);
    expect(currentPortal(db, markets.publicId)).toBeNull();
  });
});

describe("scoping Web Applications to the current Portal", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  /** An Application launching an external iframe, asking for a placement in each of +portals+. */
  const application = (name: string, portals: string[]) =>
    onboardApplication(db, name, {
      launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" },
      placements: portals.map((portal) => ({ placement: null, portal, menuParent: "payments", route: `/${name.toLowerCase()}`, label: name, order: 1, environments: ["uat", "prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false })),
    }).application;

  it("lists only Applications with a placement in the Portal, pending ones included (Scoped Applications, Application with no placements)", () => {
    const markets = onboardPortal(db, "Markets");
    const access = onboardPortal(db, "Access");
    application("Ledger", [markets.publicId]);
    application("Payroll", [access.publicId]);
    application("Shared", [access.publicId, markets.publicId]);
    application("Onboard", []);
    const names = (portalId?: number) => applicationCatalog(db, "", { portalId }).map((row) => row.application.name);
    expect(names(markets.id)).toEqual(["Ledger", "Shared"]);
    expect(names(access.id)).toEqual(["Payroll", "Shared"]);
    expect(names()).toEqual(["Ledger", "Onboard", "Payroll", "Shared"]);
  });
});

