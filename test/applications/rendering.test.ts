import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { determineRendering } from "@/lib/applications/rendering";
import type { Fact, FactDocument } from "@/lib/profiles/states";
import { factDocumentFixture } from "../support/fact-documents";

/*
 * The rendering determination (make-applications-first-class task 4.1,
 * rendering-assessment spec) against fixture Profiles: each rule in order,
 * what's also observed, a conflicting deciding fact, and the evidence every
 * result carries.
 */

const SOURCE = { profile: "prf_0123456789abcdef", assessment: "asm_0123456789abcdef" };

/** A fact document with +facts+ by category, each fact's evidence a line range in +path+. */
function profile(facts: Record<string, (Fact & { path?: string; line?: number })[]>): FactDocument {
  const evidence: JsonObject = {};
  const categories: FactDocument["categories"] = {};
  for (const [category, list] of Object.entries(facts)) {
    categories[category] = {
      state: "observed",
      search: { complete: true, skipped: [], surface: [], rules: [] },
      facts: list.map(({ path = "src/index.ts", line = 1, ...fact }) => {
        for (const id of [...fact.evidence, ...(fact.candidates ?? []).flatMap((candidate) => candidate.evidence)]) {
          evidence[id] = { id, path, location: { kind: "lines", start: line, end: line + 2 } };
        }
        return fact;
      }),
    };
  }
  return { detector_release: "0.2.0", categories, evidence };
}

const federation = (name: string, exposes: JsonValue, overrides: Partial<Fact> & { path?: string; line?: number } = {}) => ({
  key: `module-federation:${name}`,
  state: "observed",
  rule: "architecture.module-federation.webpack",
  evidence: [`ev_mf_${name}`],
  value: { mechanism: "module-federation", name: { kind: "literal", value: name }, exposes, remotes: [], shared: [] },
  path: "webpack.config.js",
  line: 12,
  ...overrides,
});
const singleSpa = { key: "single-spa:application", state: "inferred", rule: "architecture.single-spa.application", reasoning: "Lifecycles", evidence: ["ev_lifecycles"], value: { mechanism: "single-spa", role: "application" }, path: "src/main.ts", line: 4 };
const framework = (id: string, label: string) => ({ key: `package.json#${id}`, state: "observed", rule: "manifest.framework", evidence: [`ev_${id}`], value: { id, label, package: id }, path: "package.json", line: 8 });

