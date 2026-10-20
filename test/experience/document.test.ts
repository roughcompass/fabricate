import { describe, expect, it } from "vitest";
import { catalogs } from "@/lib/experience/catalogs";
import { type Experience, activeMessage, bannerPresentation, defaultExperience, dialogCopyOf, landingUrl, messageState, parseExperience, slotShown, validateExperience } from "@/lib/experience/document";

/*
 * The experience document (add-portal-experience-editor task 1.2): the
 * default is valid, and each rule a person can break is reported at its
 * field with the view or section that shows it.
 */

const context = { catalogs: catalogs(), applications: [{ publicId: "wap_payeehub" }, { publicId: "wap_activity" }] };
const fresh = (): Experience => defaultExperience({ label: "Access" }, [], catalogs().toolkits, catalogs().themes, 2026);
const issuesAt = (experience: Experience) => validateExperience(experience, context).map((issue) => [issue.path, issue.view, issue.section ?? null]);

describe("the default experience", () => {
  it("is valid, names the portal, installs the default toolkits, and parses back", () => {
    const experience = fresh();
    expect(validateExperience(experience, context)).toEqual([]);
    expect(experience.brand.portalName).toBe("Access");
    expect(experience.copyright).toBe("© 2026 JPMorgan Chase & Co. All rights reserved.");
    expect(experience.toolkits.installed).toEqual(["system-messages", "menu-management", "session-management"]);
    expect(experience.frame.header.slots.map((slot) => slot.id)).toEqual(["toggle", "brand", "global-search", "actions", "notifications", "feedback", "user-menu"]);
    expect(parseExperience(JSON.parse(JSON.stringify(experience)))).toEqual(experience);
    expect(parseExperience({ ...experience, extra: true })).toBeNull();
  });

  it("hides toolkit slots until their toolkit is installed", () => {
    const experience = fresh();
    expect(slotShown(experience, "header", "global-search")).toBe(false);
    experience.toolkits.installed.push("global-search");
    expect(slotShown(experience, "header", "global-search")).toBe(true);
    experience.frame.header.visible = false;
    expect(slotShown(experience, "header", "brand")).toBe(false);
  });
});

describe("validation", () => {
  it("refuses a remote favicon, an empty logout redirect, and a malformed integrity", () => {
    const experience = fresh();
    experience.favicon.dataUrl = "https://example.com/icon.png";
    experience.session.logoutRedirect = { enabled: true, url: "" };
    experience.runtimeModules.push({ name: "@deweb/analytics", version: "latest", attributes: { type: "module", async: true, defer: false, integrity: "abc", crossorigin: "", referrerpolicy: "", fetchpriority: "auto" } });
    expect(issuesAt(experience)).toEqual([
      ["favicon.dataUrl", "configuration", "favicon"],
      ["session.logoutRedirect.url", "configuration", "session"],
      ["runtimeModules.0.attributes.integrity", "configuration", "runtime-modules"],
    ]);
  });

  it("refuses an external module range no published version matches, and resolves one that does", () => {
    const experience = fresh();
    experience.frame.banner.external = { module: "@deweb/alert-strip", range: "^9.0.0" };
    expect(issuesAt(experience)).toEqual([["frame.banner.external.range", "frame-zones", null]]);
    experience.frame.banner.external.range = "^2.0.0";
    expect(issuesAt(experience)).toEqual([]);
  });

  it("refuses menu route collisions, items outside the Portal, and nesting deeper than five", () => {
    const experience = fresh();
    const group = (id: string, parentId: string | null) => ({ id, parentId, kind: "group" as const, label: id, route: null, application: null, isDefault: false });
    experience.menu = [
      { id: "a", parentId: null, kind: "item", label: "Payees", route: "/payees", application: "wap_payeehub", isDefault: true },
      { id: "b", parentId: null, kind: "item", label: "Again", route: "/payees", application: "wap_elsewhere", isDefault: false },
      group("g1", null), group("g2", "g1"), group("g3", "g2"), group("g4", "g3"), group("g5", "g4"), group("g6", "g5"),
    ];
    const issues = validateExperience(experience, context);
    expect(issues.find((issue) => issue.path === "menu.1.route")?.message).toBe("/payees is already used by Payees");
    expect(issues.find((issue) => issue.path === "menu.1.application")).toBeDefined();
    expect(issues.find((issue) => issue.path === "menu.7.parentId")?.message).toBe("Menus nest at most 5 levels deep");
  });

  it("refuses a global search shortcut another shortcut uses, once Global Search is installed", () => {
    const experience = fresh();
    experience.toolkits.globalSearch.shortcut = "S";
    expect(issuesAt(experience)).toEqual([]);
    experience.toolkits.installed.push("global-search");
    expect(issuesAt(experience)).toEqual([["toolkits.globalSearch.shortcut", "capabilities", null]]);
  });

  it("refuses a message that ends before it starts, and a toast dismissed too soon", () => {
    const experience = fresh();
    experience.messages.push({ id: "msg_1", title: "Maintenance", description: "", severity: "warning", dismissible: true, enabled: true, startsAt: "2026-06-14T06:00", endsAt: "2026-06-14T02:00" });
    experience.overlays.successToast.seconds = 1;
    expect(issuesAt(experience)).toEqual([
      ["messages.0.endsAt", "messages", null],
      ["overlays.successToast.seconds", "frame-overlays", null],
    ]);
  });
});

describe("reading the document", () => {
  it("computes message states and the banner's message with the zone's overrides", () => {
    const experience = fresh();
    const now = new Date("2026-06-01T12:00:00");
    experience.messages = [
      { id: "later", title: "Later", description: "", severity: "info", dismissible: true, enabled: true, startsAt: "2026-06-02T00:00", endsAt: null },
      { id: "now", title: "Now", description: "", severity: "warning", dismissible: false, enabled: true, startsAt: null, endsAt: null },
      { id: "off", title: "Off", description: "", severity: "error", dismissible: true, enabled: false, startsAt: null, endsAt: null },
    ];
    expect(experience.messages.map((message) => messageState(message, now))).toEqual(["scheduled", "active", "disabled"]);
    expect(activeMessage(experience, now)?.id).toBe("now");
    experience.frame.banner.status = "error";
    experience.frame.banner.dismiss = "always";
    expect(bannerPresentation(experience, activeMessage(experience, now)!)).toEqual({ severity: "error", dismissible: true });
  });

  it("shows custom dialog copy only when turned on, and previews hash and history landing URLs", () => {
    const experience = fresh();
    experience.sessionLanguage.inactivity.title = "Still there?";
    expect(dialogCopyOf(experience, "inactivity").title).toBe("Session Expiring");
    experience.sessionLanguage.inactivity.custom = true;
    expect(dialogCopyOf(experience, "inactivity").title).toBe("Still there?");
    expect(landingUrl({ basePath: "/access", basePathLocked: false, landingPath: "/dashboard", mode: "hash" })).toBe("https://portal.example.com/access/#/dashboard");
    expect(landingUrl({ basePath: "/", basePathLocked: false, landingPath: "/dashboard", mode: "history" })).toBe("https://portal.example.com/dashboard");
  });
});
