import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteRepository } from "@/lib/repositories/registration";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { deleteApplication, findApplication } from "@/lib/applications/records";
import { removeSavedPreview } from "@/lib/applications/saved-previews";
import { jobs, previewBuilds } from "@/lib/db/schema";
import { claimNext } from "@/lib/jobs/queue";
import { type PruneCandidate, cacheBytes, choosePrunable, deletePreview, prunePreviews, requestPreview, requestRebuild } from "@/lib/previews/lifecycle";
import {
  BUILD_PREVIEW,
  PREPARE_PREVIEW,
  type PreviewBuild,
  claimAttempt,
  failAttempt,
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
import { buildRepository } from "../support/builders";
import { rawRun } from "../support/db";
import { decidedPreparation, onboard, qualifyingVerdict } from "../support/applications";
import { publishFiles, queuedPreview } from "../support/previews";
import { useAppDb } from "../support/next";

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

  it("never deletes a preview an application uses, however long ago it was opened", () => {
    const previews = [{ ...candidate("current", 50, { opened: 1 }), inUse: true }, { ...candidate("latest", 50, { opened: 2 }, "failed"), inUse: true }, candidate("other", 50, { opened: 3 })];
    expect(choosePrunable(previews, 0)).toEqual(["other"]);
  });

  it("breaks ties by id, so the choice is stable", () => {
    expect(choosePrunable([candidate("b", 50, { opened: 1 }), candidate("a", 50, { opened: 1 })], 50)).toEqual(["a"]);
  });
});

