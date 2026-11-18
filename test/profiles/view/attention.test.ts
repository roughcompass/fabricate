import { SHARED_CATEGORIES } from "@repo-facts/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { NOTHING_NEEDS_ATTENTION, attention } from "@/lib/profiles/attention";
import { overview } from "@/lib/profiles/overview";
import type { FactDocument } from "@/lib/profiles/states";
import { profileDiagnostics } from "@/lib/profiles/profile-records";
import { analyzedFacts, asRelease010 } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

const diagnosticsOf = (document: FactDocument) => profileDiagnostics({ fact_document: document as never });

describe("The Profile's needs-attention list", () => {
  let orders: FactDocument;
  beforeAll(async () => {
    orders = await analyzedFacts({
      "package.json": manifest({ name: "orders", version: "1.0.0", engines: { node: ">=20" }, dependencies: { axios: "^1.6.0" } }),
      ".nvmrc": "18\n",
      ".github/workflows/ci.yml": "name: ci\non: [push\njobs: {",
      "src/index.ts": "export const x = 1;\n",
    });
  });

  it("lists conflicting categories, then unknown categories with their reasons", () => {
    const { items } = attention(orders, diagnosticsOf(orders));
    expect(items[0]).toEqual({ kind: "conflicting", label: "Runtime requirements", reason: "1 fact with conflicting candidates: node", href: "#runtime_requirements" });
    const unknown = items.filter((item) => item.kind === "unknown");
    expect(unknown).toContainEqual({ kind: "unknown", label: "CI systems", reason: "1 relevant input could not be read or understood: .github/workflows/ci.yml", href: "#ci_systems" });
    expect(unknown.map((item) => item.label)).toContain("Composition");
    expect(items.findIndex((item) => item.kind === "unknown")).toBeGreaterThan(items.findIndex((item) => item.kind === "conflicting"));
  });

  it("links the skipped and diagnostic counts to their sections", () => {
    const { items } = attention(orders, diagnosticsOf(orders));
    expect(items).toContainEqual({ kind: "skipped", label: "1 skipped input", reason: expect.any(String), href: "#diagnostics" });
    const noted = attention(orders, { skipped: [], notes: [{ path: "a" }, { path: "b" }] }).items;
    expect(noted).toContainEqual({ kind: "diagnostics", label: "2 other diagnostics", reason: expect.any(String), href: "#other-diagnostics" });
  });

  it("lists a category with facts but unread inputs as partial, and marks its overview row", () => {
    const dependencies = orders.categories.dependencies!;
    const budgeted: FactDocument = { ...orders, categories: { ...orders.categories, dependencies: { ...dependencies, search: { ...dependencies.search, complete: false, skipped: ["a/package.json", "b/package.json", "c/package.json", "d/package.json"] } } } };
    expect(attention(budgeted, diagnosticsOf(budgeted)).items).toContainEqual({
      kind: "partial",
      label: "Dependencies",
      reason: "Found from what was read, but 4 relevant inputs could not be read or understood, so there may be more: a/package.json, b/package.json, c/package.json, and 1 more in Skipped inputs",
      href: "#dependencies",
    });
    expect(attention(orders, diagnosticsOf(orders)).items.some((item) => item.kind === "partial")).toBe(false);
    expect(overview(budgeted).find((row) => row.label === "Packages")!.partial).toBe(false);
    const packages = budgeted.categories.package_identity!;
    const partialPackages: FactDocument = { ...budgeted, categories: { ...budgeted.categories, package_identity: { ...packages, search: { ...packages.search, skipped: ["a/package.json"] } } } };
    expect(overview(partialPackages).find((row) => row.label === "Packages")!.partial).toBe(true);
  });

  it("lists the categories a detector release doesn't cover on one line", () => {
    const earlier = asRelease010(orders);
    const uncovered = attention(earlier, diagnosticsOf(earlier)).items.filter((item) => item.kind === "not_covered");
    expect(uncovered).toEqual([{ kind: "not_covered", label: "Design systems, UI elements, Style values", reason: "Detector release 0.1.0 doesn't report these categories", href: "#design_systems" }]);
    expect(attention(earlier, diagnosticsOf(earlier)).counts).toContainEqual({ state: "not_covered", count: 3 });
  });

  it("counts categories by state, in a fixed order", () => {
    const { counts } = attention(orders, diagnosticsOf(orders));
    expect(counts.reduce((sum, entry) => sum + entry.count, 0)).toBe(SHARED_CATEGORIES.length);
    expect(counts.map((entry) => entry.state)).toEqual(["observed", "inferred", "mixed", "conflicting", "unknown", "absent", "not_covered"].filter((state) => counts.some((entry) => entry.state === state)));
  });

  it("says so when nothing needs attention", () => {
    const quiet: FactDocument = { ...orders, diagnostics: [], categories: Object.fromEntries(SHARED_CATEGORIES.map((definition) => [definition.id, { state: "absent", facts: [], search: { complete: true, skipped: [], surface: [], rules: [] } }])) };
    expect(attention(quiet, diagnosticsOf(quiet))).toEqual({ counts: [{ state: "absent", count: SHARED_CATEGORIES.length }], items: [], empty: NOTHING_NEEDS_ATTENTION });
  });
});
