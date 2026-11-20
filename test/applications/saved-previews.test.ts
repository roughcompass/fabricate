import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applicationHistory } from "@/lib/applications/history";
import { ApplicationBuildError, createApplication, createSavedPreview, editApplication, rebuildSavedPreview } from "@/lib/applications/pipeline";
import { buildRef } from "@/lib/applications/preview-mode";
import { getApplication, getApplicationRow } from "@/lib/applications/records";
import { SAVED_PREVIEW_LIMIT, findSavedPreview, getSavedPreviewRow, removeSavedPreview, savedPreviewKey, savedPreviewsOf } from "@/lib/applications/saved-previews";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, withOverrides } from "@/lib/config";
import { ValidationError } from "@/lib/db/errors";
import { JOB_PRIORITIES, jobs, previewBuilds, previewPreparations } from "@/lib/db/schema";
import { requestPreparation } from "@/lib/previews/preparation";
import { BUILD_PREVIEW, type PreviewBuild, type PreviewPreparation, failAttempt, findPreview } from "@/lib/previews/records";
import { CAPTURE_SCREENSHOT } from "@/lib/previews/screenshots";
import { NO_PAGE_REASON } from "@/lib/previews/output";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { decide, refusedVerdict } from "../support/applications";
import { rawRun } from "../support/db";
import type { BareRepo, Repo } from "../support/git-fixture";
import { publishFiles } from "../support/previews";
import { VITE_REACT_APP } from "../support/preview-trees";

/*
 * Saved previews (restore-toolbar-tools-and-branch-previews, design
 * decisions 1, 2, and 4; tasks 1.2 to 1.4): a branch or tag of an
 * application's remote kept built beside the tracked branch, by the same
 * pipeline. Preparations are decided here as their job would decide them,
 * and builds are published or failed as the build job would.
 */

describe("saved preview keys", () => {
  it("lowercases the short name and makes each run of other characters one hyphen (A branch's key)", () => {
    expect(savedPreviewKey("refs/heads/feature/New_Nav", [])).toBe("feature-new-nav");
    expect(savedPreviewKey("refs/heads/--odd//name--", [])).toBe("odd-name");
  });

  it("keeps a tag's dots (A tag's key)", () => {
    expect(savedPreviewKey("refs/tags/v1.1.0", [])).toBe("v1.1.0");
  });

  it("adds a number on collision (A taken key)", () => {
    expect(savedPreviewKey("refs/tags/feature/new-nav", ["feature-new-nav"])).toBe("feature-new-nav-2");
    expect(savedPreviewKey("refs/tags/feature/new-nav", ["feature-new-nav", "feature-new-nav-2"])).toBe("feature-new-nav-3");
  });

  it("is never longer than 60 characters, with a number added too, and never holds @ or /", () => {
    const long = `refs/heads/${"a".repeat(80)}`;
    expect(savedPreviewKey(long, [])).toHaveLength(60);
    const numbered = savedPreviewKey(long, ["a".repeat(60)]);
    expect(numbered).toBe(`${"a".repeat(58)}-2`);
    expect(numbered).toHaveLength(60);
    expect(savedPreviewKey("refs/heads/x@y/z", [])).toBe("x-y-z");
    // A name with no letters or digits still gets a key.
    expect(savedPreviewKey("refs/heads/日本", [])).toBe("preview");
  });
});

