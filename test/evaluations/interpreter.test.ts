import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { type Context, EvaluationLimitError, type Reading, type Truth, and, evaluate, not, or, traceEvidence, unknownCauses } from "@/lib/evaluations/interpreter";

const TRUTHS: Truth[] = ["true", "false", "unknown"];

/** A context whose selectors return fixed readings, and whose collections hold fixed items. */
function stub(readings: Record<string, Partial<Reading>>, collections: Record<string, { items: Record<string, Partial<Reading>>[]; unseen?: Record<string, Partial<Reading>>[] }> = {}): Context {
  const reading = (value: Partial<Reading> | undefined): Reading => ({ known: true, value: null, complete: true, reason: null, evidence: [], ...value });
  const make = (values: Record<string, Partial<Reading>>, nested = collections): Context => ({
    scope: "repository",
    read: (selector, parameter) => reading(values[parameter ? `${selector}(${parameter})` : selector] ?? { known: false, reason: `${selector} is not established` }),
    collection: (id) => ({
      items: (nested[id]?.items ?? []).map((item, index) => ({ subject: `${id}-${index}`, context: make(item, {}) })),
      unseen: (nested[id]?.unseen ?? []).map((item) => ({ reason: "A repository without a Profile may add items", context: make(item, {}) })),
    }),
  });
  return make(readings);
}

const run = (expression: JsonValue, context: Context) => evaluate(expression, context).result;
const field = (selector: string, extra: JsonObject = {}): JsonObject => ({ op: "exists", selector, ...extra });

describe("three-valued logic", () => {
  it.each(TRUTHS.flatMap((a) => TRUTHS.map((b) => [a, b] as const)))("combines %s and %s with Kleene all and any", (a, b) => {
    const expectedAnd: Truth = a === "false" || b === "false" ? "false" : a === "unknown" || b === "unknown" ? "unknown" : "true";
    const expectedOr: Truth = a === "true" || b === "true" ? "true" : a === "unknown" || b === "unknown" ? "unknown" : "false";
    expect(and([a, b])).toBe(expectedAnd);
    expect(or([a, b])).toBe(expectedOr);
  });

  it("negates true and false and keeps unknown unknown", () => {
    expect(TRUTHS.map(not)).toEqual(["false", "true", "unknown"]);
  });

  it("propagates unknown through nested groups without collapsing it", () => {
    const context = stub({ yes: { value: true }, no: { value: false } });
    const unknownLeaf = field("missing");
    expect(run({ op: "all", items: [{ op: "equals", selector: "yes", value: true }, unknownLeaf] }, context)).toBe("unknown");
    expect(run({ op: "all", items: [{ op: "equals", selector: "no", value: true }, unknownLeaf] }, context)).toBe("false");
    expect(run({ op: "any", items: [{ op: "equals", selector: "yes", value: true }, unknownLeaf] }, context)).toBe("true");
    expect(run({ op: "not", item: { op: "any", items: [unknownLeaf] } }, context)).toBe("unknown");
    expect(run({ op: "always" }, context)).toBe("true");
  });
});

