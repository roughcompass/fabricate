import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FrontendRegistryConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { JOB_PRIORITIES, jobs, previewScreenshots, screenshotFailedCalls } from "@/lib/db/schema";
import { failureText } from "@/lib/git/redact";
import { enqueue, jobPayload } from "@/lib/jobs/queue";
import type { PreviewBuild } from "./records";
import { previewDirectory } from "./storage";

/**
 * Screenshots of published previews (add-applications, design decision 4).
 * An application's current build is captured after it publishes: a
 * `preview.screenshot` job opens the build in a headless browser and writes
 * `screenshot.webp` and a 720-pixel-wide `card.webp` beside the build's
 * output, under `screenshots/<attempt>-<claim>/` in the preview's storage
 * directory, named for the artifact it shows. A capture that fails records
 * the screenshot as unavailable and never touches the build; the next
 * successful build tries again.
 */

export type PreviewScreenshot = typeof previewScreenshots.$inferSelect;

export const CAPTURE_SCREENSHOT = "preview.screenshot";

/** The images a capture writes, by size. */
export const SCREENSHOT_FILES = { full: "screenshot.webp", card: "card.webp" } as const;
export type ScreenshotSize = keyof typeof SCREENSHOT_FILES;

export function findScreenshot(db: Executor, previewId: number): PreviewScreenshot | undefined {
  return db.select().from(previewScreenshots).where(eq(previewScreenshots.previewId, previewId)).get();
}

/** The mock set a capture should apply, by ID and revision, or null for none (add-mock-sets, design decision 11). */
export type ExpectedMocks = { readonly publicId: string; readonly revision: number } | null;

/** Whether +screenshot+ was captured with +mocks+. */
function capturedWith(screenshot: PreviewScreenshot, mocks: ExpectedMocks): boolean {
  return (screenshot.mockSetPublicId ?? null) === (mocks?.publicId ?? null) && (mocks === null || screenshot.mockSetRevision === mocks.revision);
}

/**
 * Asks for a screenshot of +preview+'s published artifact, unless one of
 * that artifact is already captured or on its way. A screenshot of an
 * earlier artifact, or one that couldn't be captured, is taken again. The
 * job is queued in the caller's transaction, at +priority+: normal for an
 * application's current build, background for a saved preview's
 * (restore-toolbar-tools-and-branch-previews, design decision 3). One on its
 * way at a lower priority is raised.
 *
 * With +mocks+, the mock set the build's target applies now (add-mock-sets,
 * design decision 11), a ready screenshot captured with another set or
 * revision is captured again. Its images stay shown until the new capture
 * completes, since only its request time moves on, so a newer request
 * supersedes an older one still waiting.
 */
export function requestScreenshot(db: Executor, preview: Pick<PreviewBuild, "id" | "publicId" | "artifact">, priority: number = JOB_PRIORITIES.normal, mocks?: ExpectedMocks): PreviewScreenshot | null {
  if (preview.artifact === null) return null;
  const existing = findScreenshot(db, preview.id);
  const sameArtifact = existing && existing.artifact === preview.artifact && existing.state !== "unavailable";
  if (existing && sameArtifact && (mocks === undefined || existing.state === "pending" || capturedWith(existing, mocks) || requestedWith(db, preview.publicId, existing, mocks))) {
    if (existing.state === "pending") enqueue(db, { kind: CAPTURE_SCREENSHOT, payload: screenshotJob(preview.publicId, existing), idempotencyKey: screenshotJobKey(preview.publicId, existing), priority, raisePriority: true });
    return existing;
  }
  const now = new Date();
  // Each request is later than the last, so its job's idempotency key is new.
  const requestedAt = existing ? new Date(Math.max(now.getTime(), existing.requestedAt.getTime() + 1)) : now;
  const values = sameArtifact ? { requestedAt, updatedAt: now } : { artifact: preview.artifact, state: "pending" as const, directory: null, reason: null, requestedAt, capturedAt: null, updatedAt: now };
  const screenshot = existing
    ? db.update(previewScreenshots).set(values).where(eq(previewScreenshots.id, existing.id)).returning().get()
    : db
        .insert(previewScreenshots)
        .values({ ...values, artifact: preview.artifact, previewId: preview.id, createdAt: now })
        .returning()
        .get();
  const payload = mocks === undefined ? screenshotJob(preview.publicId, screenshot) : { ...screenshotJob(preview.publicId, screenshot), mocks: mocksKey(mocks) };
  enqueue(db, { kind: CAPTURE_SCREENSHOT, payload, idempotencyKey: screenshotJobKey(preview.publicId, screenshot), priority });
  return screenshot;
}

/** A mock set as a capture's job records the one it was asked for. */
function mocksKey(mocks: ExpectedMocks): string {
  return mocks ? `${mocks.publicId}@${mocks.revision}` : "none";
}

/** Whether the capture last asked of +screenshot+ is still waiting, for +mocks+: then asking again changes nothing. */
function requestedWith(db: Executor, previewPublicId: string, screenshot: PreviewScreenshot, mocks: ExpectedMocks): boolean {
  const job = db.select().from(jobs).where(eq(jobs.idempotencyKey, screenshotJobKey(previewPublicId, screenshot))).get();
  return !!job && (job.state === "queued" || job.state === "running") && jobPayload(job).mocks === mocksKey(mocks);
}

export interface ScreenshotJob {
  preview: string;
  /** When the capture was requested, so a job for an earlier request changes nothing. */
  requested: number;
}

function screenshotJob(previewPublicId: string, screenshot: Pick<PreviewScreenshot, "requestedAt">): { preview: string; requested: number } {
  return { preview: previewPublicId, requested: screenshot.requestedAt.getTime() };
}