describe("saved previews", () => {
  const world = useAcquisitionWorld("saved-previews");
  let config: FrontendRegistryConfig;
  let work: Repo;
  let remote: BareRepo;
  let repository: Repository;

  /** Orders portal on main, its first build published, with feature/new-nav, fix/totals, and the tag v1.1.0 on commits of their own on the remote. */
  async function ordersPortal(): Promise<void> {
    work = world.fixture.repo("work/orders");
    for (const [file, content] of Object.entries(VITE_REACT_APP)) work.write(file, content);
    work.commit("initial");
    branch("feature/new-nav", "New nav");
    branch("fix/totals", "Fix totals");
    branch("release/1.1", "Release 1.1");
    work.git("tag", "v1.1.0", "release/1.1");
    remote = world.fixture.bare("remotes/orders.git", { from: work });
    repository = registerLocalRepository(world.db, world.config, "orders", remote.path);
    config = withOverrides(world.config, { previews: { enabled: true, trustedSources: [repository.cloneUrl] } });
    const preparation = decide(world.db, repository, await requestPreparation(world.db, repository.publicId, { kind: "ref", name: "refs/heads/main" }, { config }));
    createApplication(world.db, { repository: repository.publicId, branch: "main", packageDir: ".", preparation: preparation.publicId, name: "Orders portal", description: "", trusted: true }, config);
    publish(build(getApplicationRow(world.db, application().publicId).latestPreviewId!));
  }

  function branch(name: string, message: string): string {
    work.git("checkout", "--quiet", "-b", name);
    work.write(`src/${name.replaceAll("/", "-")}.txt`, `${message}\n`);
    const commit = work.commit(message);
    work.checkout("main");
    return commit;
  }

  /** Commits on +name+ and pushes it. */
  function push(name: string, message: string): string {
    work.checkout(name);
    work.write(`src/${name.replaceAll("/", "-")}.txt`, `${message}\n`);
    const commit = work.commit(message);
    work.git("push", "--quiet", remote.path, name);
    work.checkout("main");
    return commit;
  }

  const application = () => getApplication(world.db, "orders-portal");
  const saved = (key: string) => findSavedPreview(world.db, application().publicId, key)!;
  const row = (key: string) => getSavedPreviewRow(world.db, saved(key).publicId);
  const build = (id: number): PreviewBuild => world.db.select().from(previewBuilds).where(eq(previewBuilds.id, id)).get()!;
  const preparationOf = (key: string): PreviewPreparation => world.db.select().from(previewPreparations).where(eq(previewPreparations.id, row(key).latestPreparationId!)).get()!;
  const latestOf = (key: string) => build(row(key).latestPreviewId!);
  const publish = (preview: PreviewBuild) => publishFiles(world.db, config, findPreview(world.db, preview.publicId)!, { "index.html": "<!doctype html><h1>Orders</h1>" });
  const buildJobs = () => world.db.select().from(jobs).where(eq(jobs.kind, BUILD_PREVIEW)).all();
  const save = (ref: string) => createSavedPreview(world.db, application().publicId, { ref }, { config });

  it("saves a feature branch as Building, leaving the tracked branch, current build, and builds list as they were (Saving a feature branch)", async () => {
    await ordersPortal();
    const before = application();
    const history = applicationHistory(world.db, getApplicationRow(world.db, before.publicId).id);

    const { saved: created, created: fresh } = await save("refs/heads/feature/new-nav");
    expect(fresh).toBe(true);
    expect(created).toMatchObject({ key: "feature-new-nav", ref: "refs/heads/feature/new-nav", label: "feature/new-nav", kind: "branch", status: "building", image: "placeholder", current: null });
    expect(application()).toMatchObject({ trackedRef: "refs/heads/main", status: before.status, current: before.current });
    expect(applicationHistory(world.db, getApplicationRow(world.db, before.publicId).id)).toEqual(history);
  });

  it("takes a saved preview through building, ready, a later failure that keeps its current build, and not previewable", async () => {
    await ordersPortal();
    await save("refs/heads/feature/new-nav");
    // Still profiling: no build yet.
    expect(saved("feature-new-nav")).toMatchObject({ status: "building", latest: { build: null } });

    decide(world.db, repository, preparationOf("feature-new-nav"));
    expect(saved("feature-new-nav")).toMatchObject({ status: "building", latest: { build: { attemptState: "queued" } } });
    const first = publish(latestOf("feature-new-nav"));
    expect(saved("feature-new-nav")).toMatchObject({ status: "ready", image: "capturing", current: { preview: first.publicId } });
    // Its screenshot waits behind applications' screenshots.
    expect(world.db.select().from(jobs).where(eq(jobs.kind, CAPTURE_SCREENSHOT)).all().find((job) => job.payload.includes(first.publicId))).toMatchObject({ priority: JOB_PRIORITIES.background });

    // The branch moves and the new commit fails: the last good build stays current.
    const next = push("feature/new-nav", "Broken nav");
    await rebuildSavedPreview(world.db, saved("feature-new-nav").publicId, { config });
    decide(world.db, repository, preparationOf("feature-new-nav"));
    failAttempt(world.db, latestOf("feature-new-nav").publicId, { attempt: 1 }, "vite build exited with code 1");
    expect(saved("feature-new-nav")).toMatchObject({ status: "latest_build_failed", latest: { commitSha: next, outcome: "failed", reasons: [{ text: "vite build exited with code 1" }] }, current: { preview: first.publicId } });

    // A refused commit can't be previewed, and the last good build still stays.
    push("feature/new-nav", "Drop vite");
    await rebuildSavedPreview(world.db, saved("feature-new-nav").publicId, { config });
    decide(world.db, repository, preparationOf("feature-new-nav"), [refusedVerdict(".")]);
    expect(saved("feature-new-nav")).toMatchObject({ status: "latest_not_previewable", latest: { outcome: "not_previewable", build: null }, current: { preview: first.publicId } });
    // None of it is the application's history.
    expect(applicationHistory(world.db, getApplicationRow(world.db, application().publicId).id)).toHaveLength(1);
  });

  it("fails a first build, and makes a build that emitted no page not previewable (Failed first build)", async () => {
    await ordersPortal();
    await save("refs/heads/feature/new-nav");
    decide(world.db, repository, preparationOf("feature-new-nav"));
    failAttempt(world.db, latestOf("feature-new-nav").publicId, { attempt: 1 }, "pnpm install exited with code 1");
    expect(saved("feature-new-nav")).toMatchObject({ status: "build_failed", image: "failure", current: null });

    await save("refs/tags/v1.1.0");
    decide(world.db, repository, preparationOf("v1.1.0"));
    failAttempt(world.db, latestOf("v1.1.0").publicId, { attempt: 1 }, NO_PAGE_REASON);
    expect(saved("v1.1.0")).toMatchObject({ kind: "tag", status: "not_previewable", latest: { reasons: [{ text: NO_PAGE_REASON, condition: "page" }] } });
  });

  it("refuses the tracked branch (The tracked branch)", async () => {
    await ordersPortal();
    await expect(save("refs/heads/main")).rejects.toThrow(ValidationError);
    await expect(save("refs/heads/main")).rejects.toMatchObject({ issues: [{ field: "ref", message: "main is already the application's tracked branch." }] });
    expect(savedPreviewsOf(world.db, application().publicId)).toEqual([]);
  });

  it("returns the existing preview for a ref already saved (A ref already saved)", async () => {
    await ordersPortal();
    const first = await save("refs/heads/feature/new-nav");
    const again = await save("refs/heads/feature/new-nav");
    expect(again).toMatchObject({ created: false, saved: { publicId: first.saved.publicId, key: "feature-new-nav" } });
    expect(savedPreviewsOf(world.db, application().publicId)).toHaveLength(1);
  });

  it(`refuses a preview past the limit of ${SAVED_PREVIEW_LIMIT} (At the limit)`, async () => {
    await ordersPortal();
    const applicationId = getApplicationRow(world.db, application().publicId).id;
    for (let index = 0; index < SAVED_PREVIEW_LIMIT; index++) {
      rawRun(
        world.db,
        "insert into application_previews (public_id, application_id, key, ref, latest_commit_sha, latest_outcome, latest_reasons, latest_requested_at, created_at, updated_at) values (?, ?, ?, ?, ?, 'failed', '[{\"text\":\"no\"}]', 0, 0, 0)",
        `apv_${String(index).padStart(16, "0")}`,
        applicationId,
        `old-${index}`,
        `refs/heads/old/${index}`,
        "e".repeat(40),
      );
    }
    await expect(save("refs/heads/feature/new-nav")).rejects.toMatchObject({ issues: [{ field: "ref", message: "An application can keep 20 previews. Remove a preview to save another." }] });
    // A ref already saved still opens.
    await expect(save("refs/heads/old/3")).resolves.toMatchObject({ created: false, saved: { key: "old-3" } });
  });

  it("reuses the build Show made, settling at once with no second build (From preview mode)", async () => {
    await ordersPortal();
    await buildRef(world.db, application(), "refs/heads/fix/totals", config);
    const shown = world.db.select().from(previewPreparations).where(eq(previewPreparations.refName, "refs/heads/fix/totals")).get()!;
    decide(world.db, repository, shown);
    await buildRef(world.db, application(), "refs/heads/fix/totals", config);
    const showBuild = world.db.select().from(previewBuilds).where(eq(previewBuilds.preparationId, shown.id)).get()!;
    publish(showBuild);
    const builds = buildJobs().length;

    const { saved: kept } = await save("refs/heads/fix/totals");
    expect(kept).toMatchObject({ key: "fix-totals", status: "ready", current: { preview: showBuild.publicId } });
    expect(buildJobs()).toHaveLength(builds);
  });

  it("follows a build Show started, rather than starting another", async () => {
    await ordersPortal();
    await buildRef(world.db, application(), "refs/heads/fix/totals", config);
    decide(world.db, repository, world.db.select().from(previewPreparations).where(eq(previewPreparations.refName, "refs/heads/fix/totals")).get()!);
    await buildRef(world.db, application(), "refs/heads/fix/totals", config);
    const builds = buildJobs().length;
    const { saved: kept } = await save("refs/heads/fix/totals");
    expect(kept).toMatchObject({ status: "building", latest: { build: { attemptState: "queued" } } });
    expect(buildJobs()).toHaveLength(builds);
    publish(latestOf("fix-totals"));
    expect(saved("fix-totals").status).toBe("ready");
  });

  it("rebuilds a saved tag's commit again, and refuses while it builds (Rebuilding a tag)", async () => {
    await ordersPortal();
    await save("refs/tags/v1.1.0");
    await expect(rebuildSavedPreview(world.db, saved("v1.1.0").publicId, { config })).rejects.toThrow(ApplicationBuildError);
    decide(world.db, repository, preparationOf("v1.1.0"));
    const first = publish(latestOf("v1.1.0"));
    await rebuildSavedPreview(world.db, saved("v1.1.0").publicId, { config });
    expect(saved("v1.1.0")).toMatchObject({ status: "building", latest: { build: { preview: first.publicId, attempt: 2, attemptState: "queued" } }, current: { preview: first.publicId } });
  });

  it("removes a saved preview, and removes the preview of a branch the application starts tracking (Removing a preview, Tracking a saved branch)", async () => {
    await ordersPortal();
    await save("refs/heads/feature/new-nav");
    await save("refs/heads/fix/totals");
    expect(removeSavedPreview(world.db, application().publicId, "fix-totals")).toBe("refs/heads/fix/totals");
    expect(removeSavedPreview(world.db, application().publicId, "fix-totals")).toBeNull();

    await editApplication(world.db, application().publicId, application().lockVersion, { name: "Orders portal", description: "", branch: "feature/new-nav" }, { config });
    expect(application().trackedRef).toBe("refs/heads/feature/new-nav");
    expect(savedPreviewsOf(world.db, application().publicId)).toEqual([]);
  });

  it("lists saved previews by name, branches before a tag of the same name", async () => {
    await ordersPortal();
    await save("refs/tags/v1.1.0");
    await save("refs/heads/fix/totals");
    await save("refs/heads/feature/new-nav");
    expect(savedPreviewsOf(world.db, application().publicId).map((preview) => preview.key)).toEqual(["feature-new-nav", "fix-totals", "v1.1.0"]);
  });
});
