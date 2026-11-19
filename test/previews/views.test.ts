import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "@/lib/repositories/repository-records";
import type { Db } from "@/lib/db/client";
import { deletePreview } from "@/lib/previews/lifecycle";
import { failAttempt, openPreparation, rebuildPreview } from "@/lib/previews/records";
import { listPreviews, packageLabel, preparationOf, previewActivity, previewCount, previewsOfCommit, refLabel, remoteRefsFor } from "@/lib/previews/views";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { queuedPreview } from "../support/previews";

/*
 * What the Repository page and the preview page read about previews (spec
 * "Preview states and logs are visible"): a Repository's previews newest
 * first, the preparation in its address, and the version its page polls.
 */

describe("preview views", () => {
  let db: Db;
  let repository: Repository;

  beforeEach(() => {
    db = createTestDb();
    repository = buildRepository(db, { name: "orders" });
  });

  it("lists a Repository's undeleted previews newest first, a page at a time", async () => {
    const [first, second, third] = [queuedPreview(db, repository), queuedPreview(db, repository), queuedPreview(db, repository)];
    queuedPreview(db, buildRepository(db, { name: "billing" }));
    await deletePreview(db, third.publicId);

    expect(listPreviews(db, repository, { limit: 10 }).map((preview) => preview.publicId)).toEqual([second.publicId, first.publicId]);
    expect(listPreviews(db, repository, { limit: 1, offset: 1 }).map((preview) => preview.publicId)).toEqual([first.publicId]);
    expect(previewCount(db, repository)).toBe(2);
  });

  it("finds only the Repository's own preparation, and the previews of its commit by package", () => {
    const preview = queuedPreview(db, repository);
    const preparation = db.$client.prepare("select public_id from preview_preparations where id = ?").get(preview.preparationId) as { public_id: string };
    const found = preparationOf(db, repository, preparation.public_id)!;
    expect(found.commitSha).toBe(preview.commitSha);
    expect(preparationOf(db, buildRepository(db, { name: "billing" }), preparation.public_id)).toBeUndefined();
    expect(preparationOf(db, repository, "src_0000000000000000")).toBeUndefined();
    expect(preparationOf(db, repository, undefined)).toBeUndefined();
    expect([...previewsOfCommit(db, found).keys()]).toEqual(["."]);
  });

  it("changes its version whenever the preparation or a preview changes state, and is active while either is under way", () => {
    const idle = previewActivity(db, repository);
    expect(idle.active).toBe(false);

    const { preparation } = openPreparation(db, repository, { commitSha: "c".repeat(40), refName: "refs/heads/main", refKind: "branch" });
    const profiling = previewActivity(db, repository, preparation.publicId);
    expect(profiling).toMatchObject({ active: true });
    expect(previewActivity(db, repository)).toEqual(idle);

    const preview = queuedPreview(db, repository);
    const queued = previewActivity(db, repository);
    expect(queued.active).toBe(true);
    expect(queued.version).not.toBe(idle.version);

    failAttempt(db, preview.publicId, { attempt: 1 }, "The build failed");
    const failed = previewActivity(db, repository);
    expect(failed).toMatchObject({ active: false });
    expect(failed.version).not.toBe(queued.version);

    rebuildPreview(db, preview.publicId);
    expect(previewActivity(db, repository)).toMatchObject({ active: true });
  });

  it("names a ref by its branch or tag, and a package by its manifest's name or its directory", () => {
    expect(refLabel({ refName: "refs/heads/feature/new-nav", refKind: "branch" })).toBe("feature/new-nav");
    expect(refLabel({ refName: "refs/tags/v1.4.0", refKind: "tag" })).toBe("v1.4.0");
    expect(refLabel({ refName: null, refKind: "commit" })).toBeNull();
    expect(packageLabel({ packageDir: "apps/web", decidingFacts: { name: "@acme/web" } })).toBe("@acme/web");
    expect(packageLabel({ packageDir: "apps/web", decidingFacts: { name: null } })).toBe("apps/web");
    expect(packageLabel({ packageDir: ".", decidingFacts: {} })).toBe("The repository root");
  });

  describe("the remote's refs", () => {
    const world = useAcquisitionWorld("preview-views", { overrides: { gitTimeoutSeconds: 15 } });

    it("reuses a listing for half a minute, and never one that failed", async () => {
      const work = world.fixture.repo("work/orders");
      work.write("README.md", "orders\n");
      work.commit("initial");
      const remote = world.fixture.bare("remotes/orders.git", { from: work });
      const local = registerLocalRepository(world.db, world.config, "orders", remote.path);
      const now = Date.now();

      const first = await remoteRefsFor(world.config, local, now);
      expect(first.refs.map((ref) => ref.label)).toEqual(["main"]);
      work.git("push", "--quiet", remote.path, "main:feature/next");
      expect(await remoteRefsFor(world.config, local, now + 29_000)).toBe(first);
      expect((await remoteRefsFor(world.config, local, now + 31_000)).refs.map((ref) => ref.label)).toEqual(["main", "feature/next"]);

      const gone = registerLocalRepository(world.db, world.config, "gone", world.fixture.bare("remotes/gone.git", { from: work }).path);
      fs.rmSync(world.fixture.dir("remotes/gone.git"), { recursive: true, force: true });
      const failed = await remoteRefsFor(world.config, gone, now);
      expect(failed.unavailable).not.toBeNull();
      expect(await remoteRefsFor(world.config, gone, now)).not.toBe(failed);
    });
  });
});
