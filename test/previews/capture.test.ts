import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getApplication } from "@/lib/applications/records";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { jobs, previewBuilds } from "@/lib/db/schema";
import { jobPayload } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/registry";
import { BrowserUnavailableError, launchBrowser, launchFailure } from "@/lib/previews/browser";
import { runScreenshot } from "@/lib/previews/capture";
import { checkBrowser } from "@/lib/previews/doctor";
import { type PreviewBuild, findPreview, rebuildPreview } from "@/lib/previews/records";
import { CAPTURE_SCREENSHOT, findScreenshot, settleAbandonedScreenshots } from "@/lib/previews/screenshots";
import { previewDirectory } from "@/lib/previews/storage";
import { buildRepository } from "../support/builders";
import { onboard } from "../support/applications";
import { rawRun } from "../support/db";
import { publishFiles } from "../support/previews";
import { useAppDb } from "../support/next";

/*
 * Screenshots of applications' builds (add-applications, design decision 4;
 * tasks 4.2 and 4.3): the `preview.screenshot` job serves the build from an
 * in-process server and captures it in a headless browser at 1440 by 900,
 * writing screenshot.webp and a 720-pixel card. These run the browser the
 * worker uses by default, Playwright's Chromium, which `npx playwright
 * install chromium` puts on the host (previews.browser unset). A
 * capture that fails records the screenshot as unavailable and leaves the
 * build as it was.
 */

const PAGE = '<!doctype html><html><head><title>Orders</title><link rel="stylesheet" href="assets/app.css"></head><body><h1>Orders portal</h1></body></html>';

