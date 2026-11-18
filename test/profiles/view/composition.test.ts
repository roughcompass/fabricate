import type { JsonValue } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { profileDiagnostics } from "@/lib/profiles/profile-records";
import { compositionSummary } from "@/lib/profiles/composition";
import { layoutOf, rowCells } from "@/lib/profiles/layouts";
import type { Fact, FactDocument } from "@/lib/profiles/states";
import { type CategoryBlock, profileView } from "@/lib/profiles/view";
import { factDocumentFixture } from "../../support/fact-documents";

const literal = (value: JsonValue) => ({ kind: "literal", value });
const computed = (detail: string) => ({ kind: "unresolved", reason: "computed", detail });
/** A shared module as webpack's list of objects writes it, and the detectors capture it. */
const sharedModule = (name: string, settings: Record<string, JsonValue>) => ({ kind: "object", complete: true, properties: { [name]: { kind: "object", complete: true, properties: settings } } });

const container = (overrides: Record<string, JsonValue> = {}) => ({
  mechanism: "module-federation",
  plugin: "architecture.module-federation.webpack",
  name: literal("chrome"),
  exposes: ["./DashboardFavorites", "./SatelliteToken"],
  remotes: [],
  shared: [sharedModule("react", { singleton: literal(true), eager: literal(true), requiredVersion: computed("The value is computed at runtime") }), sharedModule("react-dom", { singleton: literal(true) }), computed("The value is computed at runtime")],
  ...overrides,
});

const fact = (key: string, value: JsonValue, state = "observed"): Fact => ({ key, state, value, evidence: ["ev_1"], rule: "architecture.module-federation.webpack" });

/** insights-chrome's container as its build and its Cypress configuration each define it. */
const conflicting: Fact = {
  key: "module-federation:chrome",
  state: "conflicting",
  value: null,
  evidence: ["ev_build", "ev_cypress"],
  rule: "architecture.module-federation.webpack",
  candidates: [
    { value: container(), evidence: ["ev_build"], rule: "architecture.module-federation.webpack" },
    { value: container({ exposes: [], shared: [sharedModule("react", { singleton: literal(true) })] }), evidence: ["ev_cypress"], rule: "architecture.module-federation.webpack" },
  ],
};

const layout = layoutOf("composition");
const cellsOf = (value: Fact) => {
  const row = rowCells(layout, value);
  if (row.kind !== "cells") throw new Error(`expected cells, got ${row.kind}`);
  return row.cells;
};

