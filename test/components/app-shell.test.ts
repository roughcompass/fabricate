import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/shell/app-shell";
import { NO_OPTIONAL_AREAS, type NavFlags, visibleGroups } from "@/components/shell/navigation";
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
  it("shows Home, the Assessments group, and Admin when the demo is disabled (Demo disabled)", () => {
    const nav = elements(AppShell({ theme: "system", children: null })).find((element) => element.type === SidebarNav)!;
    const flags = nav.props.nav as NavFlags;
    expect(visibleGroups(flags).flatMap((group) => group.items).map((entry) => entry.label)).toEqual(["Home", "Repositories", "All Assessments", "Standards", "Bitbucket tokens"]);
  });

  it("adds Salt Patterns in its own group when the demo is enabled, opening its list", () => {
    const nav = elements(AppShell({ theme: "system", nav: { ...NO_OPTIONAL_AREAS, demo: true }, children: null })).find((element) => element.type === SidebarNav)!;
    const groups = visibleGroups(nav.props.nav as NavFlags);
    expect(groups.map((group) => [group.heading ?? null, group.items[0]!.href])).toEqual([
      [null, "/"],
      ["Assessments", "/repositories"],
      ["Templates", "/templates"],
      ["Admin", "/admin/bitbucket-tokens"],
    ]);
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

  it("keeps the theme control in the sidebar", () => {
    const sidebar = elements(AppShell({ theme: "light", children: null })).find((element) => element.props.id === "sidebar")!;
    const switcher = elements(sidebar).find((element) => element.type === ThemeSwitcher)!;
    expect(switcher.props.current).toBe("light");
  });
});
