import fs from "node:fs";
import path from "node:path";
import { type JsonObject, type JsonValue, dump, parseCanonical } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { canonicalStandard, standardDigest } from "@/lib/standards/canonical";
import { LIMITS, OPERATORS, OPERATORS_BY_TYPE } from "@/lib/standards/document";
import { COLLECTIONS, SCOPES, SELECTORS, SUPPORTED_VERSIONS, VALUE_TYPES, schemaOfScope } from "@/lib/standards/registry";
import { blankDraftDocument } from "@/lib/standards/standard-records";
import { validateStandard } from "@/lib/standards/validate";
import { sampleStandard } from "../support/standards";

/** A deep copy with every object's keys inserted in reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversedKeys(item)]));
  return value;
}

/** Every operator used anywhere in a document. */
function operatorsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) operatorsIn(item, found);
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.op === "string") found.add(record.op);
    for (const item of Object.values(record)) operatorsIn(item, found);
  }
  return found;
}

describe("schema registries", () => {
  it("define each selector once, in a known scope and type, reading a supported schema version", () => {
    const ids = SELECTORS.map((selector) => selector.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const selector of SELECTORS) {
      expect(SCOPES).toContain(selector.scope);
      expect(VALUE_TYPES).toContain(selector.type);
      expect(selector.schema).toBe(schemaOfScope(selector.scope));
      for (const version of selector.versions) expect(SUPPORTED_VERSIONS[selector.schema]).toContain(version);
      expect(OPERATORS_BY_TYPE[selector.type].length).toBeGreaterThan(0);
    }
  });

  it("define collections whose items are read in a scope that has selectors", () => {
    for (const collection of COLLECTIONS) {
      expect(collection.schema).toBe(schemaOfScope(collection.scope));
      expect(SELECTORS.some((selector) => selector.scope === collection.item)).toBe(true);
    }
  });

  it("are documented: docs/standards.md names every operator, selector, and collection", () => {
    const docs = fs.readFileSync(path.join(process.cwd(), "docs/standards.md"), "utf8");
    for (const name of [...OPERATORS, ...SELECTORS.map((selector) => selector.id), ...COLLECTIONS.map((collection) => collection.id)]) expect(docs, name).toContain(`\`${name}\``);
  });
});

describe("Standard documents", () => {
  it("cover every operator in a valid Standard", () => {
    expect(validateStandard(sampleStandard())).toEqual([]);
    expect([...operatorsIn(sampleStandard())].sort()).toEqual([...OPERATORS].sort());
  });

  it("start as a blank draft that needs only Controls", () => {
    expect(validateStandard(blankDraftDocument())).toEqual([{ field: "controls", message: "Add at least one Control" }]);
  });

  it("serialize stably: equivalent documents share one canonical form and digest", () => {
    const standard = sampleStandard();
    const shuffled = structuredClone(standard) as { controls: { applicability: JsonObject; condition: { items?: JsonValue[]; values?: string[] } }[] };
    shuffled.controls.reverse();
    const pnpm = shuffled.controls.find((control) => (control as unknown as { key: string }).key === "pnpm-only")!;
    pnpm.condition.items!.reverse();
    const languages = pnpm.applicability as { values: string[] };
    languages.values = ["JavaScript", "TypeScript", "JavaScript"];

    expect(standardDigest(reversedKeys(shuffled) as JsonValue)).toBe(standardDigest(standard));
    expect(dump(canonicalStandard(reversedKeys(shuffled) as JsonValue))).toBe(dump(canonicalStandard(standard)));
    // A real change changes the digest.
    const changed = structuredClone(standard) as { controls: { severity: string }[] };
    changed.controls[0]!.severity = "low";
    expect(standardDigest(changed as unknown as JsonValue)).not.toBe(standardDigest(standard));
  });

  it("keep hostile names such as __proto__ and constructor inert", () => {
    const hostile = parseCanonical(
      dump({
        schema: "fabricate.standard",
        schema_version: 1,
        input_schemas: { repository_profile: [1], relationship_map: [] },
        controls: [{ key: "constructor", title: "t", rationale: "r", severity: "low", subject: "repository", applicability: { op: "always" }, condition: { op: "equals", selector: "__proto__", value: "constructor" }, guidance: null }],
      }).replace('"controls"', '"__proto__":{"polluted":true},"controls"'),
    );
    const canonical = canonicalStandard(hostile) as Record<string, unknown>;

    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(canonical)).toContain("__proto__");
    expect(dump(canonical)).toContain('"__proto__":{"polluted":true}');
    expect(standardDigest(hostile)).toBe(standardDigest(parseCanonical(dump(hostile))));
    // Validation reports the hostile field and selector as unsupported data.
    expect(validateStandard(hostile)).toEqual([
      { field: "document.__proto__", message: 'Unsupported field "__proto__"' },
      { field: "controls[0].condition.selector", message: 'Unknown field "__proto__"' },
    ]);
  });

  it("gives an invalid draft a stable digest too", () => {
    const draft = { ...blankDraftDocument(), controls: [{ key: "half-written", condition: { op: "any", items: [{ op: "exists" }, { op: "always" }] } }] } as JsonValue;
    expect(standardDigest(draft)).toBe(standardDigest(reversedKeys(draft) as JsonValue));
  });

  it("enforce hard depth and collection limits", () => {
    let deep: JsonObject = { op: "always" };
    for (let level = 0; level < LIMITS.depth; level++) deep = { op: "not", item: deep };
    const withCondition = (condition: JsonValue) => ({ ...sampleStandard(), controls: [{ ...(sampleStandard().controls as JsonObject[])[0]!, condition }] });

    expect(validateStandard(withCondition(deep))).toContainEqual({ field: expect.stringMatching(/\.item$/), message: `Expressions can nest at most ${LIMITS.depth} levels` });
    expect(validateStandard(withCondition({ op: "any", items: Array.from({ length: LIMITS.items + 1 }, () => ({ op: "always" })) }))).toContainEqual({ field: "controls[0].condition.items", message: `Combine at most ${LIMITS.items} conditions in one group` });
    expect(validateStandard(withCondition({ op: "contains", selector: "repository.languages", mode: "any", values: Array.from({ length: LIMITS.values + 1 }, (_, index) => `L${index}`) }))).toContainEqual({ field: "controls[0].condition.values", message: `Enter at most ${LIMITS.values} values` });
    const many = { ...sampleStandard(), controls: Array.from({ length: LIMITS.controls + 1 }, (_, index) => ({ ...(sampleStandard().controls as JsonObject[])[0]!, key: `control-${index}` })) };
    expect(validateStandard(many)).toContainEqual({ field: "controls", message: `A Standard can have at most ${LIMITS.controls} Controls` });
  });
});
