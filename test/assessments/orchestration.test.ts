import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireTarget } from "@/lib/acquisition/acquire";
import { getAssessment, snapshotOf, targetsOf } from "@/lib/assessments/assessment-records";
import { launchAssessment } from "@/lib/assessments/launcher";
import { finalizeAssessment, processTarget, requestFinalization } from "@/lib/assessments/orchestration";
import { requestCancellation, transitionTarget } from "@/lib/assessments/transitions";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { NonRetryableError, drainJobs } from "@/lib/jobs/worker";
import { jobHandlers } from "@/lib/jobs/registry";
import { profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { registerLocalSource, useAcquisitionWorld } from "../support/acquisition";
import { buildInitiative } from "../support/builders";
import { withSharedFileDb } from "../support/db";

describe("Assessment orchestration", () => {
  const world = useAcquisitionWorld("orchestration");

  function source(name: string, files: Record<string, string> = { "package.json": `{ "name": "${name}", "version": "1.0.0" }\n` }): RepositorySource {
    const work = world.fixture.repo(`fleet/${name}`);
    for (const [file, content] of Object.entries(files)) work.write(file, content);
    work.commit();
    return registerLocalSource(world.db, world.config, name, work.path);
  }

  function launch(sources: RepositorySource[], database: Db = world.db) {
    const initiative = buildInitiative(database, { sources });
    return launchAssessment(database, initiative.publicId, crypto.randomUUID(), world.config).assessment;
  }

  const run = (handlersConfig = world.config, limit?: number) => drainJobs(world.db, jobHandlers(world.db, handlersConfig), limit ? { limit } : {});
  const states = (assessmentId: number) => Object.fromEntries(targetsOf(world.db, assessmentId).map((target) => [target.sourceName, target.state]));

  describe("target jobs", () => {
    it("assess every target independently: a failed source neither blocks the others nor erases their Profiles", async () => {
      const [orders, billing, missing] = [source("orders"), source("billing"), source("gone")];
      fs.rmSync(path.join(world.fixture.root, "fleet/gone"), { recursive: true, force: true });
      const assessment = launch([orders, billing, missing]);

      await run();
      const done = getAssessment(world.db, assessment.publicId);
      expect(done.state).toBe("complete_with_issues");
      expect(states(done.id)).toEqual({ billing: "complete", gone: "failed", orders: "complete" });
      expect(targetsOf(world.db, done.id).find((target) => target.sourceName === "gone")).toMatchObject({ failureCode: "source_unavailable" });
      expect(profilesOf(world.db, done.id).map(({ target }) => target.sourceName).sort()).toEqual(["billing", "orders"]);
      const map = mapDocument(mapOf(world.db, done.id)!) as unknown as MapDocument;
      expect(map.coverage.gaps).toEqual([expect.objectContaining({ source: expect.objectContaining({ name: "gone" }), state: "failed", reason: "source_unavailable" })]);
    });

    it("normalize an analysis failure to one target, with a stable code and no effect on others' records", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      // A worker whose analysis limits differ from the launch's cannot reproduce the recorded configuration.
      await run(withOverrides(world.config, { analysis: { maxFiles: 7 } }));

      const done = getAssessment(world.db, assessment.publicId);
      expect(done).toMatchObject({ state: "failed", failureReason: expect.stringContaining("analysis_failed") });
      for (const target of targetsOf(world.db, done.id)) expect(target).toMatchObject({ state: "failed", failureCode: "analysis_failed", failureMessage: expect.stringContaining("detector configuration") });
      expect(profilesOf(world.db, done.id)).toEqual([]);
    });
  });

  describe("finalization", () => {
    it("derives complete when every target contributes a Profile, and writes the map once", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      await run();
      const done = getAssessment(world.db, assessment.publicId);
      expect(done.state).toBe("complete");
      const map = mapOf(world.db, done.id)!;
      expect(finalizeAssessment(world.db, assessment.publicId).state).toBe("complete");
      expect(mapOf(world.db, done.id)!.id).toBe(map.id);
    });

    it("waits for every target, and refuses to finalize an Assessment that is not finalizing", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      await run(world.config, 2); // the coordinator and one target
      const partial = getAssessment(world.db, assessment.publicId);
      expect(partial.state).toBe("analyzing");
      requestFinalization(world.db, partial.id);
      expect(getAssessment(world.db, assessment.publicId).state).toBe("analyzing");
      expect(() => finalizeAssessment(world.db, assessment.publicId)).toThrow(NonRetryableError);
      await run();
      expect(getAssessment(world.db, assessment.publicId).state).toBe("complete");
    });

    it("finalizes once when two connections race to finalize", async () => {
      await withSharedFileDb(async (shared, other) => {
        // The suite's helpers read the world's database.
        world.db = shared;
        const assessment = launch([source("orders"), source("billing")]);
        const coordinator = jobHandlers(world.db, world.config);
        await drainJobs(world.db, Object.fromEntries(Object.entries(coordinator).filter(([kind]) => kind !== "assessment.finalize")));
        expect(getAssessment(world.db, assessment.publicId).state).toBe("finalizing");

        const [first, second] = [finalizeAssessment(world.db, assessment.publicId), finalizeAssessment(other, assessment.publicId)];
        expect(first.state).toBe("complete");
        expect(second).toMatchObject({ state: "complete", id: first.id, finishedAt: first.finishedAt });
        expect(mapOf(other, first.id)).toBeDefined();
      });
    });
  });

  describe("cancellation", () => {
    it("before acquisition: no target is acquired and the Assessment is canceled", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      requestCancellation(world.db, assessment.id);
      await run();

      const done = getAssessment(world.db, assessment.publicId);
      expect(done.state).toBe("canceled");
      expect(states(done.id)).toEqual({ billing: "canceled", orders: "canceled" });
      for (const target of targetsOf(world.db, done.id)) expect(snapshotOf(world.db, target.id)).toBeUndefined();
    });

    it("during an Assessment: completed Profiles stay, unfinished targets are canceled, and it is never finalized as complete", async () => {
      const assessment = launch([source("orders"), source("billing"), source("reports")]);
      await run(world.config, 2); // the coordinator and the first target
      requestCancellation(world.db, assessment.id);
      await run();

      const done = getAssessment(world.db, assessment.publicId);
      expect(done.state).toBe("canceled");
      const byState = Object.values(states(done.id)).sort();
      expect(byState).toEqual(["canceled", "canceled", "complete"]);
      expect(profilesOf(world.db, done.id)).toHaveLength(1);
      // The completed Profile remains reviewable in the map.
      expect((mapDocument(mapOf(world.db, done.id)!) as unknown as MapDocument).coverage.contributors).toHaveLength(1);
    });

    it("before analysis: a pinned target is canceled without being analyzed", async () => {
      const assessment = launch([source("orders")]);
      const [target] = targetsOf(world.db, assessment.id);
      const acquired = await acquireTarget(world.db, transitionTarget(world.db, target!, "acquiring"), { config: world.config });
      expect(acquired.ok).toBe(true);
      requestCancellation(world.db, assessment.id);

      const result = await processTarget(world.db, target!.publicId, { config: world.config });
      expect(result.state).toBe("canceled");
      expect(profilesOf(world.db, assessment.id)).toEqual([]);
    });

    it("between detector stages: analysis stops at the next stage and stores no Profile", async () => {
      const assessment = launch([source("orders", { "package.json": '{ "name": "orders", "version": "1.0.0" }\n', "src/app.ts": "export const x = 1;\n" })]);
      const [target] = targetsOf(world.db, assessment.id);
      await acquireTarget(world.db, transitionTarget(world.db, target!, "acquiring"), { config: world.config });

      // The job passes the check before analysis, then awaits Git reads while opening the snapshot.
      const pending = processTarget(world.db, target!.publicId, { config: world.config });
      await new Promise((resolve) => setImmediate(resolve));
      requestCancellation(world.db, assessment.id);

      expect((await pending).state).toBe("canceled");
      expect(profilesOf(world.db, assessment.id)).toEqual([]);
    });
  });
});
