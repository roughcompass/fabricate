import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/shell/app-shell";
import { visibleSections } from "@/components/shell/navigation";
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
  it("shows Assessments and Web Onboarding when the demo is disabled (Demo disabled)", () => {
    const nav = elements(AppShell({ theme: "system", children: null })).find((element) => element.type === SidebarNav)!;
    expect(visibleSections(nav.props.demo as boolean).map((section) => section.label)).toEqual(["Assessments", "Web Onboarding"]);
  });

  it("adds Applications and Salt Patterns when the demo is enabled, each opening its list", () => {
    const nav = elements(AppShell({ theme: "system", demo: true, children: null })).find((element) => element.type === SidebarNav)!;
    const sections = visibleSections(nav.props.demo as boolean);
    expect(sections.map((section) => [section.label, section.items[0]!.href])).toEqual([
      ["Assessments", "/assessments"],
      ["Web Onboarding", "/onboarding/portals"],
      ["Applications", "/applications"],
      ["Salt Patterns", "/templates"],
    ]);
  });

  it("groups Repositories and Standards under Assessments, each group after the first with a heading", () => {
    const [assessments] = visibleSections(false);
    expect(assessments!.groups.map((group) => group.label)).toEqual([undefined, "Repositories", "Standards"]);
  });

  it("names the product DE FabLab and links its mark to the Assessments list", () => {
    const brand = elements(AppShell({ theme: "system", children: null })).find((element) => element.props["aria-label"] === "DE FabLab home")!;
    expect(brand.props.href).toBe("/assessments");
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
