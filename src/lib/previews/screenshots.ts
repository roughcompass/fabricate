import { eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { previewScreenshots } from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import type { PreviewBuild } from "./records";

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

function screenshotJob(previewPublicId: string, screenshot: Pick<PreviewScreenshot, "requestedAt">): { preview: string; requested: number } {
  return { preview: previewPublicId, requested: screenshot.requestedAt.getTime() };
}

function screenshotJobKey(previewPublicId: string, screenshot: Pick<PreviewScreenshot, "requestedAt">): string {
  return `${CAPTURE_SCREENSHOT}:${previewPublicId}:${screenshot.requestedAt.getTime()}`;
}
