import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { defaultRuntimeExperience, portalExperience, runtimeExperience } from "@/lib/demo/runtime-experience";
import { catalogs } from "@/lib/experience/catalogs";
import { defaultExperience } from "@/lib/experience/document";
import { currentExperience, saveExperience } from "@/lib/experience/versions";
import { getPortal } from "@/lib/onboarding/portals";
import { createTestDb } from "../support/db";
import { ana, onboardPortal } from "../support/onboarding";

/*
 * The experience a running application renders (add-portal-experience-editor
 * task 6.2): a Portal's current saved experience, the brand's default for no
 * Portal or one that isn't onboarded, and never the editor's pending changes,
 * which are only ever in the browser.
 */

const NOW = new Date("2026-10-19T12:00:00Z");

describe("the runtime experience", () => {
  let db: Db;
  let access: ReturnType<typeof onboardPortal>;
  beforeEach(() => {
    db = createTestDb();
    access = onboardPortal(db, "Access");
  });

  const saved = () => currentExperience(db, getPortal(db, access.publicId), catalogs());
  const save = (change: (document: ReturnType<typeof saved>["experience"]) => void) => {
    const { experience, number } = saved();
    change(experience);
    saveExperience(db, access.publicId, { baseNumber: number, lockVersion: getPortal(db, access.publicId).lockVersion, document: experience }, ana, catalogs());
  };

  it("is the Portal's saved experience: its name, banner, hidden footer, and favicon", () => {
    save((document) => {
      document.brand.portalName = "Digital Platform";
      document.frame.footer.visible = false;
      document.messages.push({ id: "msg_maint", title: "Scheduled maintenance", description: "Saturday 02:00 to 04:00.", severity: "warning", dismissible: true, enabled: true, startsAt: null, endsAt: null });
    });
    const runtime = runtimeExperience(db, "payments", access.publicId, catalogs(), NOW);
    expect(runtime).toMatchObject({ portalId: access.publicId, shell: "access", favicon: expect.stringMatching(/^data:image\//) });
    expect(runtime.experience).toMatchObject({
      portalName: "Digital Platform",
      logo: { alt: "J.P. Morgan" },
      banner: { title: "Scheduled maintenance", severity: "warning", dismissible: true },
      footer: { shown: false },
    });
  });

  it("takes the header's installed toolkit slots in order, and the shell from the theme", () => {
    save((document) => {
      document.toolkits.installed.push("global-search", "notifications");
      document.theme.id = "markets";
      document.frame.header.slots.reverse();
    });
    const runtime = runtimeExperience(db, "payments", access.publicId, catalogs(), NOW);
    expect(runtime.shell).toBe("markets");
    expect(runtime.experience.headerSlots).toEqual(["user-menu", "feedback", "notifications", "actions", "global-search", "brand", "toggle"]);
    expect(runtime.experience.search).toEqual({ placeholder: "Search", shortcut: "/" });
    expect(runtime.experience.notifications).toEqual({ title: "Notifications", showUnread: true });
  });

  it("has no favicon when the Portal turns it off", () => {
    save((document) => void (document.favicon.enabled = false));
    expect(runtimeExperience(db, "payments", access.publicId, catalogs(), NOW).favicon).toBeNull();
  });

  it("is the brand's default for no Portal, an unknown one, or a malformed id", () => {
    for (const portalId of [null, "ptl_0000000000000000", "not-a-portal"]) {
      const runtime = runtimeExperience(db, "markets", portalId, catalogs(), NOW);
      expect(runtime).toMatchObject({ portalId: null, shell: "markets", favicon: expect.stringMatching(/^data:image\//), experience: { portalName: "Markets", banner: null, sidebar: { menuType: "flyout" }, menu: [] } });
    }
    expect(defaultRuntimeExperience("payments", catalogs(), NOW).experience).toMatchObject({ portalName: "Access", sidebar: { menuType: "left" } });
  });

  it("leaves Search and Notifications out of the default header, since their toolkits aren't installed", () => {
    expect(defaultRuntimeExperience("payments", catalogs(), NOW).experience.headerSlots).toEqual(["toggle", "brand", "actions", "feedback", "user-menu"]);
  });

  it("is the default until the first save, so nothing pending is read", () => {
    expect(runtimeExperience(db, "payments", access.publicId, catalogs(), NOW).experience.portalName).toBe("Access");
    expect(runtimeExperience(db, "payments", access.publicId, catalogs(), NOW).experience.footer.shown).toBe(true);
  });

  it("shows only an active message, with the banner zone's overrides", () => {
    const document = defaultExperience({ label: "Access" }, [], catalogs().toolkits, catalogs().themes, 2026);
    document.messages.push(
      { id: "msg_later", title: "Later", description: "", severity: "info", dismissible: true, enabled: true, startsAt: "2026-10-20T00:00", endsAt: null },
      { id: "msg_now", title: "Now", description: "", severity: "info", dismissible: true, enabled: true, startsAt: null, endsAt: null },
    );
    document.frame.banner.status = "error";
    document.frame.banner.dismiss = "never";
    expect(portalExperience(document, NOW).banner).toEqual({ title: "Now", description: "", severity: "error", dismissible: false });
    document.frame.banner.visible = false;
    expect(portalExperience(document, NOW).banner).toBeNull();
  });
});
