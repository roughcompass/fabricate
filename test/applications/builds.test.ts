import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ApplicationBuildError, buildApplication, createApplication, editApplication, rebuildApplication } from "@/lib/applications/pipeline";
import { type Application, getApplication, getApplicationRow } from "@/lib/applications/records";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, withOverrides } from "@/lib/config";
import { jobs, previewBuilds, previewPreparations } from "@/lib/db/schema";
import { requestPreparation } from "@/lib/previews/preparation";
import { BUILD_PREVIEW, type PreviewBuild, type PreviewPreparation, failAttempt, failPreparation, findPreview, rebuildPreview, startPreview } from "@/lib/previews/records";
import { CAPTURE_SCREENSHOT, findScreenshot } from "@/lib/previews/screenshots";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { decide, qualifyingVerdict, refusedVerdict } from "../support/applications";
import type { BareRepo, Repo } from "../support/git-fixture";
import { publishFiles } from "../support/previews";
import { VITE_REACT_APP } from "../support/preview-trees";

/*
 * Applications through the preview pipeline (add-applications, design
 * decision 2; tasks 2.1 and 2.3): an attempt pins the tracked branch's head
 * and opens its preparation, decided here as its job would; the build it
 * starts is then published or failed as the build job would. A successful
 * build becomes current; a failed or refused later attempt leaves the
 * current build in use; Rebuild waits for an attempt to finish; and a
 * branch switch keeps the current build until the new branch's succeeds.
 */

