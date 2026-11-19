import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { BrandLink } from "@/components/shell/brand-link";
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

// operator-interface/page-patterns spec: the shell header holds navigation and
// global controls, never a page's title; preview mode is a focused page.
describe("shell header", () => {
  it("holds a back button in place of the sidebar controls on a focused page", () => {
    const tree = elements(ShellHeader({ back: BACK }));
    expect(tree[0]!.props["data-shell-header"]).toBe("focused");
    const back = tree.find((element) => element.type === ButtonLink)!;
    expect(back.props).toMatchObject({ href: "/templates/payments-workspace", label: "Back to Payments workspace", variant: "tertiary", size: "md", icon: "arrowLeft" });
    expect(back.props.children).toBeUndefined();
    expect(tree.some((element) => element.type === SidebarToggle)).toBe(false);
    expect(tree.some((element) => element.props["aria-label"] === "Open navigation")).toBe(false);
  });

  it("ends with Docs, which opens the docs, on every page (Docs from the app)", () => {
    for (const props of [{}, { back: BACK }]) {
      const docs = elements(ShellHeader(props)).filter((element) => element.type === ButtonLink).at(-1)!;
      expect(docs.props).toMatchObject({ href: "/docs", children: "Docs", variant: "tertiary" });
    }
  });

  it("is a header element, so the shell renders it as the page's banner landmark (Landmarks)", () => {
    expect(elements(ShellHeader({}))[0]!.type).toBe("header");
    expect(elements(ShellHeader({ back: BACK }))[0]!.type).toBe("header");
  });

  it("shows no page title and no heading (Title in the page)", () => {
    for (const props of [{}, { back: BACK }]) {
      expect(elements(ShellHeader(props)).some((element) => /^h[1-6]$/.test(String(element.type)))).toBe(false);
    }
  });

  it("holds Show sidebar, Open navigation, and the product name, which opens Home (Shell on a narrow viewport)", () => {
    const tree = elements(ShellHeader({}));
    expect(tree[0]!.props["data-shell-header"]).toBe("");
    expect(tree.filter((element) => element.type === ButtonLink).map((element) => element.props.href)).toEqual(["/docs"]);
    expect(tree.find((element) => element.type === SidebarToggle)!.props.to).toBe("shown");
    expect(tree.find((element) => element.props["aria-label"] === "Open navigation")!.props.popoverTarget).toBe("sidebar");
    const product = tree.find((element) => element.type === BrandLink)!;
    expect(product.props).toMatchObject({ href: "/", children: "Frontend Registry" });
  });
});
