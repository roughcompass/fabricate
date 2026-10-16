import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/shell/app-shell";
import { NO_OPTIONAL_AREAS, type NavFlags, visibleSections, visibleTopLevel } from "@/components/shell/navigation";
import { ShellHeader } from "@/components/shell/shell-header";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { ThemeSwitcher } from "@/components/shell/theme-switcher";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

/** Every element the shell renders, without rendering client components. */
function elements(node: ReactNode, found: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
    return found;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return found;
  found.push(node as Element);
  elements(node.props.children, found);
  return found;
}

const shellOf = (tree: ReactNode) => elements(tree).find((element) => "data-sidebar" in element.props)!;

// operator-interface/page-patterns spec: the application shell, and the
// sidebar that can be resized and hidden.
describe("application shell", () => {
  it("shows Home, Applications, Navigation, and Assessments when the demo is disabled (Demo disabled)", () => {
    const nav = elements(AppShell({ theme: "system", children: null })).find((element) => element.type === SidebarNav)!;
    const flags = nav.props.nav as NavFlags;
    expect([...visibleTopLevel(flags), ...visibleSections(flags)].map((entry) => entry.label)).toEqual(["Home", "Applications", "Navigation", "Assessments"]);
  });

  it("adds Salt Patterns when the demo is enabled, opening its list", () => {
    const nav = elements(AppShell({ theme: "system", nav: { ...NO_OPTIONAL_AREAS, demo: true }, children: null })).find((element) => element.type === SidebarNav)!;
    const sections = visibleSections(nav.props.nav as NavFlags);
    expect(sections.map((section) => [section.label, section.items[0]!.href])).toEqual([
      ["Assessments", "/assessments"],
      ["Salt Patterns", "/templates"],
    ]);
  });

  it("groups Repositories and Standards under Assessments, each group after the first with a heading", () => {
    const [assessments] = visibleSections(NO_OPTIONAL_AREAS);
    expect(assessments!.groups.map((group) => group.label)).toEqual([undefined, "Repositories", "Standards"]);
  });

  it("names the product DE FabLab and links its mark to Home (Product mark opens Home)", () => {
    for (const demo of [false, true]) {
      const brand = elements(AppShell({ theme: "system", nav: { ...NO_OPTIONAL_AREAS, demo }, children: null })).find((element) => element.props["aria-label"] === "DE FabLab home")!;
      expect(brand.props.href).toBe("/");
    }
  });

  it("renders a shown, 256px sidebar by default", () => {
    const shell = shellOf(AppShell({ theme: "system", children: null }));
    expect(shell.props["data-sidebar"]).toBe("shown");
    expect(shell.props.style).toEqual({ "--_sidebar-width": "256px" });
  });

  it("renders the operator's stored width and hidden state", () => {
    const shell = shellOf(AppShell({ theme: "dark", sidebar: { width: 320, hidden: true }, children: null }));
    expect(shell.props["data-sidebar"]).toBe("hidden");
    expect(shell.props.style).toEqual({ "--_sidebar-width": "320px" });
  });

  it("holds a page's header start control after the sidebar controls and before the title, and none on a focused page", () => {
    const start = createElement("button", { id: "application-switcher" }, "Payee Hub");
    const html = renderToStaticMarkup(createElement(ShellHeader, { title: "Payee Hub", start }));
    expect(html.indexOf('aria-label="Open navigation"')).toBeGreaterThan(-1);
    expect(html.indexOf('aria-label="Open navigation"')).toBeLessThan(html.indexOf('id="application-switcher"'));
    expect(html.indexOf('id="application-switcher"')).toBeLessThan(html.indexOf("<h1"));
    const focused = renderToStaticMarkup(createElement(ShellHeader, { title: "Create Application", back: { href: "/applications", label: "Back to Applications" }, start }));
    expect(focused).not.toContain("application-switcher");
  });

  it("keeps the theme control in the sidebar", () => {
    const sidebar = elements(AppShell({ theme: "light", children: null })).find((element) => element.props.id === "sidebar")!;
    const switcher = elements(sidebar).find((element) => element.type === ThemeSwitcher)!;
    expect(switcher.props.current).toBe("light");
  });
});
