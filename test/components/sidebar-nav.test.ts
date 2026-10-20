import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNav } from "@/components/shell/sidebar-nav";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => route.pathname }));

// operator-interface/page-patterns spec: the primary menu groups areas under
// headings and dividers, Runtime Configuration alone drills into a sub-menu,
// and the current item is marked (update-portal-management-journey task 1.2).

afterEach(() => {
  route.pathname = "/";
});

const PORTAL = { publicId: "ptl_0123456789abcdef", label: "Access", slug: "access", sealId: null, platform: "web", lifecycle: "prototype" } as const;

function render(pathname: string, flags: { demo?: boolean; prototypes?: boolean; hosted?: boolean } = {}) {
  route.pathname = pathname;
  return renderToStaticMarkup(createElement(SidebarNav, { nav: { demo: flags.demo ?? false, prototypes: flags.prototypes ?? false, hosted: flags.hosted ?? false }, portals: [PORTAL] }));
}

/** The primary menu's entries, in order: each one's label, whether it's current, and whether it has a chevron. */
function primaryMenu(pathname: string, flags: { demo?: boolean; prototypes?: boolean; hosted?: boolean } = {}) {
  const html = render(pathname, flags);
  // The primary menu ends where the sub-menu, when there is one, begins with Show all sections.
  const end = html.indexOf('<a href="#sidebar-sections"');
  const menu = html.slice(html.indexOf('id="sidebar-sections"'), end > -1 ? end : undefined);
  return [...menu.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map(([, attributes, content]) => ({
    label: /<span[^>]*>([^<]*)<\/span>/.exec(content!)![1],
    current: /aria-current="(page|true)"/.exec(attributes!)?.[1] ?? null,
    chevron: (content!.match(/<svg/g) ?? []).length > 1,
  }));
}

describe("primary menu", () => {
  it("leads with Home, marked current on Home, and only Runtime Configuration has a sub-menu indicator (Home current)", () => {
    expect(primaryMenu("/")).toEqual([
      { label: "Home", current: "page", chevron: false },
      { label: "Applications", current: null, chevron: false },
      { label: "Runtime Configuration", current: null, chevron: true },
      { label: "All Assessments", current: null, chevron: false },
      { label: "Repositories", current: null, chevron: false },
      { label: "Standards", current: null, chevron: false },
    ]);
  });

  it("sets the groups apart with dividers and names each group's list by its heading (Full menu)", () => {
    const html = render("/", { demo: true, prototypes: true });
    expect(html.match(/<hr/g)).toHaveLength(2);
    expect(html).toContain('<p id="sidebar-group-assessments"');
    expect(html).toContain('aria-labelledby="sidebar-group-assessments"');
    expect(html).toContain(">Salt Patterns &amp; Prototypes</p>");
    expect(html.indexOf("Salt Patterns &amp; Prototypes")).toBeLessThan(html.indexOf(">Page shell<"));
  });

  it("keeps the primary menu on a list page, with its item marked current (Repositories)", () => {
    const html = render("/repositories/new");
    expect(html).toContain('data-view="menu"');
    expect(html).not.toContain("Show all sections");
    expect(primaryMenu("/repositories/new").filter((entry) => entry.current)).toEqual([{ label: "Repositories", current: "true", chevron: false }]);
  });

  it.each([
    ["/applications", "Applications", "page"],
    ["/applications/wap_0123456789abcdef", "Applications", "true"],
    ["/prototypes/personas/per_0123456789abcdef", "Personas", "true"],
  ])("marks %s's item current (Persona form)", (pathname, label, current) => {
    expect(primaryMenu(pathname, { prototypes: true }).filter((entry) => entry.current)).toEqual([{ label, current, chevron: false }]);
  });

  it("shows only Prototypes' pages in the hosted profile (Hosted profile)", () => {
    expect(primaryMenu("/prototypes", { demo: true, prototypes: true, hosted: true }).map((entry) => entry.label)).toEqual(["Prototypes", "Personas", "Lessons", "Page shell"]);
  });

  it("links Home to the root address with its icon", () => {
    const html = render("/");
    const home = /<a [^>]*data-item="home"[^>]*>.*?<\/a>/.exec(html)![0];
    expect(home).toContain('href="/"');
    expect(home).toContain('<path d="M3 11 12 4l9 7');
  });
});

describe("Runtime Configuration sub-menu", () => {
  it("shows the sub-menu on a Portal's page, headed Runtime Configuration with Show all sections, and the Portal's name (Items in order)", () => {
    const html = render(`/portals/${PORTAL.publicId}/configuration/favicon`);
    expect(html).toContain('data-view="submenu"');
    expect(html).toContain('aria-label="Show all sections"');
    expect(html).toContain('href="#sidebar-sections"');
    expect(html).toContain(">Runtime Configuration</p>");
    expect(html).toContain('title="Access">Access</p>');
    const favicon = /<a [^>]*data-item="favicon"[^>]*>/.exec(html)![0];
    expect(favicon).toContain('aria-current="page"');
    expect(favicon).toContain(`href="/portals/${PORTAL.publicId}/configuration/favicon"`);
  });

  it("marks Runtime Configuration current in the primary menu behind the sub-menu (Returning to the primary menu)", () => {
    expect(primaryMenu(`/portals/${PORTAL.publicId}`).filter((entry) => entry.current)).toEqual([{ label: "Runtime Configuration", current: "true", chevron: true }]);
  });

  it("lists only All Portals on the Portals page (All Portals current)", () => {
    const html = render("/portals");
    const submenu = html.slice(html.indexOf("sidebar-submenu-title"));
    expect([...submenu.matchAll(/data-item="([^"]+)"/g)].map((match) => match[1])).toEqual(["all-portals"]);
  });
});