describe("determineRendering", () => {
  it("is Module Federation when a build exposes a module (Federated remote)", () => {
    const result = determineRendering(profile({ composition: [federation("mfPayees", ["./App"])] }), SOURCE);
    expect(result).toMatchObject({ mode: "module_federation_2", rule: "module-federation-exposes", reason: null, candidates: [], ...SOURCE });
    expect(result.deciding).toEqual([
      { rule: "module-federation-exposes", category: "composition", key: "module-federation:mfPayees", state: "observed", summary: "Module Federation build mfPayees exposes ./App", evidence: [{ id: "ev_mf_mfPayees", path: "webpack.config.js", lines: { start: 12, end: 14 }, pointer: null }] },
    ]);
  });

  it("falls through a build that exposes nothing, a host, to the next rule", () => {
    expect(determineRendering(profile({ composition: [federation("mfShell", [])], frameworks: [framework("react", "React")] }), SOURCE)).toMatchObject({ mode: "iframe", rule: "web-framework" });
  });

  it("is ESM for a repository that exports single-spa lifecycles (single-spa application)", () => {
    const result = determineRendering(profile({ composition: [singleSpa] }), SOURCE);
    expect(result).toMatchObject({ mode: "esm", rule: "single-spa-application", alsoObserved: [] });
    expect(result.deciding[0]).toMatchObject({ summary: "Exports single-spa lifecycles: bootstrap, mount, and unmount", evidence: [{ path: "src/main.ts", lines: { start: 4, end: 6 } }] });
  });

  it("is iframe for React and Next.js with no composition (Standalone web app)", () => {
    const result = determineRendering(profile({ frameworks: [framework("react", "React"), framework("next", "Next.js")] }), SOURCE);
    expect(result).toMatchObject({ mode: "iframe", rule: "web-framework" });
    expect(result.deciding.map((fact) => fact.summary)).toEqual(["Uses React", "Uses Next.js"]);
  });

  it("is Undetermined, saying no web front end was found, for a server or an empty repository (Nothing to render)", () => {
    for (const document of [profile({}), profile({ frameworks: [framework("express", "Express")] })]) {
      const result = determineRendering(document, SOURCE);
      expect(result).toMatchObject({ mode: "undetermined", rule: "none", deciding: [], alsoObserved: [] });
      expect(result.reason).toMatch(/^No web front end was found/);
    }
  });

  it("is Module Federation when both mechanisms are present, with single-spa and the framework also observed (Both mechanisms present)", () => {
    const result = determineRendering(profile({ composition: [federation("mfPayees", ["./App"]), singleSpa], frameworks: [framework("react", "React")] }), SOURCE);
    expect(result.mode).toBe("module_federation_2");
    expect(result.alsoObserved.map((fact) => [fact.rule, fact.summary])).toEqual([
      ["single-spa-application", "Exports single-spa lifecycles: bootstrap, mount, and unmount"],
      ["web-framework", "Uses React"],
    ]);
  });

  it("is Undetermined with both configurations as candidates when the federation fact conflicts, without falling through (Conflicting federation fact)", () => {
    const conflicting = federation("mfPayees", [], {
      state: "conflicting",
      value: null,
      evidence: [],
      candidates: [
        { value: { mechanism: "module-federation", name: { kind: "literal", value: "mfPayees" }, exposes: ["./App"] }, evidence: ["ev_webpack"], rule: "architecture.module-federation.webpack" },
        { value: { mechanism: "module-federation", name: { kind: "literal", value: "mfPayees" }, exposes: [] }, evidence: ["ev_rspack"], rule: "architecture.module-federation.rspack" },
      ],
    });
    const result = determineRendering(profile({ composition: [conflicting, singleSpa], frameworks: [framework("react", "React")] }), SOURCE);
    expect(result).toMatchObject({ mode: "undetermined", rule: "module-federation-exposes" });
    expect(result.reason).toMatch(/Module Federation configuration is conflicting/);
    expect(result.candidates).toEqual([
      { summary: "Module Federation build mfPayees exposing ./App", evidence: [{ id: "ev_webpack", path: "webpack.config.js", lines: { start: 12, end: 14 }, pointer: null }] },
      { summary: "Module Federation build mfPayees exposing nothing", evidence: [{ id: "ev_rspack", path: "webpack.config.js", lines: { start: 12, end: 14 }, pointer: null }] },
    ]);
    expect(result.alsoObserved.map((fact) => fact.rule)).toEqual(["single-spa-application", "web-framework"]);
  });

  it("is Undetermined when a build's exposed modules come from code the Profile couldn't read", () => {
    const result = determineRendering(profile({ composition: [federation("mfPayees", [{ kind: "unresolved", reason: "computed", detail: "Entries may also come from a spread" }])], frameworks: [framework("react", "React")] }), SOURCE);
    expect(result).toMatchObject({ mode: "undetermined", rule: "module-federation-exposes" });
    expect(result.reason).toMatch(/couldn't read/);
  });

  it("reads repo-facts' own federation-shell Profile, a host that exposes nothing, as an iframe from its React dependency", () => {
    const result = determineRendering(factDocumentFixture("federation-shell") as unknown as FactDocument, SOURCE);
    expect(result).toMatchObject({ mode: "iframe", rule: "web-framework" });
    expect(result.deciding.map((fact) => [fact.summary, fact.evidence[0]?.path])).toEqual([["Uses React", "package.json"]]);
  });

  it("carries the rule, every deciding fact's path and lines, and the Profile and Run on every result", () => {
    const documents = [profile({ composition: [federation("mfPayees", ["./App"])] }), profile({ composition: [singleSpa] }), profile({ frameworks: [framework("vue", "Vue")] }), profile({})];
    for (const document of documents) {
      const result = determineRendering(document, SOURCE);
      expect(result.profile).toBe(SOURCE.profile);
      expect(result.assessment).toBe(SOURCE.assessment);
      expect(result.rule).toBeTruthy();
      for (const fact of result.deciding) for (const evidence of fact.evidence) expect([evidence.path, evidence.lines]).not.toContain(null);
    }
  });
});