describe("application builds", () => {
  const world = useAcquisitionWorld("application-builds");
  let config: FrontendRegistryConfig;
  let work: Repo;
  let remote: BareRepo;
  let repository: Repository;

  /** A remote holding a Vite app on main, registered, enrolled, and onboarded as Orders portal, its first build queued. */
  async function onboarded(): Promise<Application> {
    work = world.fixture.repo("work/orders");
    for (const [file, content] of Object.entries(VITE_REACT_APP)) work.write(file, content);
    work.commit("initial");
    remote = world.fixture.bare("remotes/orders.git", { from: work });
    repository = registerLocalRepository(world.db, world.config, "spa-orders", remote.path);
    config = withOverrides(world.config, { previews: { enabled: true, trustedSources: [repository.cloneUrl] } });
    const preparation = decide(world.db, repository, await requestPreparation(world.db, repository.publicId, { kind: "ref", name: "refs/heads/main" }, { config }));
    createApplication(world.db, { repository: repository.publicId, branch: "main", packageDir: ".", preparation: preparation.publicId, name: "Orders portal", description: "" }, config);
    return shown();
  }

  const shown = () => getApplication(world.db, "orders-portal");
  const row = () => getApplicationRow(world.db, shown().publicId);
  const preview = (publicId: string): PreviewBuild => findPreview(world.db, publicId)!;
  const latestPreparation = (): PreviewPreparation => world.db.select().from(previewPreparations).where(eq(previewPreparations.id, row().latestPreparationId!)).get()!;
  const latestPreview = (): PreviewBuild => world.db.select().from(previewBuilds).where(eq(previewBuilds.id, row().latestPreviewId!)).get()!;
  const publish = (build: PreviewBuild) => publishFiles(world.db, config, build, { "index.html": "<!doctype html><h1>Orders</h1>" });
  const buildJobs = () => world.db.select().from(jobs).where(eq(jobs.kind, BUILD_PREVIEW)).all().length;

  /** Commits a change on +branch+ and pushes it. */
  function push(message: string, branch = "main", file = "src/note.txt"): string {
    if (branch !== "main") work.git("checkout", "--quiet", "-B", branch);
    work.write(file, `${message}\n`);
    const commit = work.commit(message);
    work.git("push", "--quiet", remote.path, branch);
    if (branch !== "main") work.checkout("main");
    return commit;
  }

  it("makes a successful build current and asks for its screenshot (New commit succeeds)", async () => {
    const created = await onboarded();
    expect(created).toMatchObject({ status: "building", image: "placeholder", current: null });

    publish(latestPreview());
    const ready = shown();
    expect(ready).toMatchObject({ status: "ready", image: "capturing", settling: true, latest: { outcome: "ready", reasons: [] } });
    expect(ready.current).toEqual(ready.latest.build);
    expect(findScreenshot(world.db, row().currentPreviewId!)).toMatchObject({ state: "pending", artifact: "out/1-test" });
    expect(world.db.select().from(jobs).where(eq(jobs.kind, CAPTURE_SCREENSHOT)).all()).toHaveLength(1);
  });

  it("keeps the previous build current when a newer commit's build fails (New commit fails)", async () => {
    await onboarded();
    const first = publish(latestPreview());
    const next = push("second");

    await buildApplication(world.db, shown().publicId, { config });
    // The commit is still being profiled: no build yet, and the last good one stays.
    expect(shown()).toMatchObject({ status: "building", image: "capturing", latest: { commitSha: next, build: null }, current: { preview: first.publicId } });

    decide(world.db, repository, latestPreparation());
    const attempt = latestPreview();
    expect(attempt).toMatchObject({ commitSha: next, attemptState: "queued" });
    failAttempt(world.db, attempt.publicId, { attempt: 1 }, "The install failed: pnpm install --frozen-lockfile exited with code 1.");

    expect(shown()).toMatchObject({
      status: "latest_build_failed",
      latest: { outcome: "failed", commitSha: next, reasons: [{ text: "The install failed: pnpm install --frozen-lockfile exited with code 1." }], build: { preview: attempt.publicId, attemptState: "failed" } },
      current: { preview: first.publicId, commitSha: first.commitSha },
    });
  });

  it("records a refused commit as not previewable with each failed condition, and builds nothing (Commit stops qualifying)", async () => {
    await onboarded();
    const first = publish(latestPreview());
    push("drop vite");
    await buildApplication(world.db, shown().publicId, { config });
    const before = buildJobs();

    decide(world.db, repository, latestPreparation(), [refusedVerdict(".")]);
    expect(shown()).toMatchObject({
      status: "latest_not_previewable",
      latest: { outcome: "not_previewable", build: null, reasons: [{ text: "No supported build tool applies to this package. Previews support Vite, webpack, Rspack, and Rsbuild.", condition: "build_tool" }] },
      current: { preview: first.publicId },
    });
    expect(buildJobs()).toBe(before);
  });

  it("names the package's absence when the commit no longer has it", async () => {
    await onboarded();
    publish(latestPreview());
    push("move the app");
    await buildApplication(world.db, shown().publicId, { config });
    decide(world.db, repository, latestPreparation(), [qualifyingVerdict("apps/web")]);
    expect(shown().latest).toMatchObject({ outcome: "not_previewable", reasons: [{ text: "This commit has no package at the repository root." }] });
  });

  it("shows a first build that failed, and one whose commit couldn't be prepared, with the reason (First build fails)", async () => {
    await onboarded();
    failAttempt(world.db, latestPreview().publicId, { attempt: 1 }, "The lockfile is out of date");
    expect(shown()).toMatchObject({ status: "build_failed", image: "failure", settling: false, current: null, latest: { reasons: [{ text: "The lockfile is out of date" }] } });

    push("second");
    await buildApplication(world.db, shown().publicId, { config });
    const preparation = latestPreparation();
    failPreparation(world.db, preparation.publicId, preparation.requestedAt.getTime(), "The commit couldn't be surveyed: timeout");
    expect(shown()).toMatchObject({ status: "build_failed", latest: { outcome: "failed", reasons: [{ text: "The commit couldn't be surveyed: timeout" }] } });
  });

  it("refuses Rebuild while an attempt is active, and then builds the same commit again (Rebuilding after a fix to the build environment)", async () => {
    await onboarded();
    await expect(rebuildApplication(world.db, shown().publicId, { config })).rejects.toThrow(ApplicationBuildError);

    const failed = latestPreview();
    failAttempt(world.db, failed.publicId, { attempt: 1 }, "Node 22 isn't configured");
    await rebuildApplication(world.db, shown().publicId, { config });
    expect(shown()).toMatchObject({ status: "building", latest: { commitSha: failed.commitSha, build: { preview: failed.publicId, attempt: 2, attemptState: "queued" } } });

    // A successful build is built again too, while the current one stays in use.
    publish(preview(failed.publicId));
    await rebuildApplication(world.db, shown().publicId, { config });
    expect(shown()).toMatchObject({ status: "building", image: "capturing", current: { preview: failed.publicId }, latest: { build: { attempt: 3, attemptState: "queued" } } });
    await expect(rebuildApplication(world.db, shown().publicId, { config })).rejects.toThrow(/already building/);
  });

  it("follows a rebuild of its latest build started from the preview page", async () => {
    await onboarded();
    const first = publish(latestPreview());
    rebuildPreview(world.db, first.publicId);
    expect(shown()).toMatchObject({ status: "building", current: { preview: first.publicId } });
    failAttempt(world.db, first.publicId, { attempt: 2 }, "Out of memory");
    expect(shown()).toMatchObject({ status: "latest_build_failed", current: { preview: first.publicId } });
  });

  it("uses a commit's existing successful build at once rather than building it again", async () => {
    await onboarded();
    publish(latestPreview());
    const next = push("second");
    // Someone previewed the new commit from the Repository page first.
    const earlier = decide(world.db, repository, await requestPreparation(world.db, repository.publicId, { kind: "commit", sha: next }, { config }));
    const built = publish(startPreview(world.db, earlier.publicId, ".").preview);
    const before = buildJobs();

    await buildApplication(world.db, shown().publicId, { config });
    expect(shown()).toMatchObject({ status: "ready", current: { preview: built.publicId, commitSha: next } });
    expect(buildJobs()).toBe(before);
  });

  it("switches branch, keeping the current build until the new branch's succeeds, and keeps its address (Switching branch)", async () => {
    await onboarded();
    const main = publish(latestPreview());
    const release = push("release", "release/2.0");

    const before = shown();
    await editApplication(world.db, before.publicId, before.lockVersion, { name: "Orders portal", description: "", branch: "release/2.0" }, { config });
    expect(shown()).toMatchObject({ slug: "orders-portal", trackedBranch: "release/2.0", trackedRef: "refs/heads/release/2.0", status: "building", current: { preview: main.publicId }, latest: { commitSha: release } });

    decide(world.db, repository, latestPreparation());
    expect(shown().current?.preview).toBe(main.publicId);
    const built = publish(latestPreview());
    expect(shown()).toMatchObject({ status: "ready", current: { preview: built.publicId, commitSha: release } });
  });

  it("replaces an attempt under way when the branch switches, so the old one never becomes current", async () => {
    await onboarded();
    const main = latestPreview();
    push("release", "release/2.0");
    const before = shown();
    await editApplication(world.db, before.publicId, before.lockVersion, { name: "Orders portal", description: "", branch: "release/2.0" }, { config });

    publish(main);
    expect(shown()).toMatchObject({ status: "building", current: null });
  });

  it("refuses a branch the remote doesn't have, changing nothing", async () => {
    await onboarded();
    const before = shown();
    await expect(editApplication(world.db, before.publicId, before.lockVersion, { name: "Renamed", description: "", branch: "nowhere" }, { config })).rejects.toThrow(/no branch or tag named|has no refs\/heads\/nowhere/);
    expect(shown()).toMatchObject({ name: "Orders portal", trackedBranch: "main" });
    await expect(editApplication(world.db, before.publicId, before.lockVersion, { name: "Renamed", description: "", branch: "refs/tags/v1" }, { config })).rejects.toThrow(/Enter a branch name/);
  });
});
