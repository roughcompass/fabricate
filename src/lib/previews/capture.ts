import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Browser, CDPSession } from "playwright-core";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { failureText } from "@/lib/git/redact";
import { compileSet } from "@/lib/mocks/compile";
import { defaultForBuild } from "@/lib/mocks/recapture";
import { setDirectory } from "@/lib/mocks/storage";
import { launchBrowser } from "./browser";
import { type CaptureMocks, applyMocks } from "./capture-mocks";
import { findPreview } from "./records";
import { type CaptureRecord, SCREENSHOT_FILES, type ScreenshotJob, completeScreenshot, failScreenshot, findScreenshot, screenshotDirectoryName } from "./screenshots";
import { startPreviewServer } from "./static-server";
import { previewDirectory } from "./storage";
import { previewBasePath } from "./toolchain";

/**
 * Runs one `preview.screenshot` job (add-applications, design decision 4):
 * serves the preview from an in-process server on 127.0.0.1, opens its page
 * in the headless browser at the Desktop size of 1440 by 900, waits for the
 * page's load event and then for 500 ms without network requests, up to 20
 * seconds in all, and captures what's shown then. It writes the full
 * `screenshot.webp` and the 720-pixel-wide `card.webp` beside the build's
 * output. Anything that goes wrong records the screenshot as unavailable,
 * with the reason, and never touches the build.
 */

export const VIEWPORT = { width: 1440, height: 900 } as const;
/** The card image's width: half the screenshot's. */
const CARD_SCALE = 0.5;
/** How long the page may take to load and settle before it's captured as it is. */
const CAPTURE_LIMIT_MS = 20_000;
const QUALITY = 82;

export type CaptureOutcome = "captured" | "unavailable" | "skipped";

export interface CaptureOptions {
  config?: FrontendRegistryConfig;
  /** Aborts when the job's lease is lost or the worker stops. */
  signal?: AbortSignal;
  /** Launches the browser; the configured one by default. */
  launch?: (config: FrontendRegistryConfig) => Promise<Browser>;
  /** How long the page may load and settle; 20 seconds by default. */
  limitMs?: number;
}

export async function runScreenshot(db: Executor, job: ScreenshotJob, options: CaptureOptions = {}): Promise<CaptureOutcome> {
  const config = options.config ?? getConfig();
  const preview = findPreview(db, job.preview);
  const screenshot = preview && findScreenshot(db, preview.id);
  // Deleted, or requested again since: a later job, if any, takes it. A ready screenshot is captured again when its mock set changed.
  if (!preview || !screenshot || screenshot.state === "unavailable" || screenshot.requestedAt.getTime() !== job.requested) return "skipped";
  const fail = (reason: string): CaptureOutcome => {
    // Capturing again keeps the earlier images when it fails, and says why in the worker's log.
    if (screenshot.state === "ready") {
      console.log(`[worker] ${preview.publicId}'s screenshot wasn't captured again, so the earlier one stays: ${failureText(reason, 600)}`);
      return "unavailable";
    }
    return failScreenshot(db, preview.id, job.requested, reason) ? "unavailable" : "skipped";
  };
  if (!config.previews.enabled) return fail("Previews were turned off before the screenshot was taken.");
  if (preview.artifact !== screenshot.artifact) return fail("A newer build was published before the screenshot was taken.");

  const root = previewDirectory(config, preview.publicId);
  // Capturing a shown screenshot again writes beside it, so its images stay until the new ones are recorded.
  const directory = `${screenshotDirectoryName(screenshot.artifact)}${screenshot.state === "ready" ? `r${crypto.randomBytes(4).toString("hex")}` : ""}`;
  const scratch = path.join(root, "screenshots", `.capture-${crypto.randomBytes(5).toString("hex")}`);
  // The default set of the build's target, as it stands now (add-mock-sets, design decision 11).
  const set = defaultForBuild(db, preview.id);
  const mocks: CaptureMocks = set ? { set: compileSet(db, set, config), directory: setDirectory(config, set.publicId) } : { set: null, directory: null };
  let server: Awaited<ReturnType<typeof startPreviewServer>> | null = null;
  let browser: Browser | null = null;
  try {
    server = await startPreviewServer({ db, config });
    browser = await (options.launch ?? launchBrowser)(config);
    const images = await capture(browser, { origin: server.origin, base: previewBasePath(preview.publicId), mocks }, options.limitMs ?? CAPTURE_LIMIT_MS, options.signal);
    await fsp.mkdir(scratch, { recursive: true });
    await fsp.writeFile(path.join(scratch, SCREENSHOT_FILES.full), images.full);
    await fsp.writeFile(path.join(scratch, SCREENSHOT_FILES.card), images.card);
    const target = path.join(root, ...directory.split("/"));
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.rename(scratch, target);
    const record: CaptureRecord = { mocks: set ? { publicId: set.publicId, name: set.name, revision: set.revision } : null, failures: images.failures };
    if (!completeScreenshot(db, preview.id, job.requested, directory, new Date(), record)) {
      await fsp.rm(target, { recursive: true, force: true });
      return "skipped";
    }
    // Earlier captures of this preview are no longer shown.
    await removeOthers(path.join(root, "screenshots"), path.basename(target));
    return "captured";
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return fail(`The screenshot couldn't be captured: ${failureText(error, 600)}`);
  } finally {
    await browser?.close().catch(() => {});
    await server?.close();
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Opens the build at +target+'s base at the Desktop size, with its mock set
 * applied, waits for it to load and settle up to +limitMs+, and captures the
 * full image and the card, with the API calls that failed.
 */
async function capture(browser: Browser, target: { origin: string; base: string; mocks: CaptureMocks }, limitMs: number, signal?: AbortSignal): Promise<{ full: Buffer; card: Buffer; failures: CaptureRecord["failures"] }> {
  const stop = () => void browser.close().catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, serviceWorkers: "block" });
    const page = await context.newPage();
    // The DevTools session opens before navigation, so it sees every call's failure as it happens.
    const session = await context.newCDPSession(page);
    const failures = await applyMocks(context, page, session, target);
    const url = `${target.origin}${target.base}`;
    const deadline = Date.now() + limitMs;
    let response;
    try {
      response = await page.goto(url, { waitUntil: "load", timeout: limitMs });
    } catch (error) {
      // Still loading when time ran out: the page is captured as it is.
      if (!isTimeout(error)) throw error;
    }
    if (response && !response.ok()) throw new Error(`the build's page answered ${response.status()}`);
    const remaining = deadline - Date.now();
    if (remaining > 0) await page.waitForLoadState("networkidle", { timeout: remaining }).catch((error: unknown) => (isTimeout(error) ? undefined : Promise.reject(error)));
    return { full: await shoot(session, 1), card: await shoot(session, CARD_SCALE), failures: failures() };
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

/** The viewport as WebP at +scale+: Chromium encodes it, so no image library is needed. */
async function shoot(session: CDPSession, scale: number): Promise<Buffer> {
  const { data } = await session.send("Page.captureScreenshot", { format: "webp", quality: QUALITY, clip: { x: 0, y: 0, ...VIEWPORT, scale }, captureBeyondViewport: false });
  return Buffer.from(data, "base64");
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

/** Removes every capture under +directory+ but +keep+. */
async function removeOthers(directory: string, keep: string): Promise<void> {
  const names = await fsp.readdir(directory).catch(() => [] as string[]);
  await Promise.all(names.filter((name) => name !== keep).map((name) => fsp.rm(path.join(directory, name), { recursive: true, force: true })));
}
