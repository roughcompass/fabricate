import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getRun, targetsOf } from "@/lib/runs/run-records";
import { launchRun } from "@/lib/runs/launcher";
import { drainJobs } from "@/lib/jobs/worker";
import { jobHandlers } from "@/lib/jobs/registry";
import { surveyById } from "@/lib/surveys/records";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { buildAssessment } from "../support/builders";

// Surveyor throws whatever the test sets: JavaScript code can throw any value, not only an Error.
const thrown = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/profiles/analyze", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profiles/analyze")>()),
  surveyDocument: async () => {
    throw thrown.value;
  },
}));

describe("a thrown value that isn't an Error", () => {
  const world = useAcquisitionWorld("thrown-values");

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "the detector gave up"],
    ["a number", 42],
  ])("fails the survey and the target waiting on it with the value in words instead of crashing (%s)", async (_label, value) => {
    thrown.value = value;
    const work = world.fixture.repo("fleet/orders");
    work.write("README.md", "orders\n").commit();
    const repository = registerLocalRepository(world.db, world.config, "orders", work.path);
    const { run } = launchRun(world.db, buildAssessment(world.db, { repositories: [repository] }).publicId, crypto.randomUUID(), world.config);

    // The target resolves and joins its survey; the survey pins the commit, then Surveyor throws.
    await drainJobs(world.db, jobHandlers(world.db, world.config));
    const [target] = targetsOf(world.db, run.id);

    expect(surveyById(world.db, target!.surveyId!)).toMatchObject({ state: "failed", failureCode: "analysis_failed", failureMessage: String(value), internalRef: expect.any(String) });
    expect(target).toMatchObject({ state: "failed", failureCode: "analysis_failed", failureMessage: String(value) });
    expect(getRun(world.db, run.publicId).state).toBe("failed");
  });
});
