import { describe, expect, it } from "vitest";
import { catalogs } from "@/lib/experience/catalogs";
import { type Experience, defaultExperience } from "@/lib/experience/document";
import { diffExperience, revertChange } from "@/lib/experience/fields";

/*
 * Pending changes (add-portal-experience-editor task 1.3): one row per
 * changed field with its location, field, original and new values, Default
 * marked; entries diff by id; each row reverts on its own.
 */

const fresh = (): Experience =>
  defaultExperience({ label: "Access" }, [
    { id: "mnu_a", parentId: null, kind: "item", label: "Payees", route: "/payees", application: "wap_a", isDefault: true },
    { id: "mnu_b", parentId: null, kind: "item", label: "Activity", route: "/activity", application: "wap_b", isDefault: false },
  ], catalogs().toolkits, catalogs().themes, 2026);
const clone = (experience: Experience): Experience => structuredClone(experience);

describe("diffExperience", () => {
  it("lists nothing for identical documents", () => {
    expect(diffExperience(fresh(), fresh())).toEqual([]);
  });

  it("gives one row per changed scalar, marking a built-in original as Default", () => {
    const saved = fresh();
    const present = clone(saved);
    present.session.logoutRedirect.enabled = true;
    present.copyright = "© JPMorgan";
    const rows = diffExperience(saved, present, fresh());
    expect(rows.map((row) => [row.location, row.section, row.field, row.original, row.next, row.originalIsDefault])).toEqual([
      ["Portal Configuration", "Copyright Information", "Copyright information", "© 2026 JPMorgan Chase & Co. All rights reserved.", "© JPMorgan", true],
      ["Portal Configuration", "Session Policy", "Logout redirect enabled", "Off", "On", true],
    ]);
  });

  it("gives one row per slot field, one for slot order, one per menu entry, and one for a moved entry", () => {
    const saved = fresh();
    const present = clone(saved);
    present.frame.header.slots.find((slot) => slot.id === "feedback")!.visible = false;
    const [a, b] = [present.frame.header.slots[3]!, present.frame.header.slots[4]!];
    present.frame.header.slots[3] = b;
    present.frame.header.slots[4] = a;
    present.menu = [present.menu[1]!, present.menu[0]!];
    present.toolkits.installed.push("notifications");
    const rows = diffExperience(saved, present).map((row) => `${row.section} / ${row.field}`);
    expect(rows).toEqual(["Header Zone → Feedback Slot / Visible", "Header Zone / Slot order", "Sidebar Zone → Main Slot / Menu entry", "Notifications / Installed"]);
  });
});

describe("revertChange", () => {
  it("reverts exactly one row, leaving the others pending", () => {
    const saved = fresh();
    const present = clone(saved);
    present.session.logoutRedirect.enabled = true;
    present.copyright = "© JPMorgan";
    const reverted = revertChange(saved, present, "scalar:session.logoutRedirect.enabled");
    expect(diffExperience(saved, reverted).map((row) => row.field)).toEqual(["Copyright information"]);
  });

  it("drops an added entry with what was added inside it, restores a removed one in place, and restores order", () => {
    const saved = fresh();
    const present = clone(saved);
    present.menu.push({ id: "tmp_g", parentId: null, kind: "group", label: "Payments", route: null, application: null, isDefault: false });
    present.menu.push({ id: "tmp_c", parentId: "tmp_g", kind: "item", label: "Cards", route: "/cards", application: "wap_a", isDefault: false });
    expect(revertChange(saved, present, "entry:menu:tmp_g").menu).toEqual(saved.menu);

    const removed = clone(saved);
    removed.menu = removed.menu.filter((node) => node.id !== "mnu_a");
    expect(revertChange(saved, removed, "entry:menu:mnu_a").menu).toEqual(saved.menu);

    const moved = clone(saved);
    moved.menu.reverse();
    expect(revertChange(saved, moved, "order:menu").menu).toEqual(saved.menu);

    const slots = clone(saved);
    slots.frame.footer.slots.reverse();
    expect(revertChange(saved, slots, "order:frame.footer.slots").frame.footer.slots).toEqual(saved.frame.footer.slots);
  });

  it("reverts a toolkit install and a slot field", () => {
    const saved = fresh();
    const present = clone(saved);
    present.toolkits.installed.push("global-search");
    present.frame.footer.slots[0]!.visible = false;
    const once = revertChange(saved, present, "toolkit:global-search");
    expect(once.toolkits.installed).toEqual(saved.toolkits.installed);
    expect(revertChange(saved, once, "slot:footer:primary:visible")).toEqual(saved);
  });
});
