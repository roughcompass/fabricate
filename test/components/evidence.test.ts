import type { JsonObject } from "@repo-facts/contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceList, evidenceLocation } from "@/components/results/evidence";

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

  it("names each record's detector and rule unless told not to", () => {
    const list = (source?: boolean) => renderToStaticMarkup(createElement(EvidenceList, { ids: ["ev_1"], records: RECORDS, assessmentId: "asm_1", source }));
    expect(list()).toContain("package-metadata · manifest.dependencies");
    expect(list(false)).not.toContain("package-metadata");
    expect(list(false)).not.toContain("manifest.dependencies");
    expect(list(false)).toContain("package.json /dependencies/@clack/prompts");
  });
});