describe("predicates", () => {
  const context = stub({
    flag: { value: true },
    none: { value: null },
    name: { value: "configured" },
    count: { value: 3 },
    complete: { value: ["pnpm"], complete: true },
    partial: { value: ["pnpm"], complete: false },
    empty: { value: [], complete: true },
    emptyPartial: { value: [], complete: false },
    "version(react)": { value: ["18.3.1"], complete: true },
    ranges: { value: [">=24.0.0 <25.0.0-0"], complete: true },
    conflict: { value: [], alternatives: [[">=20.0.0"], ["18"]], complete: true },
    agreed: { value: [], alternatives: [[">=20.0.0"], [">=21.0.0"]], complete: true },
    invalid: { value: ["workspace:*"], complete: true },
  });

  it.each<[string, JsonObject, Truth]>([
    ["exists on a set value", field("flag"), "true"],
    ["exists on null", field("none"), "false"],
    ["exists on a complete empty set", field("empty"), "false"],
    ["exists on an incomplete empty set", field("emptyPartial"), "unknown"],
    ["equals", { op: "equals", selector: "count", value: 3 }, "true"],
    ["equals a different value", { op: "equals", selector: "name", value: "literal" }, "false"],
    ["membership", { op: "in", selector: "name", values: ["configured", "host_provided"] }, "true"],
    ["membership of null", { op: "in", selector: "none", values: ["configured"] }, "false"],
    ["an ordered comparison", { op: "compare", selector: "count", comparator: "lte", value: 3 }, "true"],
    ["a comparison with no value", { op: "compare", selector: "none", comparator: "gte", value: 1 }, "false"],
    ["containment found", { op: "contains", selector: "partial", mode: "any", values: ["pnpm", "npm"] }, "true"],
    ["containment missing from a complete set", { op: "contains", selector: "complete", mode: "any", values: ["npm"] }, "false"],
    ["containment missing from an incomplete set", { op: "contains", selector: "partial", mode: "any", values: ["npm"] }, "unknown"],
    ["containment of all values", { op: "contains", selector: "complete", mode: "all", values: ["pnpm", "npm"] }, "false"],
    ["an exact version in range", { op: "semver_satisfies", selector: "version", parameter: "react", range: ">=18.0.0" }, "true"],
    ["an exact version out of range", { op: "semver_satisfies", selector: "version", parameter: "react", range: ">=19.0.0" }, "false"],
    ["a declared range within a range", { op: "semver_satisfies", selector: "ranges", range: ">=20.0.0" }, "true"],
    ["conflicting declarations that disagree", { op: "semver_satisfies", selector: "conflict", range: ">=20.0.0" }, "unknown"],
    ["conflicting declarations that agree", { op: "semver_satisfies", selector: "agreed", range: ">=20.0.0" }, "true"],
    ["a version that is not semantic", { op: "semver_satisfies", selector: "invalid", range: ">=1.0.0" }, "unknown"],
    ["no versions when the search is complete", { op: "semver_satisfies", selector: "empty", range: ">=1.0.0" }, "false"],
    ["an unknown reading", { op: "equals", selector: "missing", value: true }, "unknown"],
  ])("evaluates %s", (_name, expression, expected) => {
    expect(run(expression, context)).toBe(expected);
  });

  it("records what each predicate read, why it is unknown, and its evidence", () => {
    const withEvidence = stub({ managers: { value: ["npm"], complete: false, evidence: ["ev_aaaaaaaaaaaaaaaaaaaaaaaa"], reason: "The package managers evidence is incomplete" } });
    const trace = evaluate({ op: "all", items: [{ op: "contains", selector: "managers", mode: "any", values: ["pnpm"] }, field("missing")] }, withEvidence);

    expect(trace.children![0]).toMatchObject({ op: "contains", selector: "managers", observed: ["npm"], complete: false, result: "unknown", reason: "The package managers evidence is incomplete", evidence: ["ev_aaaaaaaaaaaaaaaaaaaaaaaa"] });
    expect(traceEvidence(trace)).toEqual(["ev_aaaaaaaaaaaaaaaaaaaaaaaa"]);
    expect(unknownCauses(trace).map((cause) => cause.reason)).toEqual(["The package managers evidence is incomplete", "missing is not established"]);
  });
});

