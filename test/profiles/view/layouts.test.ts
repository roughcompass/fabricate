import type { JsonObject } from "@repo-facts/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { kindLabel } from "@/components/ui/status";
import { layoutOf, rowCells } from "@/lib/profiles/layouts";
import type { Fact, FactDocument } from "@/lib/profiles/states";
import { FACT_DOCUMENT_FIXTURES, analyzedFacts, factDocumentFixture } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

const KIND_FIRST = ["composition", "runtime_integrations", "access_signals", "egress_routes", "api_contracts", "test_substitutes"];

describe("Profile category layouts", () => {
  const documents: [string, FactDocument][] = FACT_DOCUMENT_FIXTURES.map((name) => [name, factDocumentFixture(name) as unknown as FactDocument]);
  beforeAll(async () => {
    documents.push([
      "storefront",
      await analyzedFacts({
        "package.json": manifest({ name: "storefront", version: "2.1.0", engines: { node: ">=22" }, scripts: { build: "vite build", test: "vitest run" }, dependencies: { react: "19.1.0" }, devDependencies: { vite: "7.0.0", vitest: "3.2.0" } }),
        ".nvmrc": "18\n",
        ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
        "src/main.tsx": 'export const load = () => fetch("https://api.example.test/products");\n',
      }),
    ]);
  });

  it("shows every fact in its category's own columns", () => {
    for (const [name, document] of documents) {
      for (const [id, category] of Object.entries(document.categories)) {
        const layout = layoutOf(id);
        if (layout.generic) continue;
        for (const fact of category.facts) {
          const row = rowCells(layout, fact);
          if (fact.state === "conflicting") expect(row.kind, `${name} ${id} ${fact.key}`).toBe("candidates");
          else if (fact.state !== "unknown") expect(row.kind, `${name} ${id} ${fact.key} ${JSON.stringify(fact.value)}`).toBe("cells");
        }
      }
    }
  });

  it("keeps the Interface categories and unknown ids on the generic fact and value columns", () => {
    for (const id of ["design_systems", "ui_elements", "style_values", "web-doctor.entry_points"]) expect(layoutOf(id).generic, id).toBe(true);
    const salt = factDocumentFixture("salt-application") as unknown as FactDocument;
    const fact = salt.categories.ui_elements!.facts[0]!;
    expect(rowCells(layoutOf("ui_elements"), fact)).toMatchObject({ kind: "cells", cells: [{ text: fact.key, mono: true }, { text: expect.any(String) }] });
  });

  it("writes a value that lacks a required field out in full, in one cell", () => {
    const fact: Fact = { key: "package.json#dependencies/left-pad", state: "observed", value: { field: "dependencies", manifest: "package.json", name: "left-pad" }, evidence: [], rule: "manifest.dependencies" };
    expect(rowCells(layoutOf("dependencies"), fact)).toEqual({ kind: "whole", text: "field: dependencies; manifest: package.json; name: left-pad" });
  });

  it("leads each category whose values differ by kind with that kind or mechanism", () => {
    let checked = 0;
    for (const [, document] of documents) {
      for (const id of KIND_FIRST) {
        for (const fact of document.categories[id]?.facts ?? []) {
          const value = fact.value as JsonObject;
          const kind = String(value.kind ?? value.mechanism ?? value.contract);
          const row = rowCells(layoutOf(id), fact);
          expect(row.kind === "cells" && row.cells[0]?.text).toBe(kindLabel(kind));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(3);
    const shell = factDocumentFixture("federation-shell") as unknown as FactDocument;
    const mechanisms = shell.categories.composition!.facts.map((fact) => {
      const row = rowCells(layoutOf("composition"), fact);
      return row.kind === "cells" ? row.cells[0]?.text : null;
    });
    expect(mechanisms).toEqual(expect.arrayContaining(["iframe", "Module Federation"]));
  });

  it("lists a conflict's candidates with their own evidence", () => {
    const [, storefront] = documents.at(-1)!;
    const node = storefront.categories.runtime_requirements!.facts.find((fact) => fact.key === "node")!;
    expect(node.state).toBe("conflicting");
    const row = rowCells(layoutOf("runtime_requirements"), node);
    expect(row.kind).toBe("candidates");
    if (row.kind === "candidates") {
      expect(row.candidates.map((candidate) => candidate.text)).toEqual(expect.arrayContaining([expect.stringContaining("18"), expect.stringContaining(">=22")]));
      for (const candidate of row.candidates) expect(candidate.evidence.length).toBeGreaterThan(0);
    }
  });
});
