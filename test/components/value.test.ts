import { describe, expect, it } from "vitest";
import { factText, formatValue } from "@/components/results/value";

// repository-profiles: per-scope counts are readable, without their zero counts.

const zero = { sites: 0, as_is: 0, customized: 0, unknown: 0, mechanisms: { class_name: 0, style: 0, css: 0, sx: 0, styled: 0 }, styles: { resolved: 0, partial: 0, unresolved: 0 } };

describe("per-scope count values", () => {
  it("shows a component fact's non-zero counts in each scope that has any", () => {
    const value = {
      package: "@salt-ds/core",
      app: { ...zero, sites: 2, as_is: 1, customized: 1, mechanisms: { ...zero.mechanisms, class_name: 1 }, styles: { ...zero.styles, resolved: 1 } },
      stories: { ...zero, sites: 1, customized: 1, mechanisms: { ...zero.mechanisms, style: 1 }, styles: { ...zero.styles, resolved: 1 } },
      tests: zero,
    };
    expect(formatValue(value)).toBe(
      "package: @salt-ds/core · app: sites 2, as is 1, customized 1, mechanisms (class name 1), styles (resolved 1) · stories: sites 1, customized 1, mechanisms (style 1), styles (resolved 1)",
    );
  });

  it("shows an intrinsic fact's group and equivalent before its counts", () => {
    const value = { group: "equivalent", equivalent: "salt:Button", app: { sites: 1, unstyled: 1, styled: 0 }, stories: { sites: 0, unstyled: 0, styled: 0 }, tests: { sites: 0, unstyled: 0, styled: 0 } };
    expect(formatValue(value)).toBe("group: equivalent · equivalent: salt:Button · app: sites 1, unstyled 1");
    expect(formatValue({ ...value, equivalent: null })).toBe("group: equivalent · equivalent: none · app: sites 1, unstyled 1");
  });

  it("shows a finding's count, and keeps a share of 0", () => {
    expect(formatValue({ app: { count: 3 }, stories: { count: 0 }, tests: { count: 1 } })).toBe("app: count 3 · tests: count 1");
    expect(factText("observed", { app: { elements: 4, design_system: 2, customized_share: 0, adoption_share: 66 }, stories: { elements: 0, design_system: 0 }, tests: { elements: 0, design_system: 0 } })).toBe(
      "app: elements 4, design system 2, customized share 0, adoption share 66",
    );
  });

  it("leads each scope with its headline count, whatever order the stored keys are in", () => {
    expect(formatValue({ app: { as_is: 1, customized: 1, sites: 2 }, stories: { sites: 0 }, tests: { sites: 0 } })).toBe("app: sites 2, as is 1, customized 1");
  });

  it("writes a captured object or array by its properties and items, never by how it was captured", () => {
    const literal = (value: string | boolean) => ({ kind: "literal", value });
    const react = { kind: "object", complete: true, properties: { react: { kind: "object", complete: true, properties: { singleton: literal(true), requiredVersion: literal("^18.3.1") } } } };
    expect(formatValue(react)).toBe("react: (singleton: true; requiredVersion: ^18.3.1)");
    // Nested deeper than a field's own value, a structure is cut short, as any other is; the evidence panel keeps it whole.
    expect(formatValue({ shared: [react, { kind: "unresolved", reason: "computed", detail: "The value is computed at runtime" }] })).toBe("shared: (react: …), unresolved: The value is computed at runtime");
    expect(formatValue({ kind: "array", complete: false, items: [literal("a"), literal("b")] })).toBe("a, b, and more not resolved statically");
    expect(formatValue({ kind: "object", complete: false, properties: {} })).toBe("not resolved statically");
    expect(formatValue({ kind: "object", complete: true, properties: {} })).toBe("none");
  });

  it("says so when no scope has a count, and leaves other objects as they were", () => {
    expect(formatValue({ app: { count: 0 }, stories: { count: 0 }, tests: { count: 0 } })).toBe("no counts in any scope");
    expect(formatValue({ name: "@acme/ui", internal: true })).toBe("name: @acme/ui; internal: true");
  });
});
