import type { JsonObject } from "@repo-facts/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { type LoadedProfile, rowEvidence } from "@/lib/profiles/evidence";
import { profileDiagnostics } from "@/lib/profiles/profile-records";
import { type FactDocument, categoryDefinitions } from "@/lib/profiles/states";
import { profileView } from "@/lib/profiles/view";
import { analyzedFacts } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

const loaded = (document: FactDocument): LoadedProfile => ({
  publicId: "prf_0000000000000000",
  assessmentId: "asm_0000000000000000",
  view: profileView(document, profileDiagnostics({ fact_document: document as never })),
  records: (document.evidence ?? {}) as JsonObject,
  labels: new Map(categoryDefinitions(document).map((definition) => [definition.id, definition.label])),
});

describe("A row's evidence panel", () => {
  let orders: FactDocument;
  beforeAll(async () => {
    orders = await analyzedFacts({
      "package.json": manifest({ name: "orders", version: "1.0.0", dependencies: { axios: "^1.6.0" } }),
      "yarn.lock": "# yarn lockfile v1\n\n",
      "src/payments.ts": 'import axios from "axios";\nexport const charge = () => axios.post("https://payments.invalid/v1/charges");\n',
    });
  });

  it("finds a category's row by its id, with each fact's locations, key, and raw value", () => {
    const yarn = orders.categories.package_managers!.facts[0]!;
    const evidence = rowEvidence(loaded(orders), "package_managers", yarn.key);
    expect(evidence?.assessmentId).toBe("asm_0000000000000000");
    expect(evidence?.sections).toEqual([
      {
        label: null,
        locations: yarn.evidence.map((id) => ({ id, location: expect.any(String) })),
        keys: [yarn.key],
        moreKeys: 0,
        rule: null,
        reasoning: null,
        raw: JSON.stringify(yarn.value, null, 2),
      },
    ]);
    expect(evidence?.sections[0]!.locations.map((location) => location.location)).toContain("yarn.lock");
  });

  it("finds a shared table's row by its kind, naming each category whose fact it holds", () => {
    const view = loaded(orders).view;
    const block = view.tabs.flatMap((tab) => tab.blocks).find((candidate) => candidate.kind === "dependencies");
    const axios = block?.kind === "dependencies" ? block.groups.flatMap((group) => group.rows).find((row) => row.name === "axios") : undefined;
    const evidence = rowEvidence(loaded(orders), "dependencies", axios!.id);
    expect(evidence?.sections.map((section) => [section.label, section.keys.length])).toEqual([
      ["Dependencies", 1],
      ["Packages consumed", 1],
    ]);
  });

  it("lists a merged row's locations once, with the keys of the facts that share its value", () => {
    const refs = Object.keys(orders.evidence ?? {}).slice(0, 2);
    const stub = (key: string, ref: string) => ({ key, state: "observed", value: { kind: "global_stub", global: "fetch" }, evidence: [ref], rule: "test-substitutes.global-stub" });
    const search = { complete: true, rules: [], surface: [], skipped: [] };
    const document = { ...orders, categories: { ...orders.categories, test_substitutes: { state: "observed", search, facts: [stub("a.test.ts", refs[0]!), stub("b.test.ts", refs[1]!)] } } } as FactDocument;
    const evidence = rowEvidence(loaded(document), "test_substitutes", "a.test.ts");
    expect(evidence?.sections).toHaveLength(1);
    expect(evidence?.sections[0]).toMatchObject({ label: null, keys: ["a.test.ts", "b.test.ts"], moreKeys: 0, locations: refs.map((id) => ({ id })) });
  });

  it("finds nothing for a table or row the Profile doesn't have", () => {
    expect(rowEvidence(loaded(orders), "package_managers", "nope")).toBeUndefined();
    expect(rowEvidence(loaded(orders), "nope", "yarn")).toBeUndefined();
    expect(rowEvidence(loaded(orders), "compact", "yarn")).toBeUndefined();
  });
});
