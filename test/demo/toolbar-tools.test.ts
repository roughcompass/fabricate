import { describe, expect, it } from "vitest";
import { type RawViolation, guidanceLines, summarize } from "@/demo/toolbar/accessibility/audit";
import { parsePayload, topicError } from "@/demo/toolbar/bus-publish";
import { type Interaction, type WaterfallLoad, formatVital, interactionToNextPaint, rate, rateVital, slowestInteraction, waterfall } from "@/demo/toolbar/timing/timing";

const violation = (id: string, impact: string, nodes: string[]): RawViolation => ({
  id,
  impact,
  help: `${id} help`,
  description: `${id} description`,
  nodes: nodes.map((selector) => ({ target: [selector], html: `<x id="${selector}">`, failureSummary: "Fix any of the following:\n  Element has no label\n  Element has no title" })),
});

describe("accessibility audit report", () => {
  const attribute = (selector: string) => (selector.startsWith("#payee") ? { member: "payee-list", memberName: "Payee list", version: "1.4.2" } : { member: "payments-shell", memberName: "Payments portal shell", version: "4.2.0" });

  it("orders results by impact, numbers them, and totals affected elements by impact", () => {
    const report = summarize([violation("color-contrast", "serious", ["#payee-a", "#payee-b"]), violation("label", "critical", ["#payee-search"]), violation("region", "moderate", ["#footer"])], attribute);
    expect(report.results.map((result) => [result.number, result.rule, result.impact])).toEqual([
      [1, "label", "critical"],
      [2, "color-contrast", "serious"],
      [3, "region", "moderate"],
    ]);
    expect(report.totals).toEqual({ critical: 1, serious: 2, moderate: 1, minor: 0 });
  });

  it("attributes every element to its microfrontend and version, and keeps guidance without repeats", () => {
    const [label, region] = summarize([violation("label", "critical", ["#payee-search", "#payee-amount"]), violation("region", "minor", ["#footer"])], attribute).results;
    expect(label!.nodes.map((node) => [node.selector, node.member, node.version])).toEqual([
      ["#payee-search", "payee-list", "1.4.2"],
      ["#payee-amount", "payee-list", "1.4.2"],
    ]);
    expect(region!.nodes[0]).toMatchObject({ member: "payments-shell", memberName: "Payments portal shell" });
    expect(label!.guidance).toEqual(["Element has no label", "Element has no title"]);
    expect(label!.title).toBe("label help");
    expect(label!.description).toBe("label description");
  });

  it("reports nothing for a clean page and treats an unknown impact as minor", () => {
    expect(summarize([], attribute)).toEqual({ totals: { critical: 0, serious: 0, moderate: 0, minor: 0 }, results: [] });
    expect(summarize([violation("odd", "unknown", ["#x"])], attribute).results[0]!.impact).toBe("minor");
    expect(guidanceLines("Fix all of the following:\n  A\nFix any of the following:\n  B")).toEqual(["A", "B"]);
  });
});

describe("timing tool", () => {
  it("rates interactions at the 200 and 500 millisecond thresholds", () => {
    expect([0, 200, 201, 500, 501, 650].map(rate)).toEqual(["good", "good", "needs-improvement", "needs-improvement", "poor", "poor"]);
  });

  const loads: WaterfallLoad[] = [
    { member: "shell", version: "4.2.0", startMs: 0, durationMs: 180, kind: "load" },
    { member: "payee-list", version: "1.4.2", startMs: 180, durationMs: 420, kind: "load" },
    { member: "transfer-form", version: "3.0.1", startMs: 260, durationMs: 380, kind: "load" },
    { member: "payment-activity", version: "2.3.0", startMs: 340, durationMs: 1300, kind: "load" },
    { member: "payee-list", version: "2.0.0", startMs: 4000, durationMs: 600, kind: "swap", from: "1.4.2" },
  ];

  it("lists loads in start order with the slowest flagged and swaps kept with their origin", () => {
    const rows = waterfall(loads);
    expect(rows.map((row) => row.member)).toEqual(["shell", "payee-list", "transfer-form", "payment-activity", "payee-list"]);
    expect(rows.filter((row) => row.slowest).map((row) => row.member)).toEqual(["payment-activity"]);
    expect(rows[4]).toMatchObject({ kind: "swap", from: "1.4.2" });
    expect(rows[4]!.offset + rows[4]!.width).toBeCloseTo(1);
  });

  const interaction = (id: number, member: string, durationMs: number): Interaction => ({ id, kind: "Click", target: "button", member, durationMs, approximate: false });

  it("summarizes the slowest interaction", () => {
    expect(slowestInteraction([])).toBeNull();
    expect(slowestInteraction([interaction(1, "payee-list", 40), interaction(2, "payment-activity", 656), interaction(3, "transfer-form", 24)])!.id).toBe(2);
  });

  it("keeps a load still in progress in order and unflagged", () => {
    const pending: WaterfallLoad[] = [...loads.slice(0, 3), { member: "payment-activity", version: "2.3.0", startMs: 340, durationMs: null, kind: "load" }];
    const rows = waterfall(pending);
    expect(rows.map((row) => row.member)).toEqual(["shell", "payee-list", "transfer-form", "payment-activity"]);
    expect(rows.filter((row) => row.slowest).map((row) => row.member)).toEqual(["payee-list"]);
    expect(rows[3]!.width).toBe(0.01);
  });

  it("computes INP as the slowest interaction, less one outlier for every 50", () => {
    expect(interactionToNextPaint([])).toBeNull();
    expect(interactionToNextPaint([interaction(1, "payee-list", 40), interaction(2, "payment-activity", 656), interaction(3, "transfer-form", 24)])).toBe(656);
    const many = Array.from({ length: 60 }, (_, index) => interaction(index, "payee-list", index === 7 ? 900 : 100 + index));
    expect(interactionToNextPaint(many)).toBe(159);
  });

  it("rates Web Vitals at the published thresholds and formats layout shift as a score", () => {
    expect([2500, 2501, 4000, 4001].map((value) => rateVital("LCP", value))).toEqual(["good", "needs-improvement", "needs-improvement", "poor"]);
    expect([0.1, 0.11, 0.25, 0.3].map((value) => rateVital("CLS", value))).toEqual(["good", "needs-improvement", "needs-improvement", "poor"]);
    expect([800, 1800, 1801].map((value) => rateVital("TTFB", value))).toEqual(["good", "needs-improvement", "poor"]);
    expect(formatVital("CLS", 0.04321)).toBe("0.04");
    expect(formatVital("LCP", 1834.6)).toBe("1,835 ms");
  });
});

describe("publishing from the toolbar", () => {
  it("accepts JSON payloads and explains anything else", () => {
    expect(parsePayload('{"symbol": "ACME"}')).toEqual({ ok: true, payload: { symbol: "ACME" } });
    expect(parsePayload("42")).toEqual({ ok: true, payload: 42 });
    expect(parsePayload("{symbol: ACME}")).toEqual({ ok: false, error: 'The payload must be valid JSON, such as {"symbol": "ACME"}.' });
    expect(parsePayload("")).toMatchObject({ ok: false });
  });

  it("accepts colon-separated lowercase topics only", () => {
    expect(topicError("instrument:selected")).toBeNull();
    expect(topicError("audit")).toBeNull();
    expect(topicError("Instrument Selected")).toMatch(/lowercase/);
    expect(topicError("a:")).not.toBeNull();
    expect(topicError(`a${"b".repeat(60)}`)).not.toBeNull();
  });
});
