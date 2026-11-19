import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteSource } from "@/lib/catalog/catalog";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { claimNext } from "@/lib/jobs/queue";
import { type PruneCandidate, cacheBytes, choosePrunable, deletePreview, prunePreviews, requestPreview, requestRebuild } from "@/lib/previews/lifecycle";
import {
  BUILD_PREVIEW,
  PREPARE_PREVIEW,
  type PreviewBuild,
  claimAttempt,
  findPreparation,
  findPreview,
  markOpened,
  openPreparation,
  publishAttempt,
  rebuildPreview,
  settleAbandonedAttempts,
  settleAbandonedPreparations,
} from "@/lib/previews/records";
import { servePreview } from "@/lib/previews/serving";
import { cacheDirectory, previewDirectory } from "@/lib/previews/storage";
import { buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { publishFiles, queuedPreview } from "../support/previews";

/*
 * A preview's life after it's queued (design decisions 1 and 8, spec
 * "Previews can be rebuilt, deleted, and are pruned"), and the request
 * boundaries that check the feature switch and enrollment.
 */

const MINUTE = 60_000;
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1) + minutes * MINUTE);

describe("choosing previews to prune", () => {
  const candidate = (publicId: string, bytes: number, used: { opened?: number; finished?: number; created?: number } = {}, state: PruneCandidate["state"] = "ready"): PruneCandidate => ({
    publicId,
    state,
    bytes,
    lastOpenedAt: used.opened === undefined ? null : at(used.opened),
    finishedAt: used.finished === undefined ? null : at(used.finished),
    createdAt: at(used.created ?? 0),
  });

  it("deletes nothing while everything fits", () => {
    expect(choosePrunable([candidate("a", 40), candidate("b", 60)], 100)).toEqual([]);
  });

  it("deletes the least recently opened first, only until the rest fits", () => {
    const previews = [candidate("recent", 30, { opened: 50, finished: 1 }), candidate("oldest", 30, { opened: 10, finished: 1 }), candidate("older", 30, { opened: 20, finished: 1 }), candidate("old", 30, { opened: 30, finished: 1 })];
    expect(choosePrunable(previews, 100)).toEqual(["oldest"]);
    expect(choosePrunable(previews, 60)).toEqual(["oldest", "older"]);
    expect(choosePrunable(previews, 0)).toEqual(["oldest", "older", "old", "recent"]);
  });

  it("counts a build nobody has opened yet as used when it finished, so it isn't first to go", () => {
    const previews = [candidate("opened-long-ago", 50, { opened: 10, finished: 5 }), candidate("built-just-now", 50, { finished: 100 }), candidate("rebuilt-after-opening", 50, { opened: 20, finished: 90 })];
    expect(choosePrunable(previews, 100)).toEqual(["opened-long-ago"]);
    expect(choosePrunable(previews, 50)).toEqual(["opened-long-ago", "rebuilt-after-opening"]);
  });

  it("deletes Failed previews as well as Ready ones, but never one that's queued or building, or the one kept", () => {
    const previews = [candidate("building", 50, { created: 1 }, "building"), candidate("queued", 50, { created: 2 }, "queued"), candidate("failed", 50, { finished: 3 }, "failed"), candidate("just-published", 50, { finished: 4 }), candidate("ready", 50, { finished: 5 })];
    expect(choosePrunable(previews, 200)).toEqual(["failed"]);
    expect(choosePrunable(previews, 100, "just-published")).toEqual(["failed", "ready"]);
    // When the building previews alone are over the limit, every deletable one goes and the total stays over.
    expect(choosePrunable(previews, 10, "just-published")).toEqual(["failed", "ready"]);
  });

  it("breaks ties by id, so the choice is stable", () => {
    expect(choosePrunable([candidate("b", 50, { opened: 1 }), candidate("a", 50, { opened: 1 })], 50)).toEqual(["a"]);
  });
});

