import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, getDb } from "@/lib/db/client";
import { applicationPreviews, applications, previewBuilds, previewScreenshots } from "@/lib/db/schema";
import { type ScreenshotSize, screenshotFile } from "@/lib/previews/screenshots";
import { applicationsAvailable } from "./availability";
import { type Application, withMockSet } from "./records";

/**
 * An application's screenshot and card image, served through its own
 * address (add-applications, design decision 4), never from a storage path:
 * `/applications/<slug>/screenshot` for the 1440 by 900 screenshot, and
 * `?size=card` for the 720-pixel-wide card image. Each is its current
 * build's, once captured. Anything else, including any request while
 * previews are off, answers the same plain 404. Images revalidate every
 * time, so a new build's screenshot replaces the old one; pages add the
 * screenshot's version to the address, so a card that changes loads anew.
 * `?preview=<key>` serves one of the application's saved previews' images
 * the same way (restore-toolbar-tools-and-branch-previews, task 2.3).
 */

/**
 * The text alternative for an application's screenshot: the application, the commit it shows, and the mock set it applied (add-mock-sets, design decision 11).
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function screenshotAlt(application: Pick<Application, "name" | "current"> & { readonly screenshot?: Application["screenshot"] }): string {
  const shown = application.current ? `Screenshot of ${application.name} at commit ${application.current.commitSha.slice(0, 7)}` : `Screenshot of ${application.name}`;
  return withMockSet(shown, application.screenshot?.mockSet);
}


/** The size a request asks for: the card image for `size=card`, else the full screenshot. */
export function screenshotSize(value: string | null): ScreenshotSize {
  return value === "card" ? "card" : "full";
}

export interface ImageOptions {
  db?: Executor;
  config?: FrontendRegistryConfig;
  /** The key of the saved preview whose image is asked for, rather than the application's. */
  key?: string | null;
}

const imageColumns = { preview: previewBuilds.publicId, deletedAt: previewBuilds.deletedAt, state: previewScreenshots.state, directory: previewScreenshots.directory, capturedAt: previewScreenshots.capturedAt };

/** Answers a GET or HEAD for the +size+ image of the application at +slug+, or of its saved preview +options.key+. */
export async function serveScreenshot(request: Request, slug: string, size: ScreenshotSize, options: ImageOptions = {}): Promise<Response> {
  const db = options.db ?? getDb();
  const config = options.config ?? getConfig();
  const head = request.method === "HEAD";
  if (!applicationsAvailable(config)) return notFound(head);
  const row = options.key
    ? db
        .select(imageColumns)
        .from(applicationPreviews)
        .innerJoin(applications, eq(applications.id, applicationPreviews.applicationId))
        .innerJoin(previewBuilds, eq(previewBuilds.id, applicationPreviews.currentPreviewId))
        .innerJoin(previewScreenshots, eq(previewScreenshots.previewId, previewBuilds.id))
        .where(and(eq(applications.slug, slug), eq(applicationPreviews.key, options.key)))
        .get()
    : db
        .select(imageColumns)
        .from(applications)
        .innerJoin(previewBuilds, eq(previewBuilds.id, applications.currentPreviewId))
        .innerJoin(previewScreenshots, eq(previewScreenshots.previewId, previewBuilds.id))
        .where(eq(applications.slug, slug))
        .get();
  if (!row || row.deletedAt !== null) return notFound(head);
  const file = screenshotFile(config, row.preview, row, size);
  if (!file) return notFound(head);

  const etag = `"${crypto.createHash("sha256").update(`${row.preview}:${row.directory}:${size}:${row.capturedAt?.getTime()}`).digest("base64url").slice(0, 27)}"`;
  const headers = new Headers({ "Content-Type": "image/webp", "Cache-Control": "private, no-cache", ETag: etag, "X-Content-Type-Options": "nosniff" });
  if (request.headers.get("if-none-match")?.split(",").some((candidate) => candidate.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers });
  if (head) return new Response(null, { status: 200, headers });
  try {
    const handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    return new Response(Readable.toWeb(handle.createReadStream()) as unknown as ReadableStream<Uint8Array>, { status: 200, headers });
  } catch {
    return notFound(false);
  }
}

function notFound(head: boolean): Response {
  return new Response(head ? null : "Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
