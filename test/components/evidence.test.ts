import type { JsonObject } from "@repo-facts/contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceList } from "@/components/results/evidence";
import { evidenceLocation, evidenceLocations, sortedEvidence } from "@/lib/profiles/evidence-locations";
import type { EvidenceOwner } from "@/lib/web/routes";

const pointer = (value: string): JsonObject => ({ path: "package.json", location: { kind: "pointer", format: "json", pointer: value } });
const RECORDS: JsonObject = {
  ev_1: { ...pointer("/dependencies/@clack~1prompts"), detector: "package-metadata", rule: "manifest.dependencies" },
};

describe("evidence locations", () => {
  it("reads JSON-pointer escapes as the characters they stand for", () => {
    expect(evidenceLocation(pointer("/dependencies/@clack~1prompts"))).toBe("package.json /dependencies/@clack/prompts");
    expect(evidenceLocation(pointer("/scripts/a~0b"))).toBe("package.json /scripts/a~b");
    // ~01 is an escaped tilde followed by 1, not a slash.
    expect(evidenceLocation(pointer("/x~01"))).toBe("package.json /x~1");
    expect(evidenceLocation({ path: "src/a.ts", location: { kind: "lines", start: 3, end: 5 } })).toBe("src/a.ts:3–5");
  });

  it("lists a fact's locations by path, then line, whatever order the Profile cites them in", () => {
    const lines = (path: string, start: number, end = start): JsonObject => ({ path, location: { kind: "lines", start, end } });
    const records: JsonObject = {
      ev_d: lines("src/Payments.tsx", 6),
      ev_a: lines("src/Payments.stories.tsx", 2),
      ev_c: lines("src/Payments.tsx", 5, 9),
      ev_b: lines("src/Payments.tsx", 5),
      ev_e: pointer("/dependencies/react"),
      ev_f: { path: "package.json", location: { kind: "entry" } },
    };
    const expected = ["ev_f", "ev_e", "ev_a", "ev_b", "ev_c", "ev_d"];
    // Every citation order gives the same list.
    for (const cited of [["ev_d", "ev_a", "ev_c", "ev_b", "ev_e", "ev_f"], ["ev_f", "ev_e", "ev_d", "ev_c", "ev_b", "ev_a"], ["ev_b", "ev_d", "ev_a", "ev_f", "ev_c", "ev_e"]]) {
      expect(sortedEvidence(cited, records)).toEqual(expected);
    }
    expect(evidenceLocations(["ev_d", "ev_a", "ev_missing", "ev_b"], records).map((item) => item.location)).toEqual(["src/Payments.stories.tsx:2", "src/Payments.tsx:5", "src/Payments.tsx:6"]);
  });

  it("names each record's detector and rule unless told not to", () => {
    const list = (source?: boolean) => renderToStaticMarkup(createElement(EvidenceList, { ids: ["ev_1"], records: RECORDS, owner: { run: "asm_1" }, source }));
    expect(list()).toContain("package-metadata · manifest.dependencies");
    expect(list(false)).not.toContain("package-metadata");
    expect(list(false)).not.toContain("manifest.dependencies");
    expect(list(false)).toContain("package.json /dependencies/@clack/prompts");
  });

  it("links each location under its Run, or under its Profile when no Run reached it", () => {
    const list = (owner: EvidenceOwner) => renderToStaticMarkup(createElement(EvidenceList, { ids: ["ev_1"], records: RECORDS, owner }));
    expect(list({ run: "asm_1" })).toContain('href="/runs/asm_1/evidence/ev_1"');
    expect(list({ profile: "prf_1" })).toContain('href="/profiles/prf_1/evidence/ev_1"');
  });
});
