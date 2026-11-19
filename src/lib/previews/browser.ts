import path from "node:path";
import { type Browser, chromium } from "playwright-core";
import type { FrontendRegistryConfig } from "@/lib/config";

/**
 * The headless browser that captures applications' screenshots
 * (add-applications, design decision 4), launched through playwright-core
 * as `previews.browser` says: Playwright's own Chromium by default, which
 * `npx playwright install chromium` puts on the worker's host, or a
 * Playwright channel such as `chrome`, or a browser's executable path. Only
 * the worker launches it; the web server never does.
 */

/** Why the browser couldn't start, naming what's missing and how to provide it. */
export class BrowserUnavailableError extends Error {
  override name = "BrowserUnavailableError";
}

/** How long a launch may take. */
const LAUNCH_TIMEOUT_MS = 30_000;

/** The browser as messages name it. */
export function browserLabel(config: FrontendRegistryConfig): string {
  const browser = config.previews.browser;
  if (browser === null) return "Playwright's Chromium";
  return path.isAbsolute(browser) ? browser : `the ${browser} channel`;
}

/** Launches the configured browser, headless. Throws BrowserUnavailableError when it can't start. */
export async function launchBrowser(config: FrontendRegistryConfig): Promise<Browser> {
  const browser = config.previews.browser;
  const target = browser === null ? {} : path.isAbsolute(browser) ? { executablePath: browser } : { channel: browser };
  try {
    return await chromium.launch({ ...target, headless: true, timeout: LAUNCH_TIMEOUT_MS });
  } catch (error) {
    throw new BrowserUnavailableError(launchFailure(config, error));
  }
}

/** What went wrong starting the browser, from Playwright's error, in a sentence that says what to do. */
export function launchFailure(config: FrontendRegistryConfig, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // The first line says what happened; Playwright's banner with install advice follows it.
  const first = (message.split("\n").find((line) => line.trim() !== "") ?? message).replace(/^browserType\.launch:\s*/, "").trim();
  const missing = /executable doesn't exist at (.+)$/i.exec(first)?.[1]?.trim();
  const browser = config.previews.browser;
  if (missing && browser === null) return `Playwright's Chromium isn't installed: there's no browser at ${missing}. Install it on the worker's host with npx playwright install chromium.`;
  if (missing) return `There's no browser at ${missing}. Set previews.browser to an installed browser.`;
  const distribution = /distribution '([^']+)' is not found at (.+)$/i.exec(first);
  if (distribution) return `The ${distribution[1]} browser isn't installed on this host: there's nothing at ${distribution[2]!.trim()}. Install it, or set previews.browser to another browser.`;
  return `${browserLabel(config)} couldn't start: ${first}`;
}
