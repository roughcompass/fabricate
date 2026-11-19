import { describe, expect, it } from "vitest";
import { countLabel, formatBytes, formatNumber, percentOf } from "@/components/ui/count";
import { CONCLUSION_FILTERS, conclusionState } from "@/lib/evaluations/conclusions";
import { hasStatus } from "@/components/ui/status";

describe("counts", () => {
  it("writes numbers with thousands separators", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(3.456, { maximumFractionDigits: 1 })).toBe("3.5");
  });

  it("names a count with its noun, singular for one", () => {
    expect(countLabel(1, "Finding")).toBe("1 Finding");
    expect(countLabel(1500, "Repository", "Repositories")).toBe("1,500 Repositories");
    expect(countLabel(0, "runtime system")).toBe("0 runtime systems");
  });

  it("gives a whole-number share, 0 with no whole, and never more than 100", () => {
    expect(percentOf(130, 212)).toBe(61);
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 4)).toBe(100);
  });

  it("writes a size in its largest unit", () => {
    expect(formatBytes(356)).toBe("356 B");
    expect(formatBytes(3_584)).toBe("3.5 KB");
  });
});

describe("conclusion states", () => {
  it("shows each conclusion filter with a status the registry names, and none as Not evaluated", () => {
    expect(conclusionState("none")).toBe("not_evaluated");
    expect(conclusionState("gaps")).toBe("gaps");
    for (const filter of CONCLUSION_FILTERS) expect(hasStatus(conclusionState(filter)), filter).toBe(true);
  });
});
