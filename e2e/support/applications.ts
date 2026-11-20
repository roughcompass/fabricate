import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createApplication, prepareBranch } from "../../src/lib/applications/pipeline";
import { type ApplicationRow, getApplicationRow } from "../../src/lib/applications/records";
import { type SavedPreview, findSavedPreview, savedPreviewKey } from "../../src/lib/applications/saved-previews";
import type { Db } from "../../src/lib/db/client";
import { applicationPreviews, previewBuilds, repositories } from "../../src/lib/db/schema";
import { type PreviewBuild, failAttempt, findPreparation, startPreview } from "../../src/lib/previews/records";
import { completeScreenshot, findScreenshot } from "../../src/lib/previews/screenshots";
import { previewDirectory } from "../../src/lib/previews/storage";
import { resolveCloneUrl } from "../../src/lib/repositories/registration";
import { type Repository, insertRepository } from "../../src/lib/repositories/repository-records";
import { SourceBoundary } from "../../src/lib/repositories/source-boundary";
import { onboard, qualifyingVerdict, decidedPreparation } from "../../test/support/applications";
import type { Tree } from "../../test/support/preview-trees";
import { publishFiles } from "../../test/support/previews";
import { gitRepo } from "./fixtures";
import { runJobs, serverConfig } from "./results";

/*
 * Applications for browser tests. `onboarded` creates one from a real
 * repository through the pipeline, as onboarding does, so its jobs build it
 * offline and capture its screenshot. `seeded` writes one straight into the
 * database in a chosen state, with a stand-in screenshot, for pages that only
 * show applications.
 */

/** A repository of +tree+ at +directory+ on main, registered as a Repository; not enrolled until an application is created from it. */
export function registered(db: Db, directory: string, tree: Tree): Repository {
  gitRepo(directory, tree);
  return insertRepository(db, { name: path.basename(directory), ...resolveCloneUrl(`file://${directory}`, new SourceBoundary(serverConfig())), gitRef: null });
}

/**
 * Onboards each repository's main branch under its name, as onboarding does:
 * every commit is checked first, running the queued jobs, then each
 * application is created with its first build queued, unbuilt.
 */
export async function onboarded(db: Db, ...entries: [repository: Repository, name: string][]): Promise<ApplicationRow[]> {
  const preparations: { publicId: string }[] = [];
  for (const [repository] of entries) preparations.push(await prepareBranch(db, repository.publicId, "main", { config: serverConfig() }));
  await runJobs(db);
  return entries.map(([repository, name], index) =>
    createApplication(db, { repository: repository.publicId, branch: "main", packageDir: ".", preparation: findPreparation(db, preparations[index]!.publicId)!.publicId, name, description: `${name} for partners`, trusted: true }, serverConfig()),
  );
}

/** A stand-in screenshot: a WebP image of one pixel, served as the card and the page's image. */
const PIXEL = Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=", "base64");

export type SeededState = "building" | "ready" | "failed" | "unavailable" | "capturing";

/**
 * An application named +name+ of +options.repository+, or of a new Repository with no remote, written
 * straight into the database in +state+: its first build queued, published
 * with a screenshot, failed, published without one, or published with its
 * screenshot still pending. Its jobs never run.
 */
