import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { BlockedError } from "@/lib/onboarding/issues";
import { buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { decide, onboardApplication, onboardPortal, placementsOf, portalDraft, registerMfe } from "../support/onboarding";

/*
 * The onboarding builders make records only through the operations the
 * interface uses, so a fixture can't hold anything the product refuses.
 */
describe("onboarding test builders", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  it("refuse a Portal the product would refuse, with its validation issues", () => {
    let refused: unknown;
    try {
      onboardPortal(db, "Access", { environments: portalDraft().environments.map(() => "prod") });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(BlockedError);
    expect((refused as BlockedError).message).toMatch(/PROD is chosen more than once/);
    expect(db.$client.prepare("select count(*) as n from portal_environments").get()).toEqual({ n: 0 });
  });

  it("refuse an MFE built from a disabled Repository", () => {
    expect(() => registerMfe(db, "Payee search", { repository: buildSource(db, { name: "legacy", enabled: false }) })).toThrow(/disabled in the catalog/);
    expect(db.$client.prepare("select count(*) as n from microfrontend_revisions where state = 'submitted'").get()).toEqual({ n: 0 });
  });

  it("refuse an Application whose route another Application holds, and a stale decision", () => {
    const access = onboardPortal(db, "Access").publicId;
    const request = { placement: null, portal: access, menuParent: null, route: "/payments", label: "Payments", order: 1, environments: ["prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false };
    const first = onboardApplication(db, "Payments workspace", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" }, placements: [request] }).application;
    const [placement] = placementsOf(db, first.publicId);
    decide(db, placement!, "approve");
    expect(() => onboardApplication(db, "Payments reporting", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/reports" }, placements: [request] })).toThrow(/already serves \/payments/);
    expect(() => decide(db, placement!, "approve")).toThrow(/An approved placement can't be approved/);
  });

  it("refuse an unconfirmed rendering mode, as submission does", () => {
    expect(() => onboardApplication(db, "Payments workspace", { launch: { kind: "external", documentUrl: "https://payments.example.com/app" } })).toThrow(/Choose a rendering mode/);
  });
});