describe("Profile composition", () => {
  it("reads a Module Federation container by its name, what it exposes, loads, and shares, never as one run of text", () => {
    const [unit, exposes, loads, shares] = cellsOf(fact("module-federation:chrome", container()));
    expect(unit).toEqual({ text: "chrome", mono: true, secondary: "Module Federation · webpack" });
    expect(exposes).toEqual({ text: "2 modules", items: [{ text: "./DashboardFavorites", mono: true }, { text: "./SatelliteToken", mono: true }] });
    expect(loads).toEqual({ text: "None" });
    // Shared modules read by name with the settings that change how they load, and a count that says when code may add more.
    expect(shares).toEqual({
      text: "At least 2 packages",
      items: [
        { text: "react", mono: true, secondary: "Singleton · Eager" },
        { text: "react-dom", mono: true, secondary: "Singleton" },
        { text: "The value is computed at runtime" },
      ],
    });
    expect(JSON.stringify(cellsOf(fact("module-federation:chrome", container())))).not.toMatch(/complete|properties|kind/);
  });

  it("names each remote by its alias, with its container and where its entry loads from", () => {
    const shell = factDocumentFixture("federation-shell") as unknown as FactDocument;
    const federation = shell.categories.composition!.facts.find((candidate) => candidate.key === "module-federation:mfShell")!;
    const [unit, exposes, loads, shares] = cellsOf(federation);
    expect(unit).toMatchObject({ text: "mfShell", secondary: "Module Federation · webpack" });
    expect(exposes).toEqual({ text: "None" });
    expect(loads).toEqual({ text: "2 remotes", items: [{ text: "mfAdmin", mono: true, secondary: "http://127.0.0.1:9101/remoteEntry.js" }, { text: "mfBilling", mono: true, secondary: "The remote is loaded by code" }] });
    expect(shares).toEqual({ text: "2 packages", items: [{ text: "react", mono: true }, { text: "react-dom", mono: true }] });
    const frame = shell.categories.composition!.facts.find((candidate) => candidate.key.startsWith("iframe:"))!;
    expect(cellsOf(frame)).toEqual([{ text: "Embedded frame", secondary: "iframe" }, null, { text: "", items: [{ text: "http://127.0.0.1:9103", mono: true }] }, null]);
  });

  it("reads import maps and single-spa by what each entry or role loads", () => {
    expect(cellsOf(fact("import-map:react", { mechanism: "import-map", source: "src/index.html", specifier: "react", url: "https://cdn.test/react.js" }))).toEqual([
      { text: "react", mono: true, secondary: "Import map" },
      null,
      { text: "", items: [{ text: "https://cdn.test/react.js", mono: true }] },
      null,
    ]);
    const registration = { mechanism: "single-spa", role: "registration", application: literal("footer"), activeWhen: { kind: "unresolved", reason: "unsupported", detail: "ArrowFunction is not resolved statically" } };
    expect(cellsOf(fact("single-spa:application:footer", registration)).slice(0, 3)).toEqual([{ text: "Registration", secondary: "single-spa" }, null, { text: "", items: [{ text: "footer", mono: true, secondary: "Active when: ArrowFunction is not resolved statically" }] }]);
    expect(cellsOf(fact("single-spa:root-config", { mechanism: "single-spa", role: "root-config" }, "inferred"))[0]).toEqual({ text: "Root config", secondary: "single-spa" });
  });

  it("lays a conflict's candidates out in the columns, each with its own evidence, and quiets what they share", () => {
    const row = rowCells(layout, conflicting);
    expect(row.kind).toBe("candidates");
    if (row.kind !== "candidates") return;
    const [build, cypress] = row.candidates;
    expect(build!.evidence).toEqual(["ev_build"]);
    expect(cypress!.evidence).toEqual(["ev_cypress"]);
    // The first column names the fact, so it keeps its weight; Loads is None in both, so it reads as secondary; Exposes and Shares differ.
    expect(build!.cells![0]).toEqual({ text: "chrome", mono: true, secondary: "Module Federation · webpack" });
    expect(build!.cells![2]).toEqual({ text: "None", muted: true });
    expect(build!.cells![1]).toMatchObject({ text: "2 modules" });
    expect(cypress!.cells![1]).toEqual({ text: "None" });
    expect(cypress!.cells![3]).toEqual({ text: "", items: [{ text: "react", mono: true, secondary: "Singleton" }] });
  });

  it("keeps a conflict whose candidates don't fit the columns as text", () => {
    const row = rowCells(layoutOf("runtime_requirements"), { key: "node", state: "conflicting", value: null, evidence: [], rule: "manifest.engines", candidates: [{ value: "18", evidence: ["ev_a"], rule: "nvmrc" }] });
    expect(row).toEqual({ kind: "candidates", candidates: [{ text: "18", evidence: ["ev_a"] }] });
  });

  it("leaves out the columns no row fills, such as Exposes and Shares without Module Federation", () => {
    const shell = factDocumentFixture("federation-shell") as unknown as FactDocument;
    const columns = (document: FactDocument) => {
      const view = profileView(document, profileDiagnostics({ fact_document: document as never }));
      const block = view.groups.flatMap((group) => group.blocks).find((candidate): candidate is CategoryBlock => candidate.kind === "category" && candidate.heading.definition.id === "composition")!;
      return { columns: block.columns, widths: block.rows.map((candidate) => (candidate.cells.kind === "cells" ? candidate.cells.cells.length : 0)) };
    };
    expect(columns(shell).columns).toEqual(["Composition", "Exposes", "Loads", "Shares"]);
    const frames = { ...shell, categories: { ...shell.categories, composition: { ...shell.categories.composition!, facts: shell.categories.composition!.facts.filter((candidate) => candidate.key.startsWith("iframe:")) } } };
    expect(columns(frames)).toEqual({ columns: ["Composition", "Loads"], widths: [2] });
  });

  it("summarizes each mechanism in a phrase for the overview, counting a conflict's candidates without picking one", () => {
    expect(compositionSummary([conflicting])).toEqual([{ state: "conflicting", text: "Module Federation", secondary: "chrome · exposes 2 modules" }]);
    const host = fact("module-federation:root", container({ name: literal("root"), exposes: [], remotes: [{ alias: "shared", entry: computed("The remote is loaded by code"), federation_name: null }] }));
    const remote = fact("module-federation:shared", container({ name: literal("shared"), exposes: ["./footer", "./header"] }));
    const registration = (name: string) => fact(`single-spa:application:${name}`, { mechanism: "single-spa", role: "registration", application: literal(name) });
    expect(compositionSummary([host, remote, fact("single-spa:root-config", { mechanism: "single-spa", role: "root-config" }, "inferred"), registration("footer"), registration("header")])).toEqual([
      { state: "observed", text: "Module Federation", secondary: "root, shared · exposes 2 modules · loads 1 remote" },
      { state: "mixed", text: "single-spa", secondary: "root config · registers 2 applications" },
    ]);
    const maps = ["react", "react-dom"].map((specifier) => fact(`import-map:${specifier}`, { mechanism: "import-map", source: "index.html", specifier, url: `https://cdn.test/${specifier}.js` }));
    expect(compositionSummary(maps)).toEqual([{ state: "observed", text: "Import map", secondary: "2 specifiers" }]);
  });
});
