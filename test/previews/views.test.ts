import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type FabricateConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { deletePreview } from "@/lib/previews/lifecycle";
import { failAttempt, openPreparation, rebuildPreview } from "@/lib/previews/records";
import { listPreviews, packageLabel, preparationOf, previewActivity, previewCount, previewsOfCommit, refLabel, remoteRefsFor } from "@/lib/previews/views";
import { acquisitionConfig, registerLocalSource } from "../support/acquisition";
import { buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { GitFixture } from "../support/git-fixture";
import { queuedPreview } from "../support/previews";

/*
 * What the Repository page and the preview page read about previews (spec
 * "Preview states and logs are visible"): a Repository's previews newest
 * first, the preparation in its address, and the version its page polls.
 */

describe("preview views", () => {
  let db: Db;
  let source: RepositorySource;

  beforeEach(() => {
    db = createTestDb();
    source = buildSource(db, { name: "orders" });
  });

  it("lists a Repository's undeleted previews newest first, a page at a time", async () => {
    const [first, second, third] = [queuedPreview(db, source), queuedPreview(db, source), queuedPreview(db, source)];
    queuedPreview(db, buildSource(db, { name: "billing" }));
    await deletePreview(db, third.publicId);

    expect(listPreviews(db, source, { limit: 10 }).map((preview) => preview.publicId)).toEqual([second.publicId, first.publicId]);
    expect(listPreviews(db, source, { limit: 1, offset: 1 }).map((preview) => preview.publicId)).toEqual([first.publicId]);
    expect(previewCount(db, source)).toBe(2);
  });

  it("finds only the Repository's own preparation, and the previews of its commit by package", () => {
    const preview = queuedPreview(db, source);
    const preparation = db.$client.prepare("select public_id from preview_preparations where id = ?").get(preview.preparationId) as { public_id: string };
    const found = preparationOf(db, source, preparation.public_id)!;
    expect(found.commitSha).toBe(preview.commitSha);
    expect(preparationOf(db, buildSource(db, { name: "billing" }), preparation.public_id)).toBeUndefined();
    expect(preparationOf(db, source, "src_0000000000000000")).toBeUndefined();
    expect(preparationOf(db, source, undefined)).toBeUndefined();
    expect([...previewsOfCommit(db, found).keys()]).toEqual(["."]);
  });

  it("changes its version whenever the preparation or a preview changes state, and is active while either is under way", () => {
    const idle = previewActivity(db, source);
    expect(idle.active).toBe(false);

    const { preparation } = openPreparation(db, source, { commitSha: "c".repeat(40), refName: "refs/heads/main", refKind: "branch" });
    const profiling = previewActivity(db, source, preparation.publicId);
    expect(profiling).toMatchObject({ active: true });
    expect(previewActivity(db, source)).toEqual(idle);

    const preview = queuedPreview(db, source);
    const queued = previewActivity(db, source);
    expect(queued.active).toBe(true);
    expect(queued.version).not.toBe(idle.version);

    failAttempt(db, preview.publicId, { attempt: 1 }, "The build failed");
    const failed = previewActivity(db, source);
    expect(failed).toMatchObject({ active: false });
    expect(failed.version).not.toBe(queued.version);

    rebuildPreview(db, preview.publicId);
    expect(previewActivity(db, source)).toMatchObject({ active: true });
  });

  it("names a ref by its branch or tag, and a package by its manifest's name or its directory", () => {
    expect(refLabel({ refName: "refs/heads/feature/new-nav", refKind: "branch" })).toBe("feature/new-nav");
    expect(refLabel({ refName: "refs/tags/v1.4.0", refKind: "tag" })).toBe("v1.4.0");
    expect(refLabel({ refName: null, refKind: "commit" })).toBeNull();
    expect(packageLabel({ packageDir: "apps/web", decidingFacts: '{"name":"@acme/web"}' })).toBe("@acme/web");
    expect(packageLabel({ packageDir: "apps/web", decidingFacts: '{"name":null}' })).toBe("apps/web");
    expect(packageLabel({ packageDir: ".", decidingFacts: "{}" })).toBe("The repository root");
  });

  describe("the remote's refs", () => {
    let fixture: GitFixture;
    let config: FabricateConfig;

    beforeEach(() => {
      fixture = GitFixture.create("preview-views");
      config = withOverrides(acquisitionConfig(fixture), { gitTimeoutSeconds: 15 });
    });

    afterEach(() => {
      fixture.cleanup();
      fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
    });

    it("reuses a listing for half a minute, and never one that failed", async () => {
      const work = fixture.repo("work/orders");
      work.write("README.md", "orders\n");
      work.commit("initial");
      const remote = fixture.bare("remotes/orders.git", { from: work });
      const local = registerLocalSource(db, config, "orders", remote.path);
      const now = Date.now();

      const first = await remoteRefsFor(config, local, now);
      expect(first.refs.map((ref) => ref.label)).toEqual(["main"]);
      work.git("push", "--quiet", remote.path, "main:feature/next");
      expect(await remoteRefsFor(config, local, now + 29_000)).toBe(first);
      expect((await remoteRefsFor(config, local, now + 31_000)).refs.map((ref) => ref.label)).toEqual(["main", "feature/next"]);

      const gone = registerLocalSource(db, config, "gone", fixture.bare("remotes/gone.git", { from: work }).path);
      fs.rmSync(fixture.dir("remotes/gone.git"), { recursive: true, force: true });
      const failed = await remoteRefsFor(config, gone, now);
      expect(failed.unavailable).not.toBeNull();
      expect(await remoteRefsFor(config, gone, now)).not.toBe(failed);
    });
  });
});