/** A WebP image's width and height, from its first chunk. */
function webpSize(image: Buffer): { width: number; height: number } {
  expect(image.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(image.subarray(8, 12).toString("latin1")).toBe("WEBP");
  const chunk = image.subarray(12, 16).toString("latin1");
  if (chunk === "VP8 ") return { width: image.readUInt16LE(26) & 0x3fff, height: image.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = image.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  expect(chunk).toBe("VP8X");
  return { width: image.readUIntLE(24, 3) + 1, height: image.readUIntLE(27, 3) + 1 };
}

describe("screenshots", () => {
  const original = getConfig();
  const app = useAppDb();
  let storage: string;
  let config: FrontendRegistryConfig;
  let repository: Repository;

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-screenshots-")));
    repository = buildRepository(app.db, { name: "spa-orders", cloneUrl: "https://git.example.com/acme/spa-orders.git" });
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [repository.canonicalUrl], storage, browser: null } });
    setConfig(config);
  });
  afterEach(() => {
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  /** Orders portal with its first build published from +files+, its screenshot requested. */
  function readyApplication(files: Record<string, string> = { "index.html": PAGE, "assets/app.css": "body { background: #0b6; }" }): PreviewBuild {
    const created = onboard(app.db, config, repository);
    const preview = app.db.select().from(previewBuilds).where(eq(previewBuilds.id, created.latestPreviewId!)).get()!;
    return publishFiles(app.db, config, preview, files);
  }
  const screenshotJob = () => app.db.select().from(jobs).where(eq(jobs.kind, CAPTURE_SCREENSHOT)).all().at(-1)!;
  const job = (preview: PreviewBuild) => ({ preview: preview.publicId, requested: findScreenshot(app.db, preview.id)!.requestedAt.getTime() });

  it("captures a ready build at 1440 by 900, with a 720-pixel card, served as visitors see it (Screenshot of a ready build)", async () => {
    const preview = readyApplication();
    expect(getApplication(app.db, "orders-portal").image).toBe("capturing");

    // Through the worker's handler, as the queue runs it.
    const queued = screenshotJob();
    await jobHandlers(app.db, config)[CAPTURE_SCREENSHOT]!(jobPayload(queued), { job: queued, signal: new AbortController().signal });

    const screenshot = findScreenshot(app.db, preview.id)!;
    expect(screenshot).toMatchObject({ state: "ready", artifact: "out/1-test", directory: "screenshots/1-test", reason: null });
    const directory = path.join(previewDirectory(config, preview.publicId), "screenshots", "1-test");
    expect(webpSize(fs.readFileSync(path.join(directory, "screenshot.webp")))).toEqual({ width: 1440, height: 900 });
    expect(webpSize(fs.readFileSync(path.join(directory, "card.webp")))).toEqual({ width: 720, height: 450 });
    // Its page was served by the serving module, which records each opening.
    expect(findPreview(app.db, preview.publicId)!.lastOpenedAt).not.toBeNull();
    // Nothing under the preview's own path changed.
    expect(fs.readdirSync(path.join(previewDirectory(config, preview.publicId), "out", "1-test")).sort()).toEqual(["assets", "index.html"]);

    const shown = getApplication(app.db, "orders-portal");
    expect(shown).toMatchObject({ status: "ready", image: "screenshot", settling: false, screenshot: { version: screenshot.capturedAt!.getTime().toString(36) } });
  }, 60_000);

  it("captures a page still loading when the time limit is reached, and the build stays successful (Slow application)", async () => {
    const busy = '<!doctype html><title>Busy</title><h1>Loading…</h1><script>setInterval(() => fetch("missing.json").catch(() => {}), 50);</script>';
    const preview = readyApplication({ "index.html": busy });
    const started = Date.now();
    expect(await runScreenshot(app.db, job(preview), { config, limitMs: 1_500 })).toBe("captured");
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(findScreenshot(app.db, preview.id)?.state).toBe("ready");
    expect(findPreview(app.db, preview.publicId)?.attemptState).toBe("ready");
  }, 60_000);

  it("records a capture that fails as unavailable, leaving the build current, and tries again with the next successful build (Capture crashes)", async () => {
    const preview = readyApplication();
    const outcome = await runScreenshot(app.db, job(preview), {
      config,
      launch: () => Promise.reject(new BrowserUnavailableError("Playwright's Chromium isn't installed.")),
    });
    expect(outcome).toBe("unavailable");
    expect(findScreenshot(app.db, preview.id)).toMatchObject({ state: "unavailable", directory: null, reason: "The screenshot couldn't be captured: Playwright's Chromium isn't installed." });
    expect(getApplication(app.db, "orders-portal")).toMatchObject({ status: "ready", image: "unavailable", settling: false, current: { preview: preview.publicId } });
    expect(findPreview(app.db, preview.publicId)).toMatchObject({ attemptState: "ready", artifact: "out/1-test" });

    rebuildPreview(app.db, preview.publicId);
    publishFiles(app.db, config, preview, { "index.html": PAGE });
    expect(findScreenshot(app.db, preview.id)).toMatchObject({ state: "pending", artifact: "out/2-test" });
    expect(getApplication(app.db, "orders-portal").image).toBe("capturing");
  });

  it("records a build whose page the browser can't open as unavailable", async () => {
    const preview = readyApplication();
    fs.rmSync(path.join(previewDirectory(config, preview.publicId), "out", "1-test", "index.html"));
    expect(await runScreenshot(app.db, job(preview), { config })).toBe("unavailable");
    expect(findScreenshot(app.db, preview.id)?.reason).toBe("The screenshot couldn't be captured: the build's page answered 404");
  }, 60_000);

  it("leaves a request that was made again, or a deleted preview, to the jobs that follow", async () => {
    const preview = readyApplication();
    const stale = { ...job(preview), requested: job(preview).requested - 1 };
    expect(await runScreenshot(app.db, stale, { config })).toBe("skipped");
    rawRun(app.db, "update preview_builds set deleted_at = ? where id = ?", Date.now(), preview.id);
    expect(await runScreenshot(app.db, job(preview), { config })).toBe("skipped");
  });

  it("marks a screenshot whose job was lost as unavailable, so its card doesn't wait forever", () => {
    const preview = readyApplication();
    rawRun(app.db, "update jobs set state = 'failed', finished_at = ? where kind = ?", Date.now(), CAPTURE_SCREENSHOT);
    expect(settleAbandonedScreenshots(app.db)).toBe(1);
    expect(findScreenshot(app.db, preview.id)).toMatchObject({ state: "unavailable" });
  });

  it("refuses while previews are off, without opening a browser", async () => {
    const preview = readyApplication();
    const off = withOverrides(config, { previews: { enabled: false } });
    expect(await runScreenshot(app.db, job(preview), { config: off, launch: () => Promise.reject(new Error("never launched")) })).toBe("unavailable");
    expect(findScreenshot(app.db, preview.id)?.reason).toBe("Previews were turned off before the screenshot was taken.");
  });

  describe("the browser", () => {
    it("launches the configured browser headless, which the doctor reports", async () => {
      const browser = await launchBrowser(config);
      expect(browser.version()).toMatch(/^\d+\./);
      await browser.close();
      expect(await checkBrowser(config)).toMatchObject({ subject: "Screenshot browser", status: "ok", detail: expect.stringMatching(/^Playwright's Chromium \d+\.[\d.]+ launches headless$/) });
    }, 60_000);

    it("names a missing browser, and how to provide it", async () => {
      expect(await checkBrowser(withOverrides(config, { previews: { browser: "/nonexistent/chrome" } }))).toEqual({ subject: "Screenshot browser", status: "failed", detail: "There's no browser at /nonexistent/chrome. Set previews.browser to an installed browser." });
      await expect(launchBrowser(withOverrides(config, { previews: { browser: "chrome-nonexistent" } }))).rejects.toThrow(BrowserUnavailableError);
      // Playwright's own Chromium names the command that installs it, wherever it's missing.
      const missing = new Error("browserType.launch: Executable doesn't exist at /home/worker/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell\n╔═══╗\n║ npx playwright install ║");
      expect(launchFailure(withOverrides(config, { previews: { browser: null } }), missing)).toBe(
        "Playwright's Chromium isn't installed: there's no browser at /home/worker/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell. Install it on the worker's host with npx playwright install chromium.",
      );
      expect(launchFailure(withOverrides(config, { previews: { browser: "chrome-canary" } }), new Error("browserType.launch: Chromium distribution 'chrome-canary' is not found at /opt/google/chrome-canary/chrome\nRun npx playwright install chrome-canary"))).toBe(
        "The chrome-canary browser isn't installed on this host: there's nothing at /opt/google/chrome-canary/chrome. Install it, or set previews.browser to another browser.",
      );
      const thrown = new BrowserUnavailableError(launchFailure(config, new Error("browserType.launch: Target page, context or browser has been closed")));
      expect(await checkBrowser(config, { probe: () => Promise.reject(thrown) })).toEqual({ subject: "Screenshot browser", status: "failed", detail: "Playwright's Chromium couldn't start: Target page, context or browser has been closed" });
    }, 60_000);
  });
});
