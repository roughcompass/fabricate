import { beforeAll, describe, expect, it } from "vitest";
import { type OverviewRow, overview } from "@/lib/profiles/overview";
import type { FactDocument } from "@/lib/profiles/states";
import { analyzedFacts, asRelease010, factDocumentFixture } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

const row = (rows: OverviewRow[], label: string) => rows.find((candidate) => candidate.label === label)!;
const texts = (rows: OverviewRow[], label: string) => row(rows, label).values.map((value) => value.text);

describe("The Profile overview", () => {
  let storefront: FactDocument;
  beforeAll(async () => {
    storefront = await analyzedFacts({
      "package.json": manifest({ name: "storefront", version: "2.1.0", engines: { node: ">=22" }, dependencies: { react: "19.1.0" }, devDependencies: { vite: "7.0.0", vitest: "3.2.0", typescript: "5.8.3" } }),
      "template/package.json": manifest({ name: "{{PACKAGE_NAME}}", version: "0.1.0", private: true }),
      ".nvmrc": "18\n",
      "package-lock.json": manifest({ name: "storefront", lockfileVersion: 3, packages: { "": { name: "storefront" } } }),
      "vite.config.ts": 'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
      "src/main.tsx": 'export const load = () => fetch("https://api.example.test/products");\n',
    });
  });

  it("always shows the same rows, in order", () => {
    const rows = overview(storefront);
    expect(rows.map((candidate) => candidate.label)).toEqual(["Packages", "Languages", "Framework", "Build", "Tests", "Tooling", "Runtime", "Composition", "Design system", "Scope"]);
    expect(overview(factDocumentFixture("salt-application") as unknown as FactDocument).map((candidate) => candidate.label)).toEqual(rows.map((candidate) => candidate.label));
  });

  it("fills Framework and Build for a React application built with Vite, each value with its state", () => {
    const rows = overview(storefront);
    expect(row(rows, "Framework").values).toEqual([{ state: "observed", text: "React 19.1.0" }]);
    expect(texts(rows, "Build")).toEqual(expect.arrayContaining(["Vite", "TypeScript compiler"]));
    expect(texts(rows, "Tests")).toEqual(["Vitest"]);
    expect(row(rows, "Tooling").values).toContainEqual({ state: "inferred", text: "npm" });
    // No CI definition: the Tooling row names that category's state instead of leaving it out.
    expect(row(rows, "Tooling").placeholders).toEqual([{ label: "CI systems", value: { state: "absent", reason: expect.any(String) } }]);
    expect(row(rows, "Framework").category).toBe("frameworks");
  });

  it("shows an unknown composition as unknown, with its reason", () => {
    expect(row(overview(storefront), "Composition")).toMatchObject({ values: [], placeholders: [{ value: { state: "unknown", reason: expect.stringContaining("cannot prove there is none") } }] });
  });

  it("shows one composition value per mechanism, one per line, with what it exposes and loads", () => {
    const composition = row(overview(factDocumentFixture("federation-shell") as unknown as FactDocument), "Composition");
    expect(composition.stacked).toBe(true);
    expect(composition.values).toEqual([
      { state: "observed", text: "iframe", secondary: "1 embedded frame" },
      { state: "observed", text: "Module Federation", secondary: "mfShell · loads 2 remotes" },
    ]);
  });

  it("shows both candidates of a conflicting Node requirement, never one of them", () => {
    expect(row(overview(storefront), "Runtime").values).toContainEqual({ state: "conflicting", text: "Node.js: 18 or >=22" });
  });

  it("shows the Design system row as not covered by detector release 0.1.0", () => {
    expect(row(overview(asRelease010(storefront)), "Design system").placeholders).toEqual([{ value: { state: "not_covered", reason: "Detector release 0.1.0 doesn't report this category" } }]);
    expect(texts(overview(factDocumentFixture("salt-application") as unknown as FactDocument), "Design system")).toEqual(["Salt"]);
  });

  it("writes package names as the manifest writes them, with their visibility and directory", () => {
    expect(row(overview(storefront), "Packages").values).toContainEqual({ state: "observed", text: "{{PACKAGE_NAME}} 0.1.0", secondary: "private · template/" });
  });

  it("states how many files were read, and never calls the others skipped", () => {
    const scope = row(overview({ ...storefront, inventory: { files: 111, files_read: 98 } }), "Scope");
    expect(scope.category).toBeNull();
    expect(scope.values[0]).toEqual({ state: null, text: "98 of 111 files read" });
    expect(scope.values.map((value) => value.text).join(" ")).not.toMatch(/skipped/i);
    expect(texts([scope], "Scope").slice(1)).toEqual(["4 dependencies", "0 scripts", "1 Service Dependency"]);
  });

  it("shows the first three languages by file count, and how many more there are", () => {
    const languages = row(overview(factDocumentFixture("npm-workspace") as unknown as FactDocument), "Languages");
    expect(languages.values.length).toBeLessThanOrEqual(3);
    const counts = languages.values.map((value) => Number.parseInt(value.secondary ?? "0", 10));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(languages.more).toBeGreaterThanOrEqual(0);
  });

  it("lists packages one per line under their counts, the first five and how many more", async () => {
    const files: Record<string, string> = { "package.json": manifest({ name: "fleet", private: true, workspaces: ["packages/*"] }) };
    for (const name of ["a", "b", "c", "d", "e", "f"]) files[`packages/${name}/package.json`] = manifest({ name: `@fleet/${name}`, version: "1.0.0" });
    const packages = row(overview(await analyzedFacts(files)), "Packages");
    expect(packages.stacked).toBe(true);
    expect(packages.summary).toMatch(/^7 packages · .*1 private$/);
    expect(packages.values).toHaveLength(5);
    expect(packages.more).toBe(2);
    expect(row(overview(storefront), "Languages").stacked).toBe(false);
  });

  it("names a framework without a catalog or workspace reference, which isn't a version", async () => {
    const document = await analyzedFacts({ "package.json": manifest({ name: "shop", dependencies: { react: "catalog:", "react-dom": "catalog:" } }) });
    expect(texts(overview(document), "Framework")).toEqual(["React"]);
  });
});
