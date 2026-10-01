import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ShellHeader } from "@/components/shell/shell-header";
import { SidebarToggle } from "@/components/shell/sidebar-toggle";
import { ButtonLink } from "@/components/ui/button";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

/** Every element the header renders, without rendering client components. */
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

const BACK = { href: "/templates/payments-workspace", label: "Back to Payments workspace" };

// operator-interface/page-patterns spec: preview mode is a focused page.
describe("shell header", () => {
  it("holds a back button in place of the sidebar controls on a focused page", () => {
    const tree = elements(ShellHeader({ title: "Preview Payments workspace", back: BACK }));
    expect(tree[0]!.props["data-shell-header"]).toBe("focused");
    const back = tree.find((element) => element.type === ButtonLink)!;
    expect(back.props).toMatchObject({ href: "/templates/payments-workspace", label: "Back to Payments workspace", variant: "tertiary", size: "md", icon: "arrowLeft" });
    expect(back.props.children).toBeUndefined();
    expect(tree.some((element) => element.type === SidebarToggle)).toBe(false);
    expect(tree.some((element) => element.props["aria-label"] === "Open navigation")).toBe(false);
  });

  it("keeps the title as the one top-level heading, for assistive technology only", () => {
    const headings = elements(ShellHeader({ title: "Preview Payments workspace", back: BACK })).filter((element) => element.type === "h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]!.props.className).toBe("visually-hidden");
    expect(headings[0]!.props.children).toBe("Preview Payments workspace");
  });

  it("renders as before without a back button", () => {
    const tree = elements(ShellHeader({ title: "Payments workspace" }));
    expect(tree[0]!.props["data-shell-header"]).toBe("");
    expect(tree.some((element) => element.type === ButtonLink)).toBe(false);
    expect(tree.find((element) => element.type === SidebarToggle)!.props.to).toBe("shown");
    expect(tree.find((element) => element.props["aria-label"] === "Open navigation")!.props.popoverTarget).toBe("sidebar");
    const heading = tree.find((element) => element.type === "h1")!;
    expect(heading.props.className).not.toBe("visually-hidden");
    expect(heading.props.title).toBe("Payments workspace");
  });

  it("marks a focused skeleton's header, with a placeholder for the back button", () => {
    const tree = elements(ShellHeader({ back: "placeholder" }));
    expect(tree[0]!.props["data-shell-header"]).toBe("focused");
    expect(tree.some((element) => element.type === ButtonLink || element.type === SidebarToggle || element.type === "h1")).toBe(false);
  });
});
