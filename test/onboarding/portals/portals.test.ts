import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { UNSTATED_ACTOR, statedActor } from "@/lib/onboarding/attribution";
import { addItem, menuOf, setDefault } from "@/lib/onboarding/navigation";
import { type Portal, createPortal, editPortalDetails, getPortal, portalHistory, promotePortal, returnToPrototype } from "@/lib/onboarding/portals";
import { ensurePortal } from "@/lib/ownership/records";
import { registerApplication } from "../../support/applications";
import { createTestDb } from "../../support/db";
import { ana, cy, onboardPortal, portalInput } from "../../support/onboarding";

/*
 * Portals edited in place (portals and navigation specs; make-applications-
 * first-class task 2.2): created as a Prototype with every value Create
 * Portal asks for, details changed with the version the operator saw,
 * promoted once it has a default route, and every change attributed,
 * Unverified, in its history.
 */

describe("Portals", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const refusal = (work: () => unknown) => {
    try {
      work();
    } catch (error) {
      if (error instanceof ValidationError) return error;
      throw error;
    }
    throw new Error("the change was accepted");
  };

  /** Access with Payee Hub as its default item, ready to promote. */
  const withDefault = (portal: Portal) => {
    const payeeHub = registerApplication(db, { name: "Payee Hub", portal });
    const item = addItem(db, portal.publicId, { lockVersion: getPortal(db, portal.publicId).lockVersion, label: "Payees", route: "/payees", application: payeeHub.publicId, parent: null }, ana);
    setDefault(db, portal.publicId, { lockVersion: getPortal(db, portal.publicId).lockVersion, entry: item.publicId }, ana);
    return getPortal(db, portal.publicId);
  };

  describe("identity (portals spec)", () => {
    it("keeps two Portals that share a SEAL ID apart, and a corrected SEAL ID keeps the Portal (Two Portals share a SEAL ID, Portal SEAL ID changes)", () => {
      const access = onboardPortal(db, "Access", { sealId: "88001" });
      const markets = onboardPortal(db, "Markets", { sealId: "88001" });
      expect(access.publicId).not.toBe(markets.publicId);
      const corrected = editPortalDetails(db, access.publicId, { ...portalInput("Access", { sealId: "88009" }), lockVersion: access.lockVersion }, ana);
      expect(corrected).toMatchObject({ id: access.id, publicId: access.publicId, sealId: "88009" });
      expect(getPortal(db, markets.publicId).sealId).toBe("88001");
    });

    it("holds identity, lifecycle, and nothing about code, environments, or platform policy (Portal onboarding completes)", () => {
      const columns = (db.$client.prepare("pragma table_info(portals)").all() as { name: string }[]).map((column) => column.name);
      expect(columns.filter((name) => /repository|archive|build|cdaas|runtime|environment|contract|entitlement|email/.test(name))).toEqual([]);
    });

    it("identifies its owner by team, with no email field (Portal needs no email)", () => {
      expect(onboardPortal(db, "Access", { ownerTeam: "Access Platform" })).toMatchObject({ ownerTeam: "Access Platform" });
      const columns = (db.$client.prepare("pragma table_info(portals)").all() as { name: string }[]).map((column) => column.name);
      expect(columns.filter((name) => /email|owner_(?!team)/.test(name))).toEqual([]);
    });

    it("onboards a Portal first named in an ownership claim, keeping its identity, and refuses an onboarded name", () => {
      const claimed = ensurePortal(db, "Digital Bank");
      const { portal, adopted } = createPortal(db, portalInput("digital  bank", { platform: "desktop", description: "Loans desk" }), ana);
      expect(adopted).toBe(true);
      expect(portal).toMatchObject({ publicId: claimed.publicId, platform: "desktop", slug: "digitalbank", description: "Loans desk", lifecycle: "prototype" });
      expect(() => createPortal(db, portalInput("Digital Bank", { slug: "digitalbanktwo" }), ana)).toThrow(/already onboarded/);
    });
  });

  describe("creating (portal-creation spec)", () => {
    it("starts every Portal as a Prototype, with the platform, SEAL ID, owning team, description, and derived slug", () => {
      const { portal } = createPortal(db, portalInput("My New Portal", { platform: "mobile", sealId: "1042", ownerTeam: " Treasury  Platform ", description: "  Treasury for mobile  " }), ana);
      expect(portal).toMatchObject({ label: "My New Portal", platform: "mobile", sealId: "1042", slug: "mynewportal", description: "Treasury for mobile", ownerTeam: "Treasury Platform", lifecycle: "prototype" });
    });

    it("keeps an edited slug", () => {
      expect(createPortal(db, portalInput("My New Portal", { slug: "mnp" }), ana).portal.slug).toBe("mnp");
    });

    it.each([
      [{ platform: "" }, "platform", "Choose the Portal's platform"],
      [{ platform: "kiosk" }, "platform", "Choose the Portal's platform"],
      [{ sealId: " " }, "sealId", "Enter the Portal's SEAL ID"],
      [{ sealId: "8 8" }, "sealId", "Enter a SEAL ID of letters, digits, dots, dashes, or underscores"],
      [{ ownerTeam: " " }, "ownerTeam", "Enter the team that owns the Portal"],
      [{ description: "" }, "description", "Enter a description of the Portal"],
      [{ description: "x".repeat(501) }, "description", "Use 500 characters or fewer"],
      [{ slug: "my-portal" }, "slug", "Enter a slug of lowercase letters"],
      [{ slug: "x".repeat(64) }, "slug", "Use 63 letters or fewer"],
    ])("refuses %j at %s", (input, field, message) => {
      expect(refusal(() => createPortal(db, portalInput("Treasury", input), ana)).messagesFor(field)).toEqual([message]);
      expect(db.$client.prepare("select count(*) as n from portals where label = 'Treasury'").get()).toEqual({ n: 0 });
    });

    it("derives no slug from a name without letters (Name without letters)", () => {
      expect(refusal(() => createPortal(db, portalInput("2026"), ana)).messagesFor("slug")).toEqual(["Enter a slug of lowercase letters"]);
    });

    it("refuses a slug another Portal has (Two Portals can't share a slug)", () => {
      onboardPortal(db, "Markets");
      expect(refusal(() => createPortal(db, portalInput("Treasury", { slug: "markets" }), ana)).messagesFor("slug")).toEqual(["The slug markets belongs to Markets"]);
    });
  });

  describe("editing details (navigation spec)", () => {
    it("changes the SEAL ID, name, owning team, and description, and records which changed", () => {
      const access = onboardPortal(db, "Access");
      const edited = editPortalDetails(db, access.publicId, { name: "Access Hub", sealId: "88002", ownerTeam: "Access Platform", description: "Payments for clients", lockVersion: access.lockVersion }, cy);
      expect(edited).toMatchObject({ label: "Access Hub", labelKey: "access hub", sealId: "88002", description: "Payments for clients", slug: "access", platform: "web", lockVersion: access.lockVersion + 1 });
      expect(portalHistory(db, access.id)[0]).toMatchObject({ event: "details_changed", detail: "Changed the SEAL ID, name and description", actor: "cy@example.com", attribution: "unverified" });
    });

    it("refuses a stale edit, and records nothing for an edit that changes nothing", () => {
      const access = onboardPortal(db, "Access");
      editPortalDetails(db, access.publicId, { ...portalInput("Access", { description: "First" }), lockVersion: access.lockVersion }, ana);
      expect(() => editPortalDetails(db, access.publicId, { ...portalInput("Access", { description: "Second" }), lockVersion: access.lockVersion }, cy)).toThrow(StaleRecordError);
      const current = getPortal(db, access.publicId);
      expect(editPortalDetails(db, access.publicId, { ...portalInput("Access", { description: "First" }), lockVersion: current.lockVersion }, ana).lockVersion).toBe(current.lockVersion);
      expect(portalHistory(db, access.id).map((event) => event.event)).toEqual(["details_changed", "created"]);
    });

    it("refuses a name another Portal has, and a missing owning team", () => {
      const access = onboardPortal(db, "Access");
      onboardPortal(db, "Markets");
      const error = refusal(() => editPortalDetails(db, access.publicId, { ...portalInput("markets"), ownerTeam: "", lockVersion: access.lockVersion }, ana));
      expect(error.messagesFor("name")).toEqual(["A Portal named Markets already exists"]);
      expect(error.messagesFor("ownerTeam")).toEqual(["Enter the team that owns the Portal"]);
    });
  });

  describe("lifecycle (portals spec)", () => {
    it("refuses promotion without a default route (No default route)", () => {
      const markets = onboardPortal(db, "Markets");
      expect(() => promotePortal(db, markets.publicId, { lockVersion: markets.lockVersion }, ana)).toThrow(/needs a default route/);
      expect(getPortal(db, markets.publicId).lifecycle).toBe("prototype");
    });

    it("promotes a Portal with a default route, and returns it to Prototype, each attributed Unverified (Promoting)", () => {
      const access = withDefault(onboardPortal(db, "Access"));
      const promoted = promotePortal(db, access.publicId, { lockVersion: access.lockVersion }, statedActor("Dana"));
      expect(promoted.lifecycle).toBe("production");
      expect(() => promotePortal(db, access.publicId, { lockVersion: promoted.lockVersion }, ana)).toThrow(TransitionError);
      const returned = returnToPrototype(db, access.publicId, { lockVersion: promoted.lockVersion }, statedActor(UNSTATED_ACTOR));
      expect(returned.lifecycle).toBe("prototype");
      expect(portalHistory(db, access.id).slice(0, 2)).toMatchObject([
        { event: "returned_to_prototype", fromLifecycle: "production", toLifecycle: "prototype", actor: "Not stated", attribution: "unverified" },
        { event: "promoted", fromLifecycle: "prototype", toLifecycle: "production", actor: "Dana", attribution: "unverified" },
      ]);
    });

    it("refuses a promotion based on an older version", () => {
      const access = withDefault(onboardPortal(db, "Access"));
      expect(() => promotePortal(db, access.publicId, { lockVersion: access.lockVersion - 1 }, ana)).toThrow(StaleRecordError);
    });

    it("keeps a Production Portal in Production while its menu changes (Portal configuration changes after activation)", () => {
      const access = withDefault(onboardPortal(db, "Access"));
      const promoted = promotePortal(db, access.publicId, { lockVersion: access.lockVersion }, ana);
      const ledger = registerApplication(db, { name: "Ledger", portal: promoted });
      addItem(db, access.publicId, { lockVersion: getPortal(db, access.publicId).lockVersion, label: "Ledger", route: "/ledger", application: ledger.publicId, parent: null }, ana);
      expect(getPortal(db, access.publicId).lifecycle).toBe("production");
      expect(menuOf(db, access.id).map((entry) => entry.label)).toEqual(["Payees", "Ledger"]);
      expect(portalHistory(db, access.id)[0]).toMatchObject({ event: "menu_changed", detail: "Added Ledger at /ledger" });
    });
  });
});
