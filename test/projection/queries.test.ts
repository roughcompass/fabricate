import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Assessment } from "@/lib/assessments/assessment-records";
import type { Db } from "@/lib/db/client";
import { missingTargets } from "@/lib/projection/queries";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { pinnedRepository } from "../support/projection";
import { seedAssessment } from "../support/scenarios";

// Every stored document is read through readDocument; once +forbid+ is set, a read fails the test.
const guard = vi.hoisted(() => ({ forbid: false }));
vi.mock("@/lib/documents/digested", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/digested")>();
  return {
    ...actual,
    readDocument: (...args: Parameters<typeof actual.readDocument>) => {
      if (guard.forbid) throw new Error(`A stored document was read: ${args[2]}`);
      return actual.readDocument(...args);
    },
  };
});

describe("projection queries", () => {
  let db: Db;
  let assessment: Assessment;

  beforeEach(async () => {
    guard.forbid = false;
    db = createTestDb();
    const sources = [buildSource(db, { name: "web" }), buildSource(db, { name: "client" }), buildSource(db, { name: "admin" }), buildSource(db, { name: "billing" })];
    assessment = await seedAssessment(db, buildInitiative(db, { sources }), sources, [
      pinnedRepository("web", { "@acme/client": "1.0.0", react: "16.14.0" }),
      pinnedRepository("@acme/client", { react: "18.3.1" }),
      pinnedRepository("admin", { react: "16.8.6" }),
      "failed",
    ]);
  });

  it("reports a failed target as missing, without reading a document (Failed target)", () => {
    guard.forbid = true;

    expect(missingTargets(db, assessment.id)).toEqual([{ target: expect.stringMatching(/^tgt_/), source: "billing", state: "failed", reason: expect.any(String) }]);
  });
});
