import fs from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { jobs, previewScreenshots } from "@/lib/db/schema";
import { failureText } from "@/lib/git/redact";
import { enqueue } from "@/lib/jobs/queue";
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

/**
 * Asks for a screenshot of +preview+'s published artifact, unless one of
 * that artifact is already captured or on its way. A screenshot of an
 * earlier artifact, or one that couldn't be captured, is taken again. The
 * job is queued in the caller's transaction.
 */
export function requestScreenshot(db: Executor, preview: Pick<PreviewBuild, "id" | "publicId" | "artifact">): PreviewScreenshot | null {
  if (preview.artifact === null) return null;
  const existing = findScreenshot(db, preview.id);
  if (existing && existing.artifact === preview.artifact && existing.state !== "unavailable") return existing;
  const now = new Date();
  // Each request is later than the last, so its job's idempotency key is new.
  const requestedAt = existing ? new Date(Math.max(now.getTime(), existing.requestedAt.getTime() + 1)) : now;
  const values = { artifact: preview.artifact, state: "pending" as const, directory: null, reason: null, requestedAt, capturedAt: null, updatedAt: now };
  const screenshot = existing
    ? db.update(previewScreenshots).set(values).where(eq(previewScreenshots.id, existing.id)).returning().get()
    : db
        .insert(previewScreenshots)
        .values({ ...values, previewId: preview.id, createdAt: now })
        .returning()
        .get();
  enqueue(db, { kind: CAPTURE_SCREENSHOT, payload: screenshotJob(preview.publicId, screenshot), idempotencyKey: screenshotJobKey(preview.publicId, screenshot) });
  return screenshot;
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

/** Records the captured images in +directory+ for the request +requested+, unless it was since requested again. */
export function completeScreenshot(db: Executor, previewId: number, requested: number, directory: string, now = new Date()): boolean {
  return (
    db
      .update(previewScreenshots)
      .set({ state: "ready", directory, reason: null, capturedAt: now, updatedAt: now })
      .where(and(eq(previewScreenshots.previewId, previewId), eq(previewScreenshots.state, "pending"), eq(previewScreenshots.requestedAt, new Date(requested))))
      .run().changes === 1
  );
}

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
  const file = path.join(previewDirectory(config, previewPublicId), ...screenshot.directory.split("/"), SCREENSHOT_FILES[size]);
  return fs.existsSync(file) ? file : null;
}