describe("preview lifecycle", () => {
  const original = getConfig();
  let db: Db;
  let storage: string;
  let config: FabricateConfig;
  let source: RepositorySource;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-lifecycle-")));
    source = buildSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git" });
    configure({});
  });

  afterEach(() => {
    setDb(undefined);
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  function configure(previews: Partial<FabricateConfig["settings"]["previews"]>): void {
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [source.canonicalUrl], storage, ...previews } });
    setConfig(config);
  }

  /** A Ready preview whose artifact is +bytes+ long, last opened at +opened+ minutes. */
  function ready(bytes: number, opened?: number): PreviewBuild {
    const preview = publishFiles(db, config, queuedPreview(db, source), { "index.html": "x".repeat(bytes) });
    rawRun(db, "update preview_builds set finished_at = ? where public_id = ?", at(0).getTime(), preview.publicId);
    rawRun(db, "update jobs set state = 'succeeded', attempts = 1, finished_at = ? where idempotency_key = ?", Date.now(), `${BUILD_PREVIEW}:${preview.publicId}:1`);
    if (opened !== undefined) markOpened(db, preview.publicId, at(opened));
    return findPreview(db, preview.publicId)!;
  }
  const serve = (preview: PreviewBuild) => servePreview(new Request(`http://localhost/previews/${preview.publicId}/`, { headers: { "sec-fetch-dest": "document" } }), preview.publicId, [], { db, config });
  const exists = (preview: PreviewBuild) => fs.existsSync(previewDirectory(config, preview.publicId));
  const buildJob = (preview: PreviewBuild, attempt = 1) => db.select().from(jobs).where(eq(jobs.idempotencyKey, `${BUILD_PREVIEW}:${preview.publicId}:${attempt}`)).get()!;

  describe("pruning", () => {
    it("deletes the least recently opened previews until the stored output fits, and their paths answer 404", async () => {
      const oldest = ready(400, 10);
      const older = ready(400, 20);
      const recent = ready(400, 30);
      configure({ maxStorageBytes: 900 });

      const result = await prunePreviews(db, config);
      expect(result).toEqual({ deleted: [oldest.publicId], bytes: 800, limit: 900 });
      expect(findPreview(db, oldest.publicId)).toBeUndefined();
      expect(exists(oldest)).toBe(false);
      expect((await serve(oldest)).status).toBe(404);
      for (const kept of [older, recent]) {
        expect(exists(kept)).toBe(true);
        expect((await serve(kept)).status).toBe(200);
      }
      // A pruned preview can't be published to or rebuilt.
      expect(publishAttempt(db, oldest.publicId, { attempt: 1 }, { directory: "out/1-late", layout: "standalone", entry: {}, outputBytes: 1, buildMs: 1, nodeVersion: "22.11.0", packageManager: "npm" })).toBe(false);
      expect(() => rebuildPreview(db, oldest.publicId)).toThrow(/does not exist/);
    });

    it("counts each preview's latest log with its artifact", async () => {
      const logged = ready(100, 10);
      const quiet = ready(100, 20);
      fs.mkdirSync(path.join(previewDirectory(config, logged.publicId), "logs"), { recursive: true });
      fs.writeFileSync(path.join(previewDirectory(config, logged.publicId), "logs", "1-test.log"), "l".repeat(300));
      rawRun(db, "update preview_builds set attempt_log = 'logs/1-test.log' where public_id = ?", logged.publicId);
      configure({ maxStorageBytes: 450 });

      expect((await prunePreviews(db, config)).deleted).toEqual([logged.publicId]);
      expect(findPreview(db, quiet.publicId)).toBeDefined();
    });

    it("never deletes a preview that's building, however long ago it was opened, or the one just published", async () => {
      const building = ready(400, 1);
      rebuildPreview(db, building.publicId);
      claimAttempt(db, building.publicId, 2, "worker-a#1.1", "logs/2-a.log");
      const queued = ready(400, 2);
      rebuildPreview(db, queued.publicId);
      const failed = ready(400, 3);
      const fresh = ready(400);
      configure({ maxStorageBytes: 100 });

      const result = await prunePreviews(db, config, { keep: fresh.publicId });
      expect(result.deleted).toEqual([failed.publicId]);
      expect(result.bytes).toBe(1_200);
      for (const kept of [building, queued, fresh]) expect(findPreview(db, kept.publicId)).toBeDefined();
      // The rebuild still publishes over the artifact it kept serving.
      expect(publishAttempt(db, building.publicId, { attempt: 2, claim: "worker-a#1.1" }, { directory: "out/2-a", layout: "standalone", entry: {}, outputBytes: 1, buildMs: 1, nodeVersion: "22.11.0", packageManager: "npm" })).toBe(true);
    });

    it("sweeps files no undeleted preview owns, and leaves the package caches", async () => {
      const kept = ready(10);
      const orphan = path.join(storage, "pvw_0000000000000000");
      fs.mkdirSync(path.join(orphan, "out"), { recursive: true });
      fs.mkdirSync(path.join(storage, ".trash", "pvw_1111111111111111-abcd"), { recursive: true });
      fs.mkdirSync(path.join(cacheDirectory(config), "npm"), { recursive: true });
      fs.writeFileSync(path.join(cacheDirectory(config), "npm", "index"), "cache");

      expect((await prunePreviews(db, config)).deleted).toEqual([]);
      expect(fs.existsSync(orphan)).toBe(false);
      expect(fs.readdirSync(path.join(storage, ".trash"))).toEqual([]);
      expect(fs.existsSync(path.join(cacheDirectory(config), "npm", "index"))).toBe(true);
      expect(exists(kept)).toBe(true);
    });

    it("measures the package caches, counting a file linked twice once", async () => {
      const store = path.join(cacheDirectory(config), "pnpm", "store");
      fs.mkdirSync(path.join(store, "files"), { recursive: true });
      fs.writeFileSync(path.join(store, "files", "a"), "a".repeat(1_000));
      fs.linkSync(path.join(store, "files", "a"), path.join(store, "files", "a-link"));
      fs.writeFileSync(path.join(store, "index.json"), "b".repeat(24));
      expect(await cacheBytes(config)).toBe(1_024);
    });
  });

  describe("abandoned attempts", () => {
    it("fails an attempt whose job ran out of tries while its workers stopped, so the preview can be rebuilt and pruned", async () => {
      const preview = ready(400, 1);
      rebuildPreview(db, preview.publicId);
      // Each try's worker stops before finishing, and the queue gives up on the job rather than claim it a fourth time.
      for (let tries = 1; tries <= 3; tries++) {
        const job = claimNext(db, { workerId: `worker-${tries}`, leaseMs: 1, now: new Date(Date.now() + tries * MINUTE) })!;
        expect(job.idempotencyKey).toBe(`${BUILD_PREVIEW}:${preview.publicId}:2`);
        claimAttempt(db, preview.publicId, 2, `worker-${tries}#${job.id}.${tries}`, `logs/2-${tries}.log`);
      }
      expect(claimNext(db, { workerId: "worker-4", now: new Date(Date.now() + 10 * MINUTE) })).toBeUndefined();
      expect(buildJob(preview, 2)).toMatchObject({ state: "failed" });
      expect(findPreview(db, preview.publicId)).toMatchObject({ attemptState: "building" });

      expect(settleAbandonedAttempts(db)).toEqual([preview.publicId]);
      const settled = findPreview(db, preview.publicId)!;
      expect(settled).toMatchObject({ attemptState: "failed", artifactAttempt: 1 });
      expect(settled.attemptReason).toBe("The build stopped before it finished: the worker running it stopped or lost the job on each of its 3 tries. Last error: Abandoned: the worker holding this job stopped before it finished");
      expect(rebuildPreview(db, preview.publicId)).toMatchObject({ attempt: 3, attemptState: "queued" });
    });

    it("fails one whose job is running under an expired lease with no tries left, or whose job is gone", () => {
      const expired = queuedPreview(db, source);
      const gone = queuedPreview(db, source);
      const live = queuedPreview(db, source);
      const waiting = queuedPreview(db, source);
      rawRun(db, "update jobs set state = 'running', attempts = 3, lease_owner = 'w', lease_expires_at = ? where id = ?", Date.now() - 1_000, buildJob(expired).id);
      rawRun(db, "update jobs set state = 'running', attempts = 3, lease_owner = 'w', lease_expires_at = ? where id = ?", Date.now() + MINUTE, buildJob(live).id);
      rawRun(db, "update jobs set state = 'queued', attempts = 2 where id = ?", buildJob(waiting).id);
      rawRun(db, "delete from jobs where id = ?", buildJob(gone).id);

      expect(settleAbandonedAttempts(db).sort()).toEqual([expired.publicId, gone.publicId].sort());
      expect(findPreview(db, gone.publicId)!.attemptReason).toBe("The build's job no longer exists, so it can't finish. Rebuild the preview to try again.");
      expect(findPreview(db, live.publicId)!.attemptState).toBe("queued");
      expect(findPreview(db, waiting.publicId)!.attemptState).toBe("queued");
    });

    it("fails a preparation whose job ran out of tries, so requesting the commit again prepares it again", () => {
      const pinned = { commitSha: "e".repeat(40), refName: "refs/heads/main", refKind: "branch" } as const;
      const { preparation } = openPreparation(db, source, pinned);
      const job = () => db.select().from(jobs).where(eq(jobs.kind, PREPARE_PREVIEW)).all();
      expect(openPreparation(db, source, pinned)).toMatchObject({ started: false, preparation: { state: "profiling" } });

      rawRun(db, "update jobs set state = 'failed', attempts = 3, last_error = 'Error: The worker is stopping' where id = ?", job()[0]!.id);
      expect(settleAbandonedPreparations(db)).toEqual([preparation.publicId]);
      expect(findPreparation(db, preparation.publicId)).toMatchObject({
        state: "failed",
        failure: "The preparation stopped before it finished: the worker running it stopped or lost the job on each of its 3 tries. Last error: Error: The worker is stopping",
      });
      expect(openPreparation(db, source, pinned)).toMatchObject({ started: true, preparation: { state: "profiling" } });
      expect(job()).toHaveLength(2);
    });

    it("lets a rebuild start over an abandoned attempt, but leaves one still running", () => {
      const preview = queuedPreview(db, source);
      expect(rebuildPreview(db, preview.publicId)).toMatchObject({ attempt: 1, attemptState: "queued" });
      rawRun(db, "update jobs set state = 'failed', attempts = 3, last_error = null where id = ?", buildJob(preview).id);
      expect(rebuildPreview(db, preview.publicId)).toMatchObject({ attempt: 2, attemptState: "queued" });
      expect(findPreview(db, preview.publicId)!.attemptReason).toBeNull();
    });
  });

  describe("deletion", () => {
    it("deletes a preview and its files, after which its paths answer 404", async () => {
      const preview = ready(10);
      expect((await serve(preview)).status).toBe(200);
      expect(await deletePreview(db, preview.publicId, config)).toBe(true);
      expect(findPreview(db, preview.publicId)).toBeUndefined();
      expect(exists(preview)).toBe(false);
      expect((await serve(preview)).status).toBe(404);
      expect(await deletePreview(db, preview.publicId, config)).toBe(false);
      expect(fs.readdirSync(path.join(storage, ".trash"))).toEqual([]);
    });

    it("deletes every preview of a deleted Repository, moving its files aside at once", async () => {
      const first = ready(10);
      const second = ready(10);
      const other = buildSource(db, { name: "billing", cloneUrl: "https://git.example.com/acme/billing.git" });
      configure({ trustedSources: [source.canonicalUrl, other.canonicalUrl] });
      const unrelated = publishFiles(db, config, queuedPreview(db, other), { "index.html": "billing" });

      deleteSource(db, source.publicId, "orders");
      for (const preview of [first, second]) {
        expect(findPreview(db, preview.publicId)).toBeUndefined();
        expect(exists(preview)).toBe(false);
        expect((await serve(preview)).status).toBe(404);
      }
      expect((await serve(unrelated)).status).toBe(200);
      await prunePreviews(db, config);
      expect(fs.readdirSync(path.join(storage, ".trash"))).toEqual([]);
    });
  });

  describe("request boundaries", () => {
    it("starts or rebuilds a preview only while previews are on and the remote is enrolled", () => {
      const preview = ready(10);
      const preparation = db.$client.prepare("select p.public_id as id from preview_preparations p join preview_builds b on b.preparation_id = p.id where b.public_id = ?").get(preview.publicId) as { id: string };
      const jobCount = () => db.select().from(jobs).all().length;
      const before = jobCount();

      for (const settings of [{ enabled: false }, { trustedSources: [] }]) {
        configure(settings);
        expect(() => requestRebuild(db, preview.publicId, config)).toThrow(expect.objectContaining({ name: "PreviewAccessError" }));
        expect(() => requestPreview(db, preparation.id, ".", config)).toThrow(expect.objectContaining({ name: "PreviewAccessError" }));
      }
      expect(jobCount()).toBe(before);
      expect(findPreview(db, preview.publicId)!.attempt).toBe(1);

      configure({});
      expect(requestPreview(db, preparation.id, ".", config)).toMatchObject({ created: false, preview: { publicId: preview.publicId } });
      expect(requestRebuild(db, preview.publicId, config)).toMatchObject({ attempt: 2, attemptState: "queued" });
      expect(jobCount()).toBe(before + 1);
    });
  });
});
