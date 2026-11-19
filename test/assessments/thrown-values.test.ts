import { describe, expect, it, vi } from "vitest";
import { recordSnapshot } from "@/lib/assessments/assessment-records";
import { processTarget } from "@/lib/assessments/orchestration";
import { transitionTarget } from "@/lib/assessments/transitions";
import { buildAssessment, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { sha1 } from "../support/profiles";

// Analysis throws whatever the test sets: JavaScript code can throw any value, not only an Error.
const thrown = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/profiles/analyze", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profiles/analyze")>()),
  analyzeSnapshot: async () => {
    throw thrown.value;
  },
}));

describe("a thrown value that isn't an Error", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "the detector gave up"],
    ["a number", 42],
  ])("fails its target with the value in words instead of crashing (%s)", async (_label, value) => {
    thrown.value = value;
    const db = createTestDb();
    const { targets } = buildAssessment(db, { sources: [buildSource(db, { name: "orders" })] });
    // Pinned already, so processing goes straight to analysis.
    const acquiring = transitionTarget(db, targets[0]!, "acquiring");
    recordSnapshot(db, acquiring, { commitSha: sha1("commit"), treeSha: sha1("tree"), refKind: "default_branch", resolvedRef: "refs/heads/main", acquisitionMetadata: {} });

    const target = await processTarget(db, acquiring.publicId);

    expect(target).toMatchObject({ state: "failed", failureCode: "analysis_failed", failureMessage: String(value) });
  });
});
