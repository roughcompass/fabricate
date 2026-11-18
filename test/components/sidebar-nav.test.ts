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

function render(pathname: string, flags: { demo?: boolean } = {}) {
  route.pathname = pathname;
  return renderToStaticMarkup(createElement(SidebarNav, { nav: { demo: flags.demo ?? false } }));
}

/** The primary menu's entries, in order: each one's label and whether it's current. */
function primaryMenu(pathname: string, flags: { demo?: boolean } = {}) {
  return [...render(pathname, flags).matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map(([, attributes, content]) => ({
    label: /<span[^>]*>([^<]*)<\/span>/.exec(content!)![1],
    current: /aria-current="(page|true)"/.exec(attributes!)?.[1] ?? null,
  }));
}

describe("primary menu", () => {
  it("leads with Home, marked current on Home (Home current)", () => {
    expect(primaryMenu("/")).toEqual([
      { label: "Home", current: "page" },
      { label: "Repositories", current: null },
      { label: "All Assessments", current: null },
      { label: "Standards", current: null },
      { label: "Bitbucket tokens", current: null },
    ]);
  });

  it("sets the groups apart with dividers and names each group's list by its heading (Full menu)", () => {
    const html = render("/", { demo: true });
    expect(html.match(/<hr/g)).toHaveLength(3);
    expect(html).toContain('<p id="sidebar-group-assessments"');
    expect(html).toContain('aria-labelledby="sidebar-group-assessments"');
    expect(html).toContain(">Templates</p>");
    expect(html.indexOf(">Templates</p>")).toBeLessThan(html.indexOf(">Salt Patterns<"));
  });

  it("marks a list page's item current on its create page (Repositories)", () => {
    expect(primaryMenu("/repositories/new").filter((entry) => entry.current)).toEqual([{ label: "Repositories", current: "true" }]);
  });

  it.each([
    ["/repositories", "Repositories", "page"],
    ["/templates/payments-workspace", "Salt Patterns", "true"],
  ])("marks %s's item current", (pathname, label, current) => {
    expect(primaryMenu(pathname, { demo: true }).filter((entry) => entry.current)).toEqual([{ label, current }]);
  });

  it("links Home to the root address with its icon", () => {
    const html = render("/");
    const home = /<a [^>]*data-item="home"[^>]*>.*?<\/a>/.exec(html)![0];
    expect(home).toContain('href="/"');
    expect(home).toContain('<path d="M3 11 12 4l9 7');
  });
});
