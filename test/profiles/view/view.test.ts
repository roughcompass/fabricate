import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { profileDiagnostics } from "@/lib/profiles/profile-records";
import type { FactDocument } from "@/lib/profiles/states";
import { type ProfileView, type SharedBlock, pageOfGroups, profileView } from "@/lib/profiles/view";
import { FACT_DOCUMENT_FIXTURES, analyzedFacts, asRelease010, factDocumentFixture } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

const viewOf = (document: FactDocument) => profileView(document, profileDiagnostics({ fact_document: document as never }));
const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every fact (by category and key), candidate, and evidence id the document holds. */
function inDocument(document: FactDocument) {
  const facts = new Set<string>();
  const evidence = new Set<string>();
  let candidates = 0;
  for (const [id, category] of Object.entries(document.categories)) {
    for (const fact of category.facts) {
      facts.add(`${id} ${fact.key}`);
      for (const ref of fact.evidence) evidence.add(ref);
      for (const candidate of fact.candidates ?? []) {
        candidates += 1;
        for (const ref of candidate.evidence) evidence.add(ref);
      }
    }
  }
  for (const service of document.service_dependencies ?? []) for (const ref of serviceEvidence(service)) evidence.add(ref);
  return { facts, evidence, candidates };
}

function serviceEvidence(service: JsonObject): string[] {
  const refs = Array.isArray(service.call_sites) ? service.call_sites.map(String) : [];
  for (const value of Object.values(service)) {
    if (!isObject(value)) continue;
    if (Array.isArray(value.evidence)) refs.push(...value.evidence.map(String));
    for (const candidate of Array.isArray(value.candidates) ? value.candidates : []) if (isObject(candidate) && Array.isArray(candidate.evidence)) refs.push(...candidate.evidence.map(String));
  }
  return refs;
}

/** Every fact, candidate, and evidence id the view shows. */
function inView(view: ProfileView) {
  const facts = new Set<string>();
  const evidence = new Set<string>();
  let candidates = 0;
  for (const group of view.groups) {
    for (const block of group.blocks) {
      const rows = block.kind === "category" ? block.rows : block.kind === "compact" ? [] : block.groups.flatMap((entry) => entry.rows);
      for (const row of rows) {
        for (const ref of row.evidence) evidence.add(ref);
        for (const held of row.held) {
          // A consumed package shared by two manifests is held by both rows; count its candidates once.
          if (!facts.has(`${held.category} ${held.fact.key}`)) candidates += held.fact.candidates?.length ?? 0;
          facts.add(`${held.category} ${held.fact.key}`);
        }
      }
    }
  }
  for (const service of view.services) for (const ref of serviceEvidence(service.service)) evidence.add(ref);
  return { facts, evidence, candidates };
}

