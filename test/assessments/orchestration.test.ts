import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireTarget } from "@/lib/acquisition/acquire";
import { getAssessment, snapshotOf, targetsOf } from "@/lib/assessments/assessment-records";
import { launchAssessment } from "@/lib/assessments/launcher";
import { finalizeAssessment, processTarget, requestFinalization } from "@/lib/assessments/orchestration";
import { requestCancellation, transitionTarget } from "@/lib/assessments/transitions";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type FabricateConfig, withOverrides } from "@/lib/config";
import { type Db, migrateDatabase, openDatabase } from "@/lib/db/client";
import { NonRetryableError, drainJobs } from "@/lib/jobs/worker";
import { jobHandlers } from "@/lib/jobs/registry";
import { profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { acquisitionConfig, registerLocalSource } from "../support/acquisition";
import { buildInitiative } from "../support/builders";
import { createTestDb } from "../support/db";
import { GitFixture } from "../support/git-fixture";

describe("Assessment orchestration", () => {
  let fixture: GitFixture;
  let config: FabricateConfig;
  let db: Db;

  beforeEach(() => {
    fixture = GitFixture.create("orchestration");
    config = acquisitionConfig(fixture);
    db = createTestDb();
  });

  afterEach(() => {
    fixture.cleanup();
    fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
  });

  function source(name: string, files: Record<string, string> = { "package.json": `{ "name": "${name}", "version": "1.0.0" }\n` }): RepositorySource {
    const work = fixture.repo(`fleet/${name}`);
    for (const [file, content] of Object.entries(files)) work.write(file, content);
    work.commit();
    return registerLocalSource(db, config, name, work.path);
  }

  function launch(sources: RepositorySource[], database: Db = db) {
    const initiative = buildInitiative(database, { sources });
    return launchAssessment(database, initiative.publicId, crypto.randomUUID(), config).assessment;
  }

  const run = (handlersConfig = config, limit?: number) => drainJobs(db, jobHandlers(db, handlersConfig), limit ? { limit } : {});
  const states = (assessmentId: number) => Object.fromEntries(targetsOf(db, assessmentId).map((target) => [target.sourceName, target.state]));

  describe("target jobs", () => {
    it("assess every target independently: a failed source neither blocks the others nor erases their Profiles", async () => {
      const [orders, billing, missing] = [source("orders"), source("billing"), source("gone")];
      fs.rmSync(path.join(fixture.root, "fleet/gone"), { recursive: true, force: true });
      const assessment = launch([orders, billing, missing]);

      await run();
      const done = getAssessment(db, assessment.publicId);
      expect(done.state).toBe("complete_with_issues");
      expect(states(done.id)).toEqual({ billing: "complete", gone: "failed", orders: "complete" });
      expect(targetsOf(db, done.id).find((target) => target.sourceName === "gone")).toMatchObject({ failureCode: "source_unavailable" });
      expect(profilesOf(db, done.id).map(({ target }) => target.sourceName).sort()).toEqual(["billing", "orders"]);
      const map = mapDocument(mapOf(db, done.id)!) as unknown as MapDocument;
      expect(map.coverage.gaps).toEqual([expect.objectContaining({ source: expect.objectContaining({ name: "gone" }), state: "failed", reason: "source_unavailable" })]);
    });

    it("normalize an analysis failure to one target, with a stable code and no effect on others' records", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      // A worker whose analysis limits differ from the launch's cannot reproduce the recorded configuration.
      await run(withOverrides(config, { analysis: { maxFiles: 7 } }));

      const done = getAssessment(db, assessment.publicId);
      expect(done).toMatchObject({ state: "failed", failureReason: expect.stringContaining("analysis_failed") });
      for (const target of targetsOf(db, done.id)) expect(target).toMatchObject({ state: "failed", failureCode: "analysis_failed", failureMessage: expect.stringContaining("detector configuration") });
      expect(profilesOf(db, done.id)).toEqual([]);
    });
  });

  describe("finalization", () => {
    it("derives complete when every target contributes a Profile, and writes the map once", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      await run();
      const done = getAssessment(db, assessment.publicId);
      expect(done.state).toBe("complete");
      const map = mapOf(db, done.id)!;
      expect(finalizeAssessment(db, assessment.publicId).state).toBe("complete");
      expect(mapOf(db, done.id)!.id).toBe(map.id);
    });

    it("waits for every target, and refuses to finalize an Assessment that is not finalizing", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      await run(config, 2); // the coordinator and one target
      const partial = getAssessment(db, assessment.publicId);
      expect(partial.state).toBe("analyzing");
      requestFinalization(db, partial.id);
      expect(getAssessment(db, assessment.publicId).state).toBe("analyzing");
      expect(() => finalizeAssessment(db, assessment.publicId)).toThrow(NonRetryableError);
      await run();
      expect(getAssessment(db, assessment.publicId).state).toBe("complete");
    });

    it("finalizes once when two connections race to finalize", async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "finalize-race-"));
      const file = path.join(directory, "fabricate.sqlite3");
      db = openDatabase(file);
      migrateDatabase(db);
      const other = openDatabase(file);
      try {
        const assessment = launch([source("orders"), source("billing")]);
        const coordinator = jobHandlers(db, config);
        await drainJobs(db, Object.fromEntries(Object.entries(coordinator).filter(([kind]) => kind !== "assessment.finalize")));
        expect(getAssessment(db, assessment.publicId).state).toBe("finalizing");

        const [first, second] = [finalizeAssessment(db, assessment.publicId), finalizeAssessment(other, assessment.publicId)];
        expect(first.state).toBe("complete");
        expect(second).toMatchObject({ state: "complete", id: first.id, finishedAt: first.finishedAt });
        expect(mapOf(other, first.id)).toBeDefined();
      } finally {
        other.$client.close();
        db.$client.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  describe("cancellation", () => {
    it("before acquisition: no target is acquired and the Assessment is canceled", async () => {
      const assessment = launch([source("orders"), source("billing")]);
      requestCancellation(db, assessment.id);
      await run();

      const done = getAssessment(db, assessment.publicId);
      expect(done.state).toBe("canceled");
      expect(states(done.id)).toEqual({ billing: "canceled", orders: "canceled" });
      for (const target of targetsOf(db, done.id)) expect(snapshotOf(db, target.id)).toBeUndefined();
    });

    it("during an Assessment: completed Profiles stay, unfinished targets are canceled, and it is never finalized as complete", async () => {
      const assessment = launch([source("orders"), source("billing"), source("reports")]);
      await run(config, 2); // the coordinator and the first target
      requestCancellation(db, assessment.id);
      await run();

      const done = getAssessment(db, assessment.publicId);
      expect(done.state).toBe("canceled");
      const byState = Object.values(states(done.id)).sort();
      expect(byState).toEqual(["canceled", "canceled", "complete"]);
      expect(profilesOf(db, done.id)).toHaveLength(1);
      // The completed Profile remains reviewable in the map.
      expect((mapDocument(mapOf(db, done.id)!) as unknown as MapDocument).coverage.contributors).toHaveLength(1);
    });

    it("before analysis: a pinned target is canceled without being analyzed", async () => {
      const assessment = launch([source("orders")]);
      const [target] = targetsOf(db, assessment.id);
      const acquired = await acquireTarget(db, transitionTarget(db, target!, "acquiring"), { config });
      expect(acquired.ok).toBe(true);
      requestCancellation(db, assessment.id);

      const result = await processTarget(db, target!.publicId, { config });
      expect(result.state).toBe("canceled");
      expect(profilesOf(db, assessment.id)).toEqual([]);
    });

    it("between detector stages: analysis stops at the next stage and stores no Profile", async () => {
      const assessment = launch([source("orders", { "package.json": '{ "name": "orders", "version": "1.0.0" }\n', "src/app.ts": "export const x = 1;\n" })]);
      const [target] = targetsOf(db, assessment.id);
      await acquireTarget(db, transitionTarget(db, target!, "acquiring"), { config });

      // The job passes the check before analysis, then awaits Git reads while opening the snapshot.
      const pending = processTarget(db, target!.publicId, { config });
      await new Promise((resolve) => setImmediate(resolve));
      requestCancellation(db, assessment.id);

      expect((await pending).state).toBe("canceled");
      expect(profilesOf(db, assessment.id)).toEqual([]);
    });
  });
});
