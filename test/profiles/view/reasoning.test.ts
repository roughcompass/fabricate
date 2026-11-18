import { describe, expect, it } from "vitest";
import { parseReasoning } from "@/lib/profiles/reasoning";

describe("a fact's reasoning", () => {
  it("reads as a statement and its examples, each with where it was found", () => {
    const text =
      "Each of these <div> elements is styled only with layout declarations, which a design-system layout component could apply instead: display: 'none' (src/dialog-header.tsx:26); display: flex (src/layout.tsx:43); gap: ______________ (src/app-bar.tsx:61); and 5 more.";
    expect(parseReasoning(text)).toEqual({
      lead: "Each of these <div> elements is styled only with layout declarations, which a design-system layout component could apply instead.",
      items: [
        { text: "display: 'none'", location: "src/dialog-header.tsx:26" },
        { text: "display: flex", location: "src/layout.tsx:43" },
        // A template literal's interpolation reads as the code wrote it.
        { text: "gap: ${…}", location: "src/app-bar.tsx:61" },
      ],
      more: 5,
    });
  });

  it("keeps a value's own parentheses and a location that names several files", () => {
    const parsed = parseReasoning("Every definition resolves to a token: --gap, defined as calc(var(--salt-size) - 1px) (src/a.css:3, src/b.css:8); --color, defined as var(--salt-color) (src/c.css:2).");
    expect(parsed?.items).toEqual([
      { text: "--gap, defined as calc(var(--salt-size) - 1px)", location: "src/a.css:3, src/b.css:8" },
      { text: "--color, defined as var(--salt-color)", location: "src/c.css:2" },
    ]);
  });

  it("leaves a reasoning without a list of examples as it is", () => {
    expect(parseReasoning("The tokenized counts include declarations that use token aliases.")).toBeNull();
    expect(parseReasoning("Inferred from naming: one example (src/a.ts:1).")).toBeNull();
  });
});