describe("The Profile view", () => {
  const documents: [string, FactDocument][] = FACT_DOCUMENT_FIXTURES.map((name) => [name, factDocumentFixture(name) as unknown as FactDocument]);
  beforeAll(async () => {
    const orders = await analyzedFacts({
      "package.json": manifest({ name: "orders", version: "1.0.0", engines: { node: ">=20" }, scripts: { test: "vitest run", start: "node ." }, dependencies: { axios: "^1.6.0" } }),
      ".nvmrc": "18\n",
      "yarn.lock": "# yarn lockfile v1\n\n",
      ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
      "src/payments.ts": 'export const charge = () => fetch("https://payments.invalid/v1/charges", { method: "POST" });\n',
    });
    documents.push(["orders", orders], ["orders under 0.1.0", asRelease010(orders)]);
  });

  it("shows every fact, candidate, and evidence record in the document", () => {
    for (const [name, document] of documents) {
      const expected = inDocument(document);
      const shown = inView(viewOf(document));
      expect([...expected.facts].filter((fact) => !shown.facts.has(fact)), name).toEqual([]);
      expect([...expected.evidence].filter((ref) => !shown.evidence.has(ref)), name).toEqual([]);
      expect(shown.candidates, name).toBe(expected.candidates);
    }
  });

  it("gives every category a navigation entry with its state, and an anchor on the page", () => {
    for (const [name, document] of documents) {
      const view = viewOf(document);
      const entries = view.navigation.flatMap((group) => group.items);
      const anchors = new Set<string>();
      for (const group of view.groups) {
        for (const block of group.blocks) {
          if (block.kind === "category") anchors.add(block.heading.definition.id);
          else if (block.kind === "compact") for (const item of block.items) anchors.add(item.definition.id);
          else for (const source of block.sources) anchors.add(source.definition.id);
        }
      }
      expect(entries.filter((entry) => !anchors.has(entry.id)).map((entry) => entry.id), name).toEqual([]);
      expect(new Set(entries.map((entry) => entry.id)).size, name).toBe(entries.length);
    }
    const earlier = viewOf(documents.at(-1)![1]).navigation.flatMap((group) => group.items);
    expect(earlier.find((entry) => entry.id === "ui_elements")?.state).toBe("not_covered");
  });

  it("shows dependencies and scripts in shared tables, and CI steps with their definition", () => {
    const view = viewOf(documents.find(([name]) => name === "orders")![1]);
    const blocks = view.groups.flatMap((group) => group.blocks);
    const dependencies = blocks.find((block) => block.kind === "dependencies");
    expect(dependencies && dependencies.kind === "dependencies" && dependencies.sources.map((source) => [source.definition.id, source.state])).toEqual([
      ["dependencies", "observed"],
      ["resolved_dependencies", "unknown"],
      ["packages_consumed", "observed"],
    ]);
    // No lockfile resolves axios, so its Resolved cell is unknown, never none detected.
    const axios = dependencies?.kind === "dependencies" ? dependencies.groups[0]!.rows[0]! : null;
    expect(axios?.cells[3]).toMatchObject({ kind: "none", value: { state: "unknown" } });
    expect(blocks.filter((block) => block.kind === "category").map((block) => block.kind === "category" && block.heading.definition.id)).not.toContain("resolved_dependencies");

    const ci = blocks.find((block) => block.kind === "category" && block.heading.definition.id === "ci_systems");
    expect(ci?.kind === "category" && ci.stepsColumn).toBe("Steps");
    expect(ci?.kind === "category" && ci.rows[0]!.steps.map((step) => [step.text, step.secondary])).toEqual([["npm test", "ci · step 1 · Test"]]);

    const scripts = blocks.find((block) => block.kind === "scripts");
    expect(scripts?.kind === "scripts" && scripts.groups[0]!.rows.map((row) => [row.name, row.cells[2]])).toEqual([
      ["start", { kind: "value", cell: { text: "None" }, state: null }],
      ["test", { kind: "value", cell: { text: "Test" }, state: null }],
    ]);
  });

  it("shows facts a reader couldn't tell apart as one row that counts them and keeps every fact and location", () => {
    const orders = documents.find(([name]) => name === "orders")![1];
    const evidence = Object.keys(orders.evidence ?? {}).slice(0, 3);
    const stub = (key: string, ref: string) => ({ key, state: "observed", value: { kind: "global_stub", global: "fetch" }, evidence: [ref], rule: "test-substitutes.global-stub" });
    const search = orders.categories.test_substitutes?.search ?? { complete: true, rules: [], surface: [], skipped: [] };
    const document = { ...orders, categories: { ...orders.categories, test_substitutes: { state: "observed", search, facts: [stub("a.test.ts", evidence[0]!), stub("b.test.ts", evidence[1]!), stub("c.test.ts", evidence[2]!)] } } } as FactDocument;
    const block = viewOf(document).groups.flatMap((group) => group.blocks).find((candidate) => candidate.kind === "category" && candidate.heading.definition.id === "test_substitutes");
    expect(block?.kind === "category" && block.rows).toHaveLength(1);
    const row = block?.kind === "category" ? block.rows[0]! : null;
    expect(row?.occurrences).toBe(3);
    expect(row?.held.map((held) => held.fact.key)).toEqual(["a.test.ts", "b.test.ts", "c.test.ts"]);
    expect(row?.evidence).toEqual(evidence);
  });

  it("pages a shared table in manifest order, each group keeping its full count", () => {
    const row = (name: string) => ({ id: name, name, manifest: null, field: null, cells: [], held: [], evidence: [] });
    const block: SharedBlock = { kind: "scripts", sources: [], columns: [], groups: [{ manifest: "a", rows: ["1", "2", "3"].map(row) }, { manifest: "b", rows: ["4", "5"].map(row) }] };
    expect(pageOfGroups(block, 1, 2).groups.map((group) => [group.manifest, group.rows.map((entry) => entry.name), group.total])).toEqual([["a", ["1", "2"], 3]]);
    expect(pageOfGroups(block, 2, 2).groups.map((group) => [group.manifest, group.rows.map((entry) => entry.name), group.total])).toEqual([["a", ["3"], 3], ["b", ["4"], 2]]);
    expect(pageOfGroups(block, 3, 2).groups.map((group) => [group.manifest, group.rows.map((entry) => entry.name), group.total])).toEqual([["b", ["5"], 2]]);
  });

  it("summarizes each Service Dependency by its endpoint, client, and first call site", () => {
    const [service] = viewOf(documents.find(([name]) => name === "orders")![1]).services;
    expect(service).toMatchObject({ endpoint: { text: "https://payments.invalid", resolved: true }, client: "fetch", moreCallSites: 0 });
    expect(service!.callSite).toMatch(/^ev_/);
  });
});
