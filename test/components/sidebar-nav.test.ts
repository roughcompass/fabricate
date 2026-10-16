import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNav } from "@/components/shell/sidebar-nav";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => route.pathname }));

// operator-interface/page-patterns spec: sidebar navigation drills into each
// section, and Home, Applications, and Navigation lead the section menu with
// no sub-menu (make-applications-first-class task 5.1).

afterEach(() => {
  route.pathname = "/";
});

/** The section menu's entries, in order: each one's label, whether it's current, and whether it has a chevron. */
function sectionMenu(pathname: string, demo: boolean, flags: { prototypes?: boolean; hosted?: boolean } = {}) {
  route.pathname = pathname;
  const html = renderToStaticMarkup(createElement(SidebarNav, { nav: { demo, prototypes: flags.prototypes ?? false, hosted: flags.hosted ?? false } }));
  const menu = html.slice(html.indexOf('id="sidebar-sections"'), html.indexOf("</ul>"));
  return [...menu.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map(([, attributes, content]) => ({
    label: /<span[^>]*>([^<]*)<\/span>/.exec(content!)![1],
    current: /aria-current="(page|true)"/.exec(attributes!)?.[1] ?? null,
    chevron: (content!.match(/<svg/g) ?? []).length > 1,
  }));
}

describe("sidebar section menu", () => {
  it("leads with Home, marked current on Home and without a sub-menu indicator (Home in the section menu)", () => {
    expect(sectionMenu("/", false)).toEqual([
      { label: "Home", current: "page", chevron: false },
      { label: "Applications", current: null, chevron: false },
      { label: "Navigation", current: null, chevron: false },
      { label: "Assessments", current: null, chevron: true },
    ]);
  });

  it("lists Home first with the demo enabled, and marks the page's section rather than Home elsewhere", () => {
    expect(sectionMenu("/repositories", true).map((entry) => [entry.label, entry.current])).toEqual([
      ["Home", null],
      ["Applications", null],
      ["Navigation", null],
      ["Assessments", "true"],
      ["Salt Patterns", null],
    ]);
  });

  it.each([
    ["/applications", "Applications", "page"],
    ["/applications/wap_0123456789abcdef", "Applications", "true"],
    ["/navigation/ptl_0123456789abcdef", "Navigation", "true"],
    ["/navigation", "Navigation", "page"],
  ])("keeps the section menu on %s, with %s marked current and no sub-menu (Choosing Applications)", (pathname, label, current) => {
    route.pathname = pathname;
    const html = renderToStaticMarkup(createElement(SidebarNav, { nav: { demo: true, prototypes: true, hosted: false } }));
    expect(html).toContain('data-view="sections"');
    expect(html).not.toContain("Show all sections");
    expect(sectionMenu(pathname, true, { prototypes: true }).filter((entry) => entry.current)).toEqual([{ label, current, chevron: false }]);
  });

  it("shows only Prototypes in the hosted profile (Hosted profile)", () => {
    expect(sectionMenu("/prototypes", true, { prototypes: true, hosted: true }).map((entry) => entry.label)).toEqual(["Prototypes"]);
  });

  it("links Home to the root address with its icon", () => {
    route.pathname = "/";
    const html = renderToStaticMarkup(createElement(SidebarNav, { nav: { demo: false, prototypes: false, hosted: false } }));
    const home = /<a [^>]*data-item="home"[^>]*>.*?<\/a>/.exec(html)![0];
    expect(home).toContain('href="/"');
    expect(home).toContain('<path d="M3 11 12 4l9 7');
  });
});
