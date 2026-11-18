import type { JsonObject } from "@repo-facts/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { kindLabel } from "@/components/ui/status";
import { layoutOf, rowCells } from "@/lib/profiles/layouts";
import type { Fact, FactDocument } from "@/lib/profiles/states";
import { FACT_DOCUMENT_FIXTURES, analyzedFacts, factDocumentFixture } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

const KIND_FIRST = ["composition", "runtime_integrations", "access_signals", "egress_routes", "test_substitutes"];

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

  it("keeps unknown ids on the generic fact and value columns", () => {
    expect(layoutOf("web-doctor.entry_points").generic).toBe(true);
    for (const id of ["design_systems", "ui_elements", "style_values"]) expect(layoutOf(id).generic, id).toBe(false);
  });

  it("describes a design system by its name, its setup, and its packages, never as one run of text", () => {
    const fact: Fact = {
      key: "salt",
      state: "observed",
      value: {
        catalog: "salt",
        catalog_version: "1.0.0",
        imported: true,
        name: "Salt",
        provider: false,
        theme_stylesheet: true,
        packages: [
          { field: "dependencies", manifest: "a/package.json", name: "@salt-ds/core", range: "1.74.0" },
          { field: "dependencies", manifest: "b/package.json", name: "@salt-ds/core", range: "1.74.0" },
          { field: "dependencies", manifest: "b/package.json", name: "@salt-ds/icons", range: "1.18.4" },
        ],
      },
      evidence: [],
      rule: "design-system.recognize",
    };
    expect(rowCells(layoutOf("design_systems"), fact)).toEqual({
      kind: "cells",
      cells: [
        { text: "Salt", secondary: "Catalog salt 1.0.0" },
        { text: "No provider rendered", secondary: "Theme stylesheet imported · Imported by source" },
        { text: "@salt-ds/core 1.74.0 · @salt-ds/icons 1.18.4", secondary: "Declared in 2 manifests" },
      ],
    });
  });

  it("counts element and style uses in the app first, with stories and tests apart, and leads with the summary", () => {
    const salt = factDocumentFixture("salt-application") as unknown as FactDocument;
    const elements = [...salt.categories.ui_elements!.facts].sort(layoutOf("ui_elements").sort);
    expect(elements[0]!.key).toMatch(/^summary:/);
    const button = salt.categories.ui_elements!.facts.find((fact) => fact.key.startsWith("component:"))!;
    const cells = rowCells(layoutOf("ui_elements"), button);
    expect(cells.kind === "cells" && cells.cells[0]).toMatchObject({ text: button.key.split(":")[2], secondary: expect.stringMatching(/component/) });
    const styles = [...salt.categories.style_values!.facts].sort(layoutOf("style_values").sort);
    expect(styles[0]!.key).toMatch(/^summary:/);
    const selector = salt.categories.style_values!.facts.find((fact) => fact.key.startsWith("element-selector:"))!;
    const row = rowCells(layoutOf("style_values"), selector);
    expect(row.kind === "cells" && row.cells.slice(0, 2)).toMatchObject([{ text: `Global rules for <${selector.key.split(":")[1]}>` }, { text: expect.stringMatching(/^\d/) }]);
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

  it("names each API contract and counts its operations, with a generated client's files as one row per directory", () => {
    const fact = (key: string, value: Fact["value"]): Fact => ({ key, state: "observed", value, evidence: [], rule: "architecture.api-contract" });
    const layout = layoutOf("api_contracts");
    expect(rowCells(layout, fact("spec", { kind: "openapi", operations: 70, path: "specs/openapi.yaml", servers: [], title: "Directus", version: "3.0.1" }))).toEqual({
      kind: "cells",
      cells: [{ text: "Directus", secondary: "OpenAPI 3.0.1" }, { text: "70" }, { text: "specs/openapi.yaml", mono: true }],
    });
    expect(rowCells(layout, fact("ops", { definitions: 0, kind: "graphql_operations", operations: ["query FetchChannels"], path: "src/fetch.graphql" }))).toMatchObject({ kind: "cells", cells: [{ text: "query FetchChannels", secondary: "GraphQL operations" }, { text: "1" }, {}] });
    const generated = (path: string) => rowCells(layout, fact(path, { contract: "openapi", generator: "@hey-api/openapi-ts", kind: "generated_schema", path }));
    expect(generated("sdk/openapi/client.gen.ts")).toEqual(generated("sdk/openapi/types.gen.ts"));
    expect(generated("sdk/openapi/client.gen.ts")).toEqual({ kind: "cells", cells: [{ text: "Generated OpenAPI client", secondary: "By @hey-api/openapi-ts" }, null, { text: "sdk/openapi/", mono: true }] });
  });
});
