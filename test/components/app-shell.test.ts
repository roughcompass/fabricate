import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/shell/app-shell";
import { NavLink } from "@/components/shell/nav-link";

type NavProps = { href: string; section?: string[]; children: ReactNode };

/** The primary navigation links the shell renders, without rendering client components. */
function navigation(node: ReactNode, found: NavProps[] = []): NavProps[] {
  if (Array.isArray(node)) {
    for (const child of node) navigation(child, found);
    return found;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return found;
  if (node.type === NavLink) found.push(node.props as unknown as NavProps);
  navigation(node.props.children, found);
  return found;
}

// The Templates section exists only while the template demo is enabled
// (operator-interface/page-patterns spec, application shell requirement).
describe("application shell navigation", () => {
  it("shows only Initiatives, Sources, and Standards when the demo is disabled", () => {
    const links = navigation(AppShell({ theme: "system", children: null }));
    expect(links.map((link) => link.children)).toEqual(["Initiatives", "Sources", "Standards"]);
  });

  it("adds Templates, opening the create page and covering the gallery and application pages, when the demo is enabled", () => {
    const links = navigation(AppShell({ theme: "system", demo: true, children: null }));
    expect(links.map((link) => link.children)).toEqual(["Initiatives", "Sources", "Standards", "Templates"]);
    expect(links.at(-1)).toMatchObject({ href: "/new", section: ["/templates", "/applications"] });
  });
});