export function seeded(db: Db, name: string, options: { state?: SeededState; framework?: string; branch?: string; description?: string; repository?: Repository; packageDir?: string } = {}): ApplicationRow {
  const config = serverConfig();
  const repository = options.repository ?? insertRepository(db, { name: `spa-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, cloneUrl: `https://git.example.com/acme/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.git`, canonicalUrl: `https://git.example.com/acme/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, gitRef: null });
  const packageDir = options.packageDir ?? ".";
  const created = onboard(db, config, repository, { name, description: options.description ?? "", framework: options.framework, branch: options.branch, packageDir, preparation: decidedPreparation(db, repository, [qualifyingVerdict(packageDir, { framework: options.framework })]) });
  const preview = db.select().from(previewBuilds).where(eq(previewBuilds.id, created.latestPreviewId!)).get()!;
  const state = options.state ?? "ready";
  if (state === "failed") failAttempt(db, preview.publicId, { attempt: 1 }, "The install failed: npm ci exited with code 1.");
  if (state === "ready" || state === "unavailable" || state === "capturing") {
    const published = publishFiles(db, config, preview, { "index.html": `<!doctype html><title>${name}</title><h1>${name}</h1>` });
    if (state === "ready") captured(db, published);
    if (state === "unavailable") db.$client.prepare("update preview_screenshots set state = 'unavailable', reason = 'The browser could not start.' where preview_id = ?").run(published.id);
  }
  return created;
}

/** Records a stand-in screenshot of +preview+'s published output, as the capture job would. */
export function captured(db: Db, preview: PreviewBuild): void {
  const config = serverConfig();
  const screenshot = findScreenshot(db, preview.id)!;
  const directory = path.join(previewDirectory(config, preview.publicId), "screenshots", "1-test");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "screenshot.webp"), PIXEL);
  fs.writeFileSync(path.join(directory, "card.webp"), PIXEL);
  completeScreenshot(db, preview.id, screenshot.requestedAt.getTime(), "screenshots/1-test");
}

/**
 * A saved preview of +ref+ for +application+, written straight into the
 * database in +state+, with a commit and build of its own: building, ready
 * with a stand-in screenshot, failed, or ready with a later build that failed.
 * The build settles the saved preview through the pipeline's hooks, as a real
 * build would; its jobs never run.
 */
export function seededPreview(db: Db, application: Pick<ApplicationRow, "publicId">, ref: string, options: { state?: "building" | "ready" | "failed" | "latest_failed"; title?: string } = {}): SavedPreview {
  const config = serverConfig();
  const row = getApplicationRow(db, application.publicId);
  const repository = db.select().from(repositories).where(eq(repositories.id, row.repositoryId)).get()!;
  const taken = db.select({ key: applicationPreviews.key }).from(applicationPreviews).where(eq(applicationPreviews.applicationId, row.id)).all();
  const key = savedPreviewKey(ref, taken.map((other) => other.key));
  const build = () => {
    const preparation = decidedPreparation(db, repository, [qualifyingVerdict(row.packageDir)]);
    return startPreview(db, preparation.publicId, row.packageDir).preview;
  };
  const first = build();
  db.insert(applicationPreviews)
    .values({ publicId: `apv_${crypto.randomBytes(8).toString("hex")}`, applicationId: row.id, key, ref, latestPreparationId: first.preparationId, latestPreviewId: first.id, latestCommitSha: first.commitSha, latestRequestedAt: new Date(), createdAt: new Date(), updatedAt: new Date() })
    .run();
  const state = options.state ?? "ready";
  const title = options.title ?? ref.replace(/^refs\/(heads|tags)\//, "");
  if (state === "failed") failAttempt(db, first.publicId, { attempt: 1 }, "The build failed: vite build exited with code 1.");
  if (state === "ready" || state === "latest_failed") captured(db, publishFiles(db, config, first, { "index.html": `<!doctype html><title>${title}</title><h1>${title}</h1>` }));
  if (state === "latest_failed") {
    const next = build();
    db.update(applicationPreviews).set({ latestPreparationId: next.preparationId, latestPreviewId: next.id, latestCommitSha: next.commitSha, latestOutcome: "building" }).where(eq(applicationPreviews.key, key)).run();
    failAttempt(db, next.publicId, { attempt: 1 }, "The build failed: vite build exited with code 1.");
  }
  return findSavedPreview(db, application.publicId, key)!;
}

/** Publishes a seeded saved preview's queued first build, as the build job would, with a stand-in screenshot. */
export function publishSeededPreview(db: Db, application: Pick<ApplicationRow, "publicId">, key: string): SavedPreview {
  const saved = findSavedPreview(db, application.publicId, key)!;
  const preview = db.select().from(previewBuilds).where(eq(previewBuilds.publicId, saved.latest.build!.preview)).get()!;
  captured(db, publishFiles(db, serverConfig(), preview, { "index.html": `<!doctype html><title>${saved.label}</title><h1>${saved.label}</h1>` }));
  return findSavedPreview(db, application.publicId, key)!;
}
