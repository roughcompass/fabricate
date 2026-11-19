import { SHARED_CATEGORIES } from "@repo-facts/contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { NoValuePlaceholder } from "@/components/results/no-value";
import { type FactDocument, categoryDefinitions, categoryState, noValue } from "@/lib/profiles/states";
import { analyzedFacts, asRelease010 } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

const definition = (id: string) => SHARED_CATEGORIES.find((candidate) => candidate.id === id)!;

describe("Profile category states and the reasons for no value", () => {
  let orders: FactDocument;
  beforeAll(async () => {
    orders = await analyzedFacts({
      "package.json": manifest({ name: "orders", version: "1.0.0", dependencies: { axios: "^1.6.0" } }),
      ".github/workflows/ci.yml": "name: ci\non: [push\njobs: {",
      "src/index.ts": "export const x = 1;\n",
    });
  });

  it("marks a category that the Surveyor release didn't define as not covered, naming the release", () => {
    const earlier = asRelease010(orders);
    expect(categoryState(earlier, "design_systems")).toBe("not_covered");
    expect(noValue(earlier, definition("design_systems"))).toEqual({ state: "not_covered", reason: "Surveyor release 0.1.0 doesn't report this category" });
    // A category the release did define keeps its own state.
    expect(categoryState(earlier, "languages")).toBe("observed");
  });

  it("names the skipped inputs that make a category unknown", () => {
    expect(categoryState(orders, "ci_systems")).toBe("unknown");
    expect(noValue(orders, definition("ci_systems"))).toEqual({ state: "unknown", reason: "1 relevant input could not be read or understood: .github/workflows/ci.yml" });
  });

  it("reads none detected only after a complete, bounded search, with its input count", () => {
    expect(categoryState(orders, "test_frameworks")).toBe("absent");
    expect(noValue(orders, definition("test_frameworks"))).toEqual({ state: "absent", reason: "After a complete search of 1 input" });
    expect(noValue(orders, definition("submodules"))).toEqual({ state: "absent", reason: "No input this category reads exists in this commit" });
  });

  it("keeps a complete search unknown when the category cannot claim absence", () => {
    expect(categoryState(orders, "composition")).toBe("unknown");
    expect(noValue(orders, definition("composition")).reason).toMatch(/^Searched \d+ inputs? and found none, but committed files cannot prove there is none$/);
  });

  it("lists the document's extension categories after the shared ones", () => {
    const extended = { ...orders, extensions: [{ id: "web-doctor.entry_points", bounded_negative: false }] };
    const definitions = categoryDefinitions(extended);
    expect(definitions.slice(0, SHARED_CATEGORIES.length)).toEqual(SHARED_CATEGORIES);
    expect(definitions.at(-1)).toMatchObject({ id: "web-doctor.entry_points", label: "Entry points", group: "Extensions", boundedNegative: false });
  });

  it("shows a placeholder as its state's indicator and label, then the reason", () => {
    const markup = renderToStaticMarkup(createElement(NoValuePlaceholder, { value: { state: "not_covered", reason: "Surveyor release 0.1.0 doesn't report this category" } }));
    expect(markup).toContain('data-shape="dash"');
    expect(markup).toContain("Not covered");
    expect(markup).toContain("Surveyor release 0.1.0");
    expect(markup).not.toMatch(/No data|>—</);
  });
});
