import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNav } from "@/components/shell/sidebar-nav";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => route.pathname }));

// operator-interface/page-patterns spec: sidebar navigation drills into each
// section, and Home leads the section menu.

afterEach(() => {
  route.pathname = "/";
});

/** The section menu's entries, in order: each one's label, whether it's current, and whether it has a chevron. */
function sectionMenu(pathname: string, demo: boolean) {
  route.pathname = pathname;
  const html = renderToStaticMarkup(createElement(SidebarNav, { demo }));
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
      { label: "Assessments", current: null, chevron: true },
      { label: "Web Onboarding", current: null, chevron: true },
    ]);
  });

  it("lists Home first with the demo enabled, and marks the page's section rather than Home elsewhere", () => {
    expect(sectionMenu("/repositories", true).map((entry) => [entry.label, entry.current])).toEqual([
      ["Home", null],
      ["Assessments", "true"],
      ["Web Onboarding", null],
      ["Applications", null],
      ["Salt Patterns", null],
    ]);
  });

  it("links Home to the root address with its icon", () => {
    route.pathname = "/";
    const html = renderToStaticMarkup(createElement(SidebarNav, { demo: false }));
    const home = /<a [^>]*data-item="home"[^>]*>.*?<\/a>/.exec(html)![0];
    expect(home).toContain('href="/"');
    expect(home).toContain('<path d="M3 11 12 4l9 7');
  });
});
