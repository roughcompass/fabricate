import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesignSystemPage from "@/app/(operator)/design-system/page";
import { FilterRail } from "@/components/ui/filter-rail";
import { MediaCard } from "@/components/ui/media-card";
import { SearchField } from "@/components/ui/search-field";
import { redirectOf } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

type Props = { children?: ReactNode; render?: (theme: "light" | "dark") => ReactNode; id?: string; single?: boolean };

/** Every element in a server-rendered tree, expanding each Specimen's per-theme render. */
function elements(node: ReactNode, theme: "light" | "dark" | null = null, found: { element: ReactElement<Record<string, unknown>>; theme: "light" | "dark" | null }[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, theme, found);
    return found;
  }
  if (!isValidElement<Props>(node)) return found;
  found.push({ element: node as ReactElement<Record<string, unknown>>, theme });
  const { children, render, single } = node.props;
  if (typeof render === "function") for (const variant of single ? (["light"] as const) : (["light", "dark"] as const)) elements(render(variant), variant, found);
  elements(children, theme, found);
  return found;
}

describe("component gallery", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("responds with the not-found page in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await redirectOf(DesignSystemPage({ searchParams: Promise.resolve({}) }))).toBe("not-found");
  });

  it("renders in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(DesignSystemPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
  });

  it("shows the search field, media card, and filter rail in their states", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const found = elements(await DesignSystemPage({ searchParams: Promise.resolve({ kind: ["policy"] }) }));
    const of = (type: unknown) => found.filter(({ element }) => element.type === type);

    const searches = of(SearchField);
    for (const theme of ["light", "dark"] as const) {
      const props = searches.filter((entry) => entry.theme === theme).map(({ element }) => element.props);
      expect(props.map((prop) => prop.size ?? "md").sort()).toEqual(["lg", "md", "md", "sm"]);
      expect(props.some((prop) => prop.disabled)).toBe(true);
      expect(props.some((prop) => prop.clearHref && prop.defaultValue)).toBe(true);
    }

    const cards = of(MediaCard);
    for (const theme of ["light", "dark"] as const) {
      const props = cards.filter((entry) => entry.theme === theme).map(({ element }) => element.props);
      expect(props.some((prop) => prop.href && prop.footer)).toBe(true);
      expect(props.some((prop) => !prop.href)).toBe(true);
    }

    const [rail] = of(FilterRail).map(({ element }) => element.props);
    expect(rail).toMatchObject({ selected: { kind: ["policy"] }, activeCount: 1, filtered: true });
    expect((rail!.groups as { options: { disabled?: boolean }[] }[])[0]!.options.some((option) => option.disabled)).toBe(true);
  });
});
