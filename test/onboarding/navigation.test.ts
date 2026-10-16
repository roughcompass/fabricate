import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { addGroup, addItem, menuOf, moveEntry, removeEntry, renameEntry, setDefault, unplacedApplications } from "@/lib/onboarding/navigation";
import { type Portal, defaultItemOf, getPortal, portalHistory } from "@/lib/onboarding/portals";
import { registerApplication } from "../support/applications";
import { createTestDb, rawRun } from "../support/db";
import { ana, cy, onboardPortal } from "../support/onboarding";

/*
 * A Portal's menu (navigation spec; make-applications-first-class task 2.3):
 * groups and items edited one change at a time, routes unique in the Portal,
 * items pointing only at the Portal's Applications, at most five levels, one
 * default, and every change checked against the version the operator saw.
 */

describe("Portal navigation", () => {
  let db: Db;
  let access: Portal;
  let payeeHub: ReturnType<typeof registerApplication>;
  let ledger: ReturnType<typeof registerApplication>;

  beforeEach(() => {
    db = createTestDb();
    access = onboardPortal(db, "Access");
    payeeHub = registerApplication(db, { name: "Payee Hub", portal: access });
    ledger = registerApplication(db, { name: "Ledger", portal: access });
  });

  const version = () => getPortal(db, access.publicId).lockVersion;
  const group = (label: string, parent: string | null = null) => addGroup(db, access.publicId, { lockVersion: version(), label, parent }, ana);
  const item = (label: string, route: string, application = payeeHub.publicId, parent: string | null = null) => addItem(db, access.publicId, { lockVersion: version(), label, route, application, parent }, ana);
  const labels = () => menuOf(db, access.id).map((entry) => `${"  ".repeat(entry.depth - 1)}${entry.label}`);
  const refusal = (work: () => unknown) => {
    try {
      work();
    } catch (error) {
      if (error instanceof ValidationError) return error;
      throw error;
    }
    throw new Error("the change was accepted");
  };

  it("adds groups and items, nested and in order, each change taking effect at once (Adding an item)", () => {
    const payments = group("Payments");
    item("Payees", "/payees", payeeHub.publicId, payments.publicId);
    item("Activity", "/activity", ledger.publicId);
    expect(labels()).toEqual(["Payments", "  Payees", "Activity"]);
    expect(menuOf(db, access.id)[1]).toMatchObject({ kind: "item", route: "/payees", application: { publicId: payeeHub.publicId, name: "Payee Hub" }, parentPublicId: payments.publicId, depth: 2 });
    expect(portalHistory(db, access.id).map((event) => event.detail)).toEqual(["Added Activity at /activity", "Added Payees at /payees in Payments", "Added the group Payments", null]);
  });

  it("refuses a route another item has, naming that item, and leaves the menu unchanged (Route collision)", () => {
    item("Payees", "/payees");
    const before = version();
    expect(refusal(() => item("Payee list", "/payees", ledger.publicId)).messagesFor("route")).toEqual(["/payees is already used by Payees"]);
    expect(labels()).toEqual(["Payees"]);
    expect(version()).toBe(before);
  });

  it.each(["payees", "/Payees", "/payees/", "/pay ees", "/pay//ees", "/payées"])("refuses the route %j", (route) => {
    expect(refusal(() => item("Payees", route)).messagesFor("route")).toEqual(["Enter a route that starts with / and uses only lowercase letters, digits, hyphens, and slashes"]);
  });

  it("lets one Application back more than one item", () => {
    item("Payees", "/payees");
    item("Payee search", "/payees/search");
    expect(menuOf(db, access.id).map((entry) => entry.application?.name)).toEqual(["Payee Hub", "Payee Hub"]);
  });

  it("refuses a sixth nesting level", () => {
    let parent: string | null = null;
    for (const level of [1, 2, 3, 4]) parent = group(`Level ${level}`, parent).publicId;
    item("Deepest", "/deepest", payeeHub.publicId, parent);
    expect(refusal(() => group("Level 6", group("Level 5", parent).publicId)).messagesFor("parent")).toEqual(["Menus nest at most 5 levels deep"]);
    const level5 = menuOf(db, access.id).find((entry) => entry.label === "Level 5")!;
    expect(refusal(() => item("Too deep", "/too-deep", payeeHub.publicId, level5.publicId)).messagesFor("parent")).toEqual(["Menus nest at most 5 levels deep"]);
  });

  it("refuses an Application of another Portal, in the domain and by the trigger (Application from another Portal)", () => {
    const markets = onboardPortal(db, "Markets");
    const cards = registerApplication(db, { name: "Cards", portal: markets });
    expect(refusal(() => item("Cards", "/cards", cards.publicId)).messagesFor("application")).toEqual(["Choose an Application in Access"]);
    expect(() => rawRun(db, "insert into portal_menu_items (public_id, portal_id, kind, label, route, application_id, position) values ('mnu_raw', ?, 'item', 'Cards', '/cards', ?, 0)", access.id, cards.id)).toThrow(/Application of its own Portal/);
  });

  it("makes one item the default, clearing the previous one (Changing the default)", () => {
    const payees = item("Payees", "/payees");
    const activity = item("Activity", "/activity", ledger.publicId);
    setDefault(db, access.publicId, { lockVersion: version(), entry: payees.publicId }, ana);
    setDefault(db, access.publicId, { lockVersion: version(), entry: activity.publicId }, cy);
    expect(menuOf(db, access.id).map((entry) => [entry.label, entry.isDefault])).toEqual([
      ["Payees", false],
      ["Activity", true],
    ]);
    expect(portalHistory(db, access.id)[0]).toMatchObject({ event: "default_changed", detail: "Made Activity the default route", actor: "cy@example.com", attribution: "unverified" });
    expect(() => setDefault(db, access.publicId, { lockVersion: version(), entry: activity.publicId }, ana)).toThrow(TransitionError);
  });

  it("leaves no default when the default item is removed", () => {
    const payees = item("Payees", "/payees");
    setDefault(db, access.publicId, { lockVersion: version(), entry: payees.publicId }, ana);
    removeEntry(db, access.publicId, { lockVersion: version(), entry: payees.publicId }, ana);
    expect(defaultItemOf(db, access.id)).toBeUndefined();
    expect(portalHistory(db, access.id)[0]).toMatchObject({ detail: "Removed Payees, the default route" });
  });

  it("refuses a change based on an older version, keeping the other person's edit (Two editors)", () => {
    const payees = item("Payees", "/payees");
    const seen = version();
    removeEntry(db, access.publicId, { lockVersion: seen, entry: payees.publicId }, cy);
    expect(() => renameEntry(db, access.publicId, { lockVersion: seen, entry: payees.publicId, label: "Payee list" }, ana)).toThrow(StaleRecordError);
    expect(labels()).toEqual([]);
  });

  it("renames, moves up and down, into a group, and back to the top level", () => {
    const payments = group("Payments");
    const payees = item("Payees", "/payees");
    const activity = item("Activity", "/activity", ledger.publicId);
    renameEntry(db, access.publicId, { lockVersion: version(), entry: payees.publicId, label: "Payee list" }, ana);
    moveEntry(db, access.publicId, { lockVersion: version(), entry: activity.publicId, move: { direction: "up" } }, ana);
    expect(labels()).toEqual(["Payments", "Activity", "Payee list"]);
    moveEntry(db, access.publicId, { lockVersion: version(), entry: payees.publicId, move: { into: payments.publicId } }, ana);
    expect(labels()).toEqual(["Payments", "  Payee list", "Activity"]);
    moveEntry(db, access.publicId, { lockVersion: version(), entry: payees.publicId, move: { into: null } }, ana);
    expect(labels()).toEqual(["Payments", "Activity", "Payee list"]);
    expect(() => moveEntry(db, access.publicId, { lockVersion: version(), entry: payments.publicId, move: { direction: "up" } }, ana)).toThrow(/already first/);
    expect(portalHistory(db, access.id).slice(0, 4).map((event) => event.detail)).toEqual(["Moved Payee list to the top level", "Moved Payee list into Payments", "Moved Activity up", "Renamed Payees to Payee list"]);
  });

  it("keeps a group out of itself and what it holds, and refuses to remove one that isn't empty", () => {
    const payments = group("Payments");
    const inner = group("Domestic", payments.publicId);
    expect(refusal(() => moveEntry(db, access.publicId, { lockVersion: version(), entry: payments.publicId, move: { into: inner.publicId } }, ana)).messagesFor("parent")).toEqual(["Payments can't go inside a group it holds"]);
    expect(() => removeEntry(db, access.publicId, { lockVersion: version(), entry: payments.publicId }, ana)).toThrow(/isn't empty/);
  });

  it("lists the Portal's Applications that no item points at (Unplaced application)", () => {
    item("Payees", "/payees");
    expect(unplacedApplications(db, access.id).map((application) => application.name)).toEqual(["Ledger"]);
  });
});
