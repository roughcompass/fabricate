import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FramePreview } from "@/components/experience/frame-preview";
import { catalogs } from "@/lib/experience/catalogs";
import { type Experience, defaultExperience } from "@/lib/experience/document";

/*
 * The experience editor's preview (add-portal-experience-editor task 2.5):
 * it renders the working experience: hidden slots are left out, header slots
 * keep their order, the banner shows the first active message, and a flyout
 * menu leaves the sidebar out.
 */

const fresh = (): Experience => defaultExperience({ label: "Access" }, [], catalogs().toolkits, catalogs().themes, 2026);
const render = (experience: Experience, overlays: "none" | "all" = "none") => renderToStaticMarkup(createElement(FramePreview, { experience, modules: catalogs().modules, device: "desktop", label: "Preview", overlays }));
const slotOrder = (html: string) => [...html.matchAll(/data-slot="([a-z-]+)"/g)].map((match) => match[1]);

describe("FramePreview", () => {
  it("draws the logo, the portal name, the menu column, and the footer copyright", () => {
    const html = render(fresh());
    expect(html).toContain('alt="J.P. Morgan"');
    expect(html).toContain("Access");
    expect(html).toContain('data-zone="sidebar"');
    expect(html).toContain("© 2026 JPMorgan Chase &amp; Co. All rights reserved.");
    // Toolkit slots aren't drawn until their toolkit is installed.
    expect(slotOrder(html)).not.toContain("global-search");
  });

  it("leaves hidden slots and zones out, and keeps the header's slot order", () => {
    const experience = fresh();
    experience.frame.header.slots.find((slot) => slot.id === "feedback")!.visible = false;
    experience.toolkits.installed.push("notifications");
    const slots = experience.frame.header.slots;
    const [actions, notifications] = [slots.findIndex((slot) => slot.id === "actions"), slots.findIndex((slot) => slot.id === "notifications")];
    [slots[actions], slots[notifications]] = [slots[notifications]!, slots[actions]!];
    experience.frame.footer.visible = false;
    const html = render(experience);
    expect(slotOrder(html).filter((slot) => ["toggle", "brand", "notifications", "actions", "feedback", "user-menu"].includes(slot!))).toEqual(["toggle", "brand", "notifications", "actions", "user-menu"]);
    expect(html).not.toContain('data-zone="footer"');
  });

  it("shows the first active message in the banner, and none when no message is live", () => {
    const experience = fresh();
    expect(render(experience)).not.toContain('data-zone="banner"');
    experience.messages = [
      { id: "later", title: "Later", description: "", severity: "info", dismissible: true, enabled: true, startsAt: "2999-01-01T00:00", endsAt: null },
      { id: "now", title: "Scheduled maintenance", description: "Sunday 2–6 AM", severity: "warning", dismissible: true, enabled: true, startsAt: null, endsAt: null },
    ];
    const html = render(experience);
    expect(html).toContain('data-zone="banner"');
    expect(html).toContain('data-severity="warning"');
    expect(html).toContain("Scheduled maintenance");
    expect(html).not.toContain(">Later<");
  });

  it("leaves the sidebar out for a flyout menu, and draws the overlays only when asked", () => {
    const experience = fresh();
    experience.frame.sidebar.menuType = "flyout";
    expect(render(experience)).not.toContain('data-zone="sidebar"');
    expect(render(experience)).not.toContain("Session Expiring");
    expect(render(experience, "all")).toContain("Session Expiring");
  });
});