function screenshotJobKey(previewPublicId: string, screenshot: Pick<PreviewScreenshot, "requestedAt">): string {
  return `${CAPTURE_SCREENSHOT}:${previewPublicId}:${screenshot.requestedAt.getTime()}`;
}

/** What a capture recorded beside its images: the mock set it applied, as it was, and the API calls that failed. */
export interface CaptureRecord {
  readonly mocks: { readonly publicId: string; readonly name: string; readonly revision: number } | null;
  /** Distinct failed calls, up to 50 of them kept, and how many there were in all. */
  readonly failures: { readonly total: number; readonly calls: readonly Omit<typeof screenshotFailedCalls.$inferInsert, "screenshotId" | "position">[] };
}

/**
 * Records the captured images in +directory+ for the request +requested+,
 * with the mock set it applied and the calls that failed, replacing those of
 * the capture before, in one transaction, unless it was since requested
 * again. A ready screenshot captured again keeps its images until this.
 */
export function completeScreenshot(db: Executor, previewId: number, requested: number, directory: string, now = new Date(), record?: CaptureRecord): boolean {
  return immediate(db, (tx) => {
    const updated = tx
      .update(previewScreenshots)
      .set({
        state: "ready",
        directory,
        reason: null,
        capturedAt: now,
        updatedAt: now,
        ...(record && { mockSetPublicId: record.mocks?.publicId ?? null, mockSetName: record.mocks?.name ?? null, mockSetRevision: record.mocks?.revision ?? null, failedCalls: record.failures.total, failuresDismissedAt: null }),
      })
      .where(and(eq(previewScreenshots.previewId, previewId), inArray(previewScreenshots.state, ["pending", "ready"]), eq(previewScreenshots.requestedAt, new Date(requested))))
      .returning({ id: previewScreenshots.id })
      .get();
    if (!updated) return false;
    if (record) {
      tx.delete(screenshotFailedCalls).where(eq(screenshotFailedCalls.screenshotId, updated.id)).run();
      record.failures.calls.slice(0, FAILED_CALLS_KEPT).forEach((call, position) => tx.insert(screenshotFailedCalls).values({ ...call, screenshotId: updated.id, position }).run());
    }
    return true;
  });
}

/** How many distinct failed calls a capture keeps. */
export const FAILED_CALLS_KEPT = 50;

/** Records why the request +requested+ couldn't be captured, unless it was since requested again. */
export function failScreenshot(db: Executor, previewId: number, requested: number, reason: string, now = new Date()): boolean {
  return (
    db
      .update(previewScreenshots)
      .set({ state: "unavailable", directory: null, reason: failureText(reason, 1_000) || "The screenshot couldn't be captured", capturedAt: null, updatedAt: now })
      .where(and(eq(previewScreenshots.previewId, previewId), eq(previewScreenshots.state, "pending"), eq(previewScreenshots.requestedAt, new Date(requested))))
      .run().changes === 1
  );
}

/**
 * Marks unavailable every pending screenshot whose job can no longer capture
 * it: the job failed, for example after the worker stopped on every try, or
 * no longer exists. Without this such a screenshot would stay pending, and
 * its application's image would show the placeholder forever.
 */
export function settleAbandonedScreenshots(db: Executor, now = new Date()): number {
  const key = sql`${`${CAPTURE_SCREENSHOT}:`} || (SELECT b.public_id FROM preview_builds b WHERE b.id = ${previewScreenshots.previewId}) || ':' || ${previewScreenshots.requestedAt}`;
  const rows = db
    .select({ previewId: previewScreenshots.previewId, requestedAt: previewScreenshots.requestedAt, job: jobs.id, state: jobs.state, tries: jobs.attempts, maxTries: jobs.maxAttempts, leaseExpiresAt: jobs.leaseExpiresAt })
    .from(previewScreenshots)
    .leftJoin(jobs, eq(jobs.idempotencyKey, key))
    .where(eq(previewScreenshots.state, "pending"))
    .all();
  let settled = 0;
  for (const row of rows) {
    const abandoned = row.job === null || row.state === "failed" || row.state === "succeeded" || (row.state === "running" && row.leaseExpiresAt !== null && row.leaseExpiresAt <= now && row.tries! >= row.maxTries!);
    if (abandoned && failScreenshot(db, row.previewId, row.requestedAt.getTime(), "The capture stopped before it finished: the worker running it stopped or lost the job.", now)) settled += 1;
  }
  return settled;
}

/** Where a capture of the artifact +artifact+ (out/<attempt>-<claim>) writes its images, relative to the preview's directory. */
export function screenshotDirectoryName(artifact: string): string {
  const key = artifact.split("/").at(-1) ?? "";
  if (!/^\d+-[a-z0-9]+$/.test(key)) throw new Error(`${JSON.stringify(artifact)} doesn't name a published artifact`);
  return `screenshots/${key}`;
}

/** The image file of a ready screenshot, or null when it has none or its file is missing. */
export function screenshotFile(config: FrontendRegistryConfig, previewPublicId: string, screenshot: Pick<PreviewScreenshot, "state" | "directory">, size: ScreenshotSize): string | null {
  if (screenshot.state !== "ready" || screenshot.directory === null || !/^screenshots\/\d+-[a-z0-9]+$/.test(screenshot.directory)) return null;
  // The ignores keep the web server's build from tracing every file the pattern could reach: the images live in previews.storage, outside the build.
  const file = path.join(/*turbopackIgnore: true*/ previewDirectory(config, previewPublicId), ...screenshot.directory.split("/"), SCREENSHOT_FILES[size]);
  return fs.existsSync(/*turbopackIgnore: true*/ file) ? file : null;
}