describe("quantifiers", () => {
  const items = [{ kind: { value: "http" }, ok: { value: true } }, { kind: { value: "http" }, ok: { value: false } }, { kind: { value: "websocket" }, ok: { value: false } }, { kind: { value: "http" }, ok: { known: false, reason: "not established" } }];
  const context = (unseen: Record<string, Partial<Reading>>[] = []) => stub({}, { services: { items, unseen } });
  const where = { op: "equals", selector: "kind", value: "websocket" };

  it("reads every and some item by item, with the filter as an implication", () => {
    expect(run({ op: "every", collection: "services", where, condition: { op: "equals", selector: "ok", value: false } }, context())).toBe("true");
    expect(run({ op: "every", collection: "services", condition: { op: "equals", selector: "ok", value: true } }, context())).toBe("false");
    expect(run({ op: "some", collection: "services", condition: { op: "equals", selector: "ok", value: true } }, context())).toBe("true");
    expect(run({ op: "some", collection: "services", where, condition: { op: "equals", selector: "ok", value: true } }, context())).toBe("false");
  });

  it("keeps an item whose condition is unknown from deciding every or some", () => {
    const onlyUnknown = stub({}, { services: { items: [items[0]!, items[3]!] } });
    expect(run({ op: "every", collection: "services", condition: { op: "equals", selector: "ok", value: true } }, onlyUnknown)).toBe("unknown");
    expect(run({ op: "some", collection: "services", condition: { op: "equals", selector: "ok", value: false } }, onlyUnknown)).toBe("unknown");
  });

  it("treats items that may exist unseen as unknown, unless the filter rules them out", () => {
    const hidden = [{ kind: { known: false, reason: "not profiled" } }];
    expect(run({ op: "some", collection: "services", where, condition: { op: "equals", selector: "ok", value: true } }, context(hidden))).toBe("unknown");
    expect(run({ op: "every", collection: "services", where, condition: { op: "equals", selector: "ok", value: false } }, context(hidden))).toBe("unknown");
    // An unseen item the filter excludes cannot change the result.
    const excluded = [{ kind: { value: "http" } }];
    expect(run({ op: "some", collection: "services", where, condition: { op: "equals", selector: "ok", value: true } }, context(excluded))).toBe("false");
  });

  it("counts definite and possible matches, deciding only when every possible count agrees", () => {
    const failing = { op: "equals", selector: "ok", value: false };
    const definite = stub({}, { services: { items: items.slice(0, 3) } });
    const count = (comparator: string, value: number, unseen: Record<string, Partial<Reading>>[] = []) => evaluate({ op: "count", collection: "services", where: failing, comparator, value }, stub({}, { services: { items: items.slice(0, 3), unseen } }));
    expect(evaluate({ op: "count", collection: "services", where: failing, comparator: "eq", value: 2 }, definite)).toMatchObject({ result: "true", count: { definite: 2, possible: 0 } });
    expect(count("gt", 2).result).toBe("false");
    // The fourth item may or may not match, so the count is 2 or 3.
    expect(evaluate({ op: "count", collection: "services", where: failing, comparator: "eq", value: 2 }, context())).toMatchObject({ result: "unknown", count: { definite: 2, possible: 1 } });
    expect(evaluate({ op: "count", collection: "services", where: failing, comparator: "lte", value: 3 }, context()).result).toBe("true");
    // With unseen items, the count has no upper bound.
    expect(count("gte", 1, [{}]).result).toBe("true");
    expect(count("eq", 0, [{}]).result).toBe("false");
    expect(count("lte", 5, [{}]).result).toBe("unknown");
  });
});

describe("limits", () => {
  it("refuses expressions nested past the depth limit and groups past the size limit", () => {
    let deep: JsonObject = { op: "always" };
    for (let level = 0; level < 9; level++) deep = { op: "not", item: deep };
    expect(() => evaluate(deep, stub({}))).toThrow(EvaluationLimitError);
    expect(() => evaluate({ op: "any", items: Array.from({ length: 17 }, () => ({ op: "always" })) }, stub({}))).toThrow(EvaluationLimitError);
  });

  it("refuses an operator outside the closed set instead of interpreting it", () => {
    expect(() => evaluate({ op: "script", source: "process.exit(1)" }, stub({}))).toThrow(/Unsupported operator "script"/);
  });
});
