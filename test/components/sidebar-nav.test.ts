import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNav } from "@/components/shell/sidebar-nav";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => route.pathname }));

// operator-interface/page-patterns spec: the primary menu groups areas under
// headings and dividers, and the current item is marked.

afterEach(() => {
  route.pathname = "/";
});

function render(pathname: string, flags: { demo?: boolean; prototypes?: boolean; hosted?: boolean } = {}) {
  route.pathname = pathname;
  return renderToStaticMarkup(createElement(SidebarNav, { nav: { demo: flags.demo ?? false, prototypes: flags.prototypes ?? false, hosted: flags.hosted ?? false } }));
}

/** The primary menu's entries, in order: each one's label and whether it's current. */
function primaryMenu(pathname: string, flags: { demo?: boolean; prototypes?: boolean; hosted?: boolean } = {}) {
  return [...render(pathname, flags).matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map(([, attributes, content]) => ({
    label: /<span[^>]*>([^<]*)<\/span>/.exec(content!)![1],
    current: /aria-current="(page|true)"/.exec(attributes!)?.[1] ?? null,
  }));
}

describe("primary menu", () => {
  it("leads with Home, marked current on Home (Home current)", () => {
    expect(primaryMenu("/")).toEqual([
      { label: "Home", current: "page" },
      { label: "All Assessments", current: null },
      { label: "Repositories", current: null },
      { label: "Standards", current: null },
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

  it("marks a list page's item current on its create page (Repositories)", () => {
    expect(primaryMenu("/repositories/new").filter((entry) => entry.current)).toEqual([{ label: "Repositories", current: "true" }]);
  });

  it.each([
    ["/repositories", "Repositories", "page"],
    ["/prototypes/personas/per_0123456789abcdef", "Personas", "true"],
  ])("marks %s's item current (Persona form)", (pathname, label, current) => {
    expect(primaryMenu(pathname, { prototypes: true }).filter((entry) => entry.current)).toEqual([{ label, current }]);
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
