import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { jobs, previewBuilds } from "@/lib/db/schema";
import type { Eligibility, PackageVerdict } from "@/lib/previews/eligibility";
import {
  BUILD_PREVIEW,
  PREPARE_PREVIEW,
  type PinnedCommit,
  type PreparationProfile,
  type PublishedArtifact,
  decidePreparation,
  failAttempt,
  failPreparation,
  findPreview,
  openPreparation,
  preparationJob,
  preparationPackages,
  preparationRefusal,
  publishAttempt,
  rebuildPreview,
  startPreview,
} from "@/lib/previews/records";
import { jobPayload } from "@/lib/jobs/queue";
import { buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";

/*
 * Preview records (design decision 1): one preparation per Repository and
 * commit, one preview per Repository, commit, and package, and a latest
 * attempt tracked apart from the artifact the preview last published.
 */

const COMMIT = "a".repeat(40);
const OTHER = "b".repeat(40);
const PROFILE: PreparationProfile = { document: '{"schema":"fabricate.repository_profile"}', digest: "f".repeat(64) };

const verdict = (directory: string, qualifies = true): PackageVerdict => ({
  directory,
  manifest: `${directory}/package.json`,
  name: directory,
  qualifies,
  conditions: [{ condition: "framework", passed: qualifies, reason: qualifies ? "React runs in the browser" : "No browser framework", facts: [] }],
  plan: qualifies
    ? { installRoot: ".", packageManager: { name: "pnpm", version: "9.1.0", lockfile: "pnpm-lock.yaml" }, buildTool: "vite", buildScript: "vite build", node: { version: "22.11.0", ranges: [] }, layout: "standalone", composition: null }
    : null,
});
const eligibility = (...packages: PackageVerdict[]): Eligibility => ({
  packages,
  refusal: packages.some((found) => found.qualifies) ? null : { reason: "No package qualifies for a preview", conditions: packages.flatMap((found) => found.conditions.map((condition) => ({ ...condition, package: found.directory }))) },
});
const artifact = (directory: string): PublishedArtifact => ({ directory, layout: "standalone", entry: { html: "index.html" }, outputBytes: 1_024, buildMs: 900, nodeVersion: "22.11.0", packageManager: "pnpm@9.1.0" });

describe("preview records", () => {
  let db: Db;
  let source: RepositorySource;
  const main: PinnedCommit = { commitSha: COMMIT, refName: "refs/heads/main", refKind: "branch" };
  const release: PinnedCommit = { commitSha: COMMIT, refName: "refs/heads/release/1.4", refKind: "branch" };
  const jobsOf = (kind: string) => db.select().from(jobs).where(eq(jobs.kind, kind)).all();

  beforeEach(() => {
    db = createTestDb();
    source = buildSource(db, { name: "orders" });
  });

  /** The preparation of +pinned+, decided with +outcome+ unless it was decided already. */
  const prepared = (pinned: PinnedCommit, outcome: Eligibility = eligibility(verdict("apps/web"), verdict("apps/admin"), verdict("packages/ui", false))) => {
    const { preparation, started } = openPreparation(db, source, pinned);
    return started ? decidePreparation(db, preparation.publicId, preparation.requestedAt.getTime(), PROFILE, outcome)! : preparation;
  };

  describe("preparations", () => {
    it("share one preparation among refs at one commit, keeping the ref first prepared", () => {
      const first = openPreparation(db, source, main);
      const second = openPreparation(db, source, release);

      expect(first.started).toBe(true);
      expect(second).toEqual({ preparation: first.preparation, started: false });
      expect(first.preparation).toMatchObject({ state: "profiling", commitSha: COMMIT, refName: "refs/heads/main", refKind: "branch" });
      expect(jobsOf(PREPARE_PREVIEW).map(jobPayload)).toEqual([preparationJob(first.preparation)]);
    });

    it("record the decision with every verdict, and the refusal only when nothing qualifies", () => {
      const ready = prepared(main);
      expect(ready).toMatchObject({ state: "ready", profileDocument: PROFILE.document, profileDigest: PROFILE.digest, repositoryProfileId: null, refusal: null });
      expect(preparationPackages(ready).map((found) => [found.directory, found.qualifies])).toEqual([
        ["apps/web", true],
        ["apps/admin", true],
        ["packages/ui", false],
      ]);

      const refused = prepared({ commitSha: OTHER, refName: null, refKind: "commit" }, eligibility(verdict("packages/ui", false)));
      expect(refused.state).toBe("refused");
      expect(preparationRefusal(refused)).toEqual({ reason: "No package qualifies for a preview", conditions: [expect.objectContaining({ condition: "framework", package: "packages/ui" })] });
    });

    it("ignore a late job for an earlier request, and prepare a refused or failed commit again when it's requested", () => {
      const { preparation } = openPreparation(db, source, main);
      const earlier = preparation.requestedAt.getTime();
      expect(failPreparation(db, preparation.publicId, earlier, "The detector stopped")).toMatchObject({ state: "failed", failure: "The detector stopped" });

      const again = openPreparation(db, source, release);
      expect(again.started).toBe(true);
      expect(again.preparation).toMatchObject({ state: "profiling", failure: null, refName: "refs/heads/main" });
      expect(again.preparation.requestedAt.getTime()).toBeGreaterThan(earlier);
      expect(decidePreparation(db, preparation.publicId, earlier, PROFILE, eligibility(verdict("apps/web")))).toBeNull();
      expect(jobsOf(PREPARE_PREVIEW)).toHaveLength(2);

      const refused = decidePreparation(db, preparation.publicId, again.preparation.requestedAt.getTime(), PROFILE, eligibility(verdict("apps/web", false)))!;
      expect(openPreparation(db, source, main)).toMatchObject({ started: true, preparation: { state: "profiling", profileDocument: PROFILE.document } });
      expect(refused.state).toBe("refused");
      expect(jobsOf(PREPARE_PREVIEW)).toHaveLength(3);
    });
  });

  describe("previews", () => {
    it("open the same Repository and package preview from different branches at one commit", () => {
      const preparation = prepared(main);
      expect(openPreparation(db, source, release).preparation.publicId).toBe(preparation.publicId);

      const fromMain = startPreview(db, preparation.publicId, "apps/web");
      const fromRelease = startPreview(db, openPreparation(db, source, release).preparation.publicId, "apps/web");

      expect(fromMain.created).toBe(true);
      expect(fromRelease).toEqual({ preview: fromMain.preview, created: false });
      expect(fromMain.preview).toMatchObject({ commitSha: COMMIT, packageDir: "apps/web", refName: "refs/heads/main", attempt: 1, attemptState: "queued", artifact: null, profileDigest: PROFILE.digest });
      expect(fromMain.preview.decidingFacts).toMatchObject({ directory: "apps/web", qualifies: true, plan: { buildTool: "vite" } });
      // One build is queued, for the first attempt.
      expect(jobsOf(BUILD_PREVIEW).map(jobPayload)).toEqual([{ preview: fromMain.preview.publicId, attempt: 1 }]);
    });

    it("make another package, or the package at another commit, another preview", () => {
      const web = startPreview(db, prepared(main).publicId, "apps/web").preview;
      const admin = startPreview(db, prepared(main).publicId, "apps/admin").preview;
      const later = startPreview(db, prepared({ commitSha: OTHER, refName: "refs/heads/main", refKind: "branch" }).publicId, "apps/web").preview;

      expect(new Set([web.publicId, admin.publicId, later.publicId]).size).toBe(3);
      expect(jobsOf(BUILD_PREVIEW)).toHaveLength(3);
    });

    it("start only from a ready preparation and a package that qualifies", () => {
      const profiling = openPreparation(db, source, main).preparation;
      expect(() => startPreview(db, profiling.publicId, "apps/web")).toThrow(expect.objectContaining({ name: "PreviewRequestError", code: "not_ready" }));
      const ready = decidePreparation(db, profiling.publicId, profiling.requestedAt.getTime(), PROFILE, eligibility(verdict("apps/web"), verdict("packages/ui", false)))!;
      expect(() => startPreview(db, ready.publicId, "packages/ui")).toThrow(expect.objectContaining({ code: "not_qualifying" }));
      expect(() => startPreview(db, ready.publicId, "apps/missing")).toThrow(expect.objectContaining({ code: "not_qualifying" }));
      expect(db.select().from(previewBuilds).all()).toEqual([]);
      expect(jobsOf(BUILD_PREVIEW)).toEqual([]);
    });

    it("leave the published artifact available while a rebuild runs and after it fails", () => {
      const { preview } = startPreview(db, prepared(main).publicId, "apps/web");
      expect(publishAttempt(db, preview.publicId, { attempt: 1 }, artifact("out-1"))).toBe(true);
      expect(findPreview(db, preview.publicId)).toMatchObject({ attemptState: "ready", artifact: "out-1", artifactAttempt: 1, outputBytes: 1_024, nodeVersion: "22.11.0" });

      const rebuilding = rebuildPreview(db, preview.publicId);
      expect(rebuilding).toMatchObject({ attempt: 2, attemptState: "queued", attemptReason: null, artifact: "out-1", artifactAttempt: 1, artifactLayout: "standalone", outputBytes: 1_024 });
      expect(jobsOf(BUILD_PREVIEW).map(jobPayload)).toEqual([
        { preview: preview.publicId, attempt: 1 },
        { preview: preview.publicId, attempt: 2 },
      ]);
      // A rebuild requested while one is queued doesn't start a third attempt.
      expect(rebuildPreview(db, preview.publicId).attempt).toBe(2);

      // The superseded attempt can no longer publish over it.
      expect(publishAttempt(db, preview.publicId, { attempt: 1 }, artifact("out-late"))).toBe(false);
      expect(failAttempt(db, preview.publicId, { attempt: 2 }, "vite build exited with code 1", "attempts/2/build.log")).toBe(true);
      expect(findPreview(db, preview.publicId)).toMatchObject({ attempt: 2, attemptState: "failed", attemptReason: "vite build exited with code 1", attemptLog: "attempts/2/build.log", artifact: "out-1", artifactAttempt: 1 });

      rebuildPreview(db, preview.publicId);
      expect(publishAttempt(db, preview.publicId, { attempt: 3 }, artifact("out-3"))).toBe(true);
      expect(findPreview(db, preview.publicId)).toMatchObject({ attempt: 3, attemptState: "ready", artifact: "out-3", artifactAttempt: 3, attemptReason: null });
    });

    it("let only the claim running the current attempt publish it", () => {
      const { preview } = startPreview(db, prepared(main).publicId, "apps/web");
      rawRun(db, "update preview_builds set attempt_state = 'building', attempt_claim = 'worker-b' where public_id = ?", preview.publicId);

      expect(publishAttempt(db, preview.publicId, { attempt: 1, claim: "worker-a" }, artifact("out-a"))).toBe(false);
      expect(failAttempt(db, preview.publicId, { attempt: 1, claim: "worker-a" }, "lease lost")).toBe(false);
      expect(publishAttempt(db, preview.publicId, { attempt: 1, claim: "worker-b" }, artifact("out-b"))).toBe(true);
      expect(findPreview(db, preview.publicId)!.artifact).toBe("out-b");
    });

    it("never publish to a deleted preview, and start a new one for its package", () => {
      const preparation = prepared(main);
      const { preview } = startPreview(db, preparation.publicId, "apps/web");
      rawRun(db, "update preview_builds set deleted_at = ? where public_id = ?", Date.now(), preview.publicId);

      expect(findPreview(db, preview.publicId)).toBeUndefined();
      expect(publishAttempt(db, preview.publicId, { attempt: 1 }, artifact("out-1"))).toBe(false);
      expect(() => rebuildPreview(db, preview.publicId)).toThrow(/does not exist/);
      const next = startPreview(db, preparation.publicId, "apps/web");
      expect(next.created).toBe(true);
      expect(next.preview.publicId).not.toBe(preview.publicId);
    });
  });
});