describe("preview lifecycle", () => {
  const original = getConfig();
  const app = useAppDb();
  let storage: string;
  let config: FrontendRegistryConfig;
  let repository: Repository;

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-lifecycle-")));
    repository = buildRepository(app.db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git" });
    configure({});
  });

  afterEach(() => {
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  function configure(previews: Partial<FrontendRegistryConfig["settings"]["previews"]>): void {
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [repository.canonicalUrl], storage, ...previews } });
    setConfig(config);
  }

  /** A Ready preview whose artifact is +bytes+ long, last opened at +opened+ minutes. */
  function ready(bytes: number, opened?: number): PreviewBuild {
    const preview = publishFiles(app.db, config, queuedPreview(app.db, repository), { "index.html": "x".repeat(bytes) });
    rawRun(app.db, "update preview_builds set finished_at = ? where public_id = ?", at(0).getTime(), preview.publicId);
    rawRun(app.db, "update jobs set state = 'succeeded', attempts = 1, finished_at = ? where idempotency_key = ?", Date.now(), `${BUILD_PREVIEW}:${preview.publicId}:1`);
    if (opened !== undefined) markOpened(app.db, preview.publicId, at(opened));
    return findPreview(app.db, preview.publicId)!;
  }
  const serve = (preview: PreviewBuild) => servePreview(new Request(`http://localhost/previews/${preview.publicId}/`, { headers: { "sec-fetch-dest": "document" } }), preview.publicId, [], { db: app.db, config });
  const exists = (preview: PreviewBuild) => fs.existsSync(previewDirectory(config, preview.publicId));
  const findPreviewById = (id: number) => app.db.select().from(previewBuilds).where(eq(previewBuilds.id, id)).get()!;
  /** Saves a preview of +ref+ for the application +applicationId+, ready on +current+, and trying +latest+ when given. */
  const saveOn = (applicationId: number, key: string, ref: string, current: PreviewBuild, latest: PreviewBuild = current) =>
    rawRun(
      app.db,
      "insert into application_previews (public_id, application_id, key, ref, current_preview_id, latest_preview_id, latest_preparation_id, latest_commit_sha, latest_outcome, latest_requested_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)",
      `apv_${key.replace(/[^a-z0-9]/g, "").padEnd(16, "0").slice(0, 16)}`,
      applicationId,
      key,
      ref,
      current.id,
      latest.id,
      latest.preparationId,
      latest.commitSha,
      latest === current ? "ready" : "building",
    );
  const buildJob = (preview: PreviewBuild, attempt = 1) => app.db.select().from(jobs).where(eq(jobs.idempotencyKey, `${BUILD_PREVIEW}:${preview.publicId}:${attempt}`)).get()!;

  describe("pruning", () => {
    it("deletes the least recently opened previews until the stored output fits, and their paths answer 404", async () => {
      const oldest = ready(400, 10);
      const older = ready(400, 20);
      const recent = ready(400, 30);
      configure({ maxStorageBytes: 900 });

      const result = await prunePreviews(app.db, config);
      expect(result).toEqual({ deleted: [oldest.publicId], bytes: 800, limit: 900 });
      expect(findPreview(app.db, oldest.publicId)).toBeUndefined();
      expect(exists(oldest)).toBe(false);
      expect((await serve(oldest)).status).toBe(404);
      for (const kept of [older, recent]) {
        expect(exists(kept)).toBe(true);
        expect((await serve(kept)).status).toBe(200);
      }
      // A pruned preview can't be published to or rebuilt.
      expect(publishAttempt(app.db, oldest.publicId, { attempt: 1 }, { directory: "out/1-late", layout: "standalone", entry: {}, outputBytes: 1, buildMs: 1, nodeVersion: "22.11.0", packageManager: "npm" })).toBe(false);
      expect(() => rebuildPreview(app.db, oldest.publicId)).toThrow(/does not exist/);
    });

    it("counts each preview's latest log with its artifact", async () => {
      const logged = ready(100, 10);
      const quiet = ready(100, 20);
      fs.mkdirSync(path.join(previewDirectory(config, logged.publicId), "logs"), { recursive: true });
      fs.writeFileSync(path.join(previewDirectory(config, logged.publicId), "logs", "1-test.log"), "l".repeat(300));
      rawRun(app.db, "update preview_builds set attempt_log = 'logs/1-test.log' where public_id = ?", logged.publicId);
      configure({ maxStorageBytes: 450 });

      expect((await prunePreviews(app.db, config)).deleted).toEqual([logged.publicId]);
      expect(findPreview(app.db, quiet.publicId)).toBeDefined();
    });

    it("never deletes a preview that's building, however long ago it was opened, or the one just published", async () => {
      const building = ready(400, 1);
      rebuildPreview(app.db, building.publicId);
      claimAttempt(app.db, building.publicId, 2, "worker-a#1.1", "logs/2-a.log");
      const queued = ready(400, 2);
      rebuildPreview(app.db, queued.publicId);
      const failed = ready(400, 3);
      const fresh = ready(400);
      configure({ maxStorageBytes: 100 });

      const result = await prunePreviews(app.db, config, { keep: fresh.publicId });
      expect(result.deleted).toEqual([failed.publicId]);
      expect(result.bytes).toBe(1_200);
      for (const kept of [building, queued, fresh]) expect(findPreview(app.db, kept.publicId)).toBeDefined();
      // The rebuild still publishes over the artifact it kept serving.
      expect(publishAttempt(app.db, building.publicId, { attempt: 2, claim: "worker-a#1.1" }, { directory: "out/2-a", layout: "standalone", entry: {}, outputBytes: 1, buildMs: 1, nodeVersion: "22.11.0", packageManager: "npm" })).toBe(true);
    });

    it("never deletes an application's current build or latest attempt, and prunes them like any other once it's deleted (Storage limit reached)", async () => {
      // Orders portal's current build and Admin's failed first attempt are the least recently used.
      const orders = onboard(app.db, config, repository, { name: "Orders portal" });
      const current = publishFiles(app.db, config, findPreviewById(orders.latestPreviewId!), { "index.html": "x".repeat(400) });
      markOpened(app.db, current.publicId, at(1));
      const admin = onboard(app.db, config, repository, { name: "Admin", packageDir: "apps/admin", preparation: decidedPreparation(app.db, repository, [qualifyingVerdict("apps/admin")]) });
      const latest = findPreviewById(admin.latestPreviewId!);
      failAttempt(app.db, latest.publicId, { attempt: 1 }, "The install failed");
      markOpened(app.db, latest.publicId, at(2));
      const other = ready(400, 3);
      const newer = ready(400, 4);
      configure({ maxStorageBytes: 100 });

      expect((await prunePreviews(app.db, config)).deleted).toEqual([other.publicId, newer.publicId]);
      expect(findApplication(app.db, "orders-portal")).toMatchObject({ status: "ready", current: { preview: current.publicId } });
      for (const kept of [current, latest]) expect(findPreview(app.db, kept.publicId)).toBeDefined();
      expect((await serve(current)).status).toBe(200);

      deleteApplication(app.db, orders.publicId);
      expect((await prunePreviews(app.db, config)).deleted).toEqual([current.publicId]);
      expect(findPreview(app.db, latest.publicId)).toBeDefined();
    });

    it("never deletes a saved preview's current build or latest attempt, and prunes them like any other once it's removed (A saved preview's build, A removed preview's build)", async () => {
      const orders = onboard(app.db, config, repository, { name: "Orders portal" });
      const current = publishFiles(app.db, config, findPreviewById(orders.latestPreviewId!), { "index.html": "x".repeat(400) });
      markOpened(app.db, current.publicId, at(5));
      // feature/new-nav's current build is the least recently opened of all, and fix/totals is still trying a newer commit.
      const feature = ready(400, 1);
      saveOn(orders.id, "feature-new-nav", "refs/heads/feature/new-nav", feature);
      const totals = ready(400, 2);
      const attempt = ready(400, 3);
      saveOn(orders.id, "fix-totals", "refs/heads/fix/totals", totals, attempt);
      const other = ready(400, 4);
      configure({ maxStorageBytes: 100 });

      expect((await prunePreviews(app.db, config)).deleted).toEqual([other.publicId]);
      for (const kept of [current, feature, totals, attempt]) expect(findPreview(app.db, kept.publicId)).toBeDefined();

      expect(removeSavedPreview(app.db, orders.publicId, "feature-new-nav")).toBe("refs/heads/feature/new-nav");
      expect((await prunePreviews(app.db, config)).deleted).toEqual([feature.publicId]);
      expect(findPreview(app.db, totals.publicId)).toBeDefined();
    });

    it("sweeps files no undeleted preview owns, and leaves the package caches", async () => {
      const kept = ready(10);
      const orphan = path.join(storage, "pvw_0000000000000000");
      fs.mkdirSync(path.join(orphan, "out"), { recursive: true });
      fs.mkdirSync(path.join(storage, ".trash", "pvw_1111111111111111-abcd"), { recursive: true });
      fs.mkdirSync(path.join(cacheDirectory(config), "npm"), { recursive: true });
      fs.writeFileSync(path.join(cacheDirectory(config), "npm", "index"), "cache");

      expect((await prunePreviews(app.db, config)).deleted).toEqual([]);
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
      rebuildPreview(app.db, preview.publicId);
      // Each try's worker stops before finishing, and the queue gives up on the job rather than claim it a fourth time.
      for (let tries = 1; tries <= 3; tries++) {
        const job = claimNext(app.db, { workerId: `worker-${tries}`, leaseMs: 1, now: new Date(Date.now() + tries * MINUTE) })!;
        expect(job.idempotencyKey).toBe(`${BUILD_PREVIEW}:${preview.publicId}:2`);
        claimAttempt(app.db, preview.publicId, 2, `worker-${tries}#${job.id}.${tries}`, `logs/2-${tries}.log`);
      }
      expect(claimNext(app.db, { workerId: "worker-4", now: new Date(Date.now() + 10 * MINUTE) })).toBeUndefined();
      expect(buildJob(preview, 2)).toMatchObject({ state: "failed" });
      expect(findPreview(app.db, preview.publicId)).toMatchObject({ attemptState: "building" });

      expect(settleAbandonedAttempts(app.db)).toEqual([preview.publicId]);
      const settled = findPreview(app.db, preview.publicId)!;
      expect(settled).toMatchObject({ attemptState: "failed", artifactAttempt: 1 });
      expect(settled.attemptReason).toBe("The build stopped before it finished: the worker running it stopped or lost the job on each of its 3 tries. Last error: Abandoned: the worker holding this job stopped before it finished");
      expect(rebuildPreview(app.db, preview.publicId)).toMatchObject({ attempt: 3, attemptState: "queued" });
    });

    it("fails one whose job is running under an expired lease with no tries left, or whose job is gone", () => {
      const expired = queuedPreview(app.db, repository);
      const gone = queuedPreview(app.db, repository);
      const live = queuedPreview(app.db, repository);
      const waiting = queuedPreview(app.db, repository);
      rawRun(app.db, "update jobs set state = 'running', attempts = 3, lease_owner = 'w', lease_expires_at = ? where id = ?", Date.now() - 1_000, buildJob(expired).id);
      rawRun(app.db, "update jobs set state = 'running', attempts = 3, lease_owner = 'w', lease_expires_at = ? where id = ?", Date.now() + MINUTE, buildJob(live).id);
      rawRun(app.db, "update jobs set state = 'queued', attempts = 2 where id = ?", buildJob(waiting).id);
      rawRun(app.db, "delete from jobs where id = ?", buildJob(gone).id);

      expect(settleAbandonedAttempts(app.db).sort()).toEqual([expired.publicId, gone.publicId].sort());
      expect(findPreview(app.db, gone.publicId)!.attemptReason).toBe("The build's job no longer exists, so it can't finish. Rebuild the preview to try again.");
      expect(findPreview(app.db, live.publicId)!.attemptState).toBe("queued");
      expect(findPreview(app.db, waiting.publicId)!.attemptState).toBe("queued");
    });

    it("fails a preparation whose job ran out of tries, so requesting the commit again prepares it again", () => {
      const pinned = { commitSha: "e".repeat(40), refName: "refs/heads/main", refKind: "branch" } as const;
      const { preparation } = openPreparation(app.db, repository, pinned);
      const job = () => app.db.select().from(jobs).where(eq(jobs.kind, PREPARE_PREVIEW)).all();
      expect(openPreparation(app.db, repository, pinned)).toMatchObject({ started: false, preparation: { state: "profiling" } });

      rawRun(app.db, "update jobs set state = 'failed', attempts = 3, last_error = 'Error: The worker is stopping' where id = ?", job()[0]!.id);
      expect(settleAbandonedPreparations(app.db)).toEqual([preparation.publicId]);
      expect(findPreparation(app.db, preparation.publicId)).toMatchObject({
        state: "failed",
        failure: "The preparation stopped before it finished: the worker running it stopped or lost the job on each of its 3 tries. Last error: Error: The worker is stopping",
      });
      expect(openPreparation(app.db, repository, pinned)).toMatchObject({ started: true, preparation: { state: "profiling" } });
      expect(job()).toHaveLength(2);
    });

    it("lets a rebuild start over an abandoned attempt, but leaves one still running", () => {
      const preview = queuedPreview(app.db, repository);
      expect(rebuildPreview(app.db, preview.publicId)).toMatchObject({ attempt: 1, attemptState: "queued" });
      rawRun(app.db, "update jobs set state = 'failed', attempts = 3, last_error = null where id = ?", buildJob(preview).id);
      expect(rebuildPreview(app.db, preview.publicId)).toMatchObject({ attempt: 2, attemptState: "queued" });
      expect(findPreview(app.db, preview.publicId)!.attemptReason).toBeNull();
    });
  });

  describe("deletion", () => {
    it("deletes a preview and its files, after which its paths answer 404", async () => {
      const preview = ready(10);
      expect((await serve(preview)).status).toBe(200);
      expect(await deletePreview(app.db, preview.publicId, config)).toBe(true);
      expect(findPreview(app.db, preview.publicId)).toBeUndefined();
      expect(exists(preview)).toBe(false);
      expect((await serve(preview)).status).toBe(404);
      expect(await deletePreview(app.db, preview.publicId, config)).toBe(false);
      expect(fs.readdirSync(path.join(storage, ".trash"))).toEqual([]);
    });

    it("refuses to delete an application's build, naming the application, until the application is deleted", async () => {
      const orders = onboard(app.db, config, repository, { name: "Orders portal" });
      const current = publishFiles(app.db, config, findPreviewById(orders.latestPreviewId!), { "index.html": "orders" });
      await expect(deletePreview(app.db, current.publicId, config)).rejects.toThrow("Orders portal builds from this preview. Delete the application, or let it build another commit, first.");
      expect((await serve(current)).status).toBe(200);
      deleteApplication(app.db, orders.publicId);
      expect(await deletePreview(app.db, current.publicId, config)).toBe(true);
    });

    it("refuses to delete a saved preview's build, naming the application and the branch, until the preview is removed (Deleting a saved preview's build)", async () => {
      const orders = onboard(app.db, config, repository, { name: "Orders portal" });
      const feature = ready(10);
      saveOn(orders.id, "feature-new-nav", "refs/heads/feature/new-nav", feature);
      await expect(deletePreview(app.db, feature.publicId, config)).rejects.toThrow("Orders portal (feature/new-nav) builds from this preview. Remove the saved preview or delete the application, or let it build another commit, first.");
      removeSavedPreview(app.db, orders.publicId, "feature-new-nav");
      expect(await deletePreview(app.db, feature.publicId, config)).toBe(true);
    });

    it("deletes every preview of a deleted Repository, moving its files aside at once", async () => {
      const first = ready(10);
      const second = ready(10);
      const other = buildRepository(app.db, { name: "billing", cloneUrl: "https://git.example.com/acme/billing.git" });
      configure({ trustedSources: [repository.canonicalUrl, other.canonicalUrl] });
      const unrelated = publishFiles(app.db, config, queuedPreview(app.db, other), { "index.html": "billing" });

      deleteRepository(app.db, repository.publicId, "orders");
      for (const preview of [first, second]) {
        expect(findPreview(app.db, preview.publicId)).toBeUndefined();
        expect(exists(preview)).toBe(false);
        expect((await serve(preview)).status).toBe(404);
      }
      expect((await serve(unrelated)).status).toBe(200);
      await prunePreviews(app.db, config);
      expect(fs.readdirSync(path.join(storage, ".trash"))).toEqual([]);
    });
  });

  describe("request boundaries", () => {
    it("starts or rebuilds a preview only while previews are on and the remote is enrolled", () => {
      const preview = ready(10);
      const preparation = app.db.$client.prepare("select p.public_id as id from preview_preparations p join preview_builds b on b.preparation_id = p.id where b.public_id = ?").get(preview.publicId) as { id: string };
      const jobCount = () => app.db.select().from(jobs).all().length;
      const before = jobCount();

      for (const settings of [{ enabled: false }, { trustedSources: [] }]) {
        configure(settings);
        expect(() => requestRebuild(app.db, preview.publicId, config)).toThrow(expect.objectContaining({ name: "PreviewAccessError" }));
        expect(() => requestPreview(app.db, preparation.id, ".", config)).toThrow(expect.objectContaining({ name: "PreviewAccessError" }));
      }
      expect(jobCount()).toBe(before);
      expect(findPreview(app.db, preview.publicId)!.attempt).toBe(1);

      configure({});
      expect(requestPreview(app.db, preparation.id, ".", config)).toMatchObject({ created: false, preview: { publicId: preview.publicId } });
      expect(requestRebuild(app.db, preview.publicId, config)).toMatchObject({ attempt: 2, attemptState: "queued" });
      expect(jobCount()).toBe(before + 1);
    });
  });
});
