import { describe, expect, it } from "vitest";
import { criterionScores, higherScores } from "@/lib/prototypes/compare";
import { diffFile, diffLines } from "@/lib/prototypes/diff";
import type { FitReview, PersonaReview } from "@/lib/prototypes/types";

// prototypes/versions spec, "Two versions can be compared side by side".

const lines = (count: number, change?: [number, string]) => Array.from({ length: count }, (_, index) => (change && change[0] === index ? change[1] : `line ${index + 1}`)).join("\n");

describe("code changes", () => {
  it("lists removed before added lines, numbered in each version", () => {
    expect(diffLines("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { kind: "same", text: "a", before: 1, after: 1 },
      { kind: "removed", text: "b", before: 2, after: null },
      { kind: "added", text: "B", before: null, after: 2 },
      { kind: "same", text: "c", before: 3, after: 3 },
      { kind: "added", text: "d", before: null, after: 4 },
    ]);
  });

  it("groups changes into hunks with three lines of context, and has none for identical files", () => {
    const diff = diffFile("Prototype.tsx", lines(40), lines(40, [4, "changed"]).replace("line 31", "changed too"));
    expect(diff).toMatchObject({ added: 2, removed: 2 });
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[0]!.map((line) => line.before ?? line.after)).toEqual([2, 3, 4, 5, 5, 6, 7, 8]);
    expect(diffFile("data.ts", lines(5), lines(5)).hunks).toEqual([]);
  });
});

describe("fit comparison", () => {
  const review = (clarity: 4 | 5 | "unknown", intent: 3 | 4 = 4): FitReview => ({
    status: "reviewed",
    model: "mock",
    average: null,
    at: "2026-10-16T09:00:00.000Z",
    personas: [
      { personaId: "per_a", personaName: "Maya", criteria: { intent: { score: intent, reason: "" }, goals: { score: 5, reason: "" }, constraints: { score: 4, reason: "" }, clarity: { score: clarity, reason: "" } }, checks: [], strengths: [], gaps: [] } satisfies PersonaReview,
    ],
  });

  it("marks the higher score on each criterion, and neither on a tie or an unknown score", () => {
    expect(higherScores(review(4, 3), review(5))).toEqual({ intent: "b", goals: null, constraints: null, clarity: "b" });
    expect(higherScores(review("unknown"), review(5)).clarity).toBeNull();
    expect(criterionScores(null)).toEqual({ intent: null, goals: null, constraints: null, clarity: null });
  });
});
