import type { FrameLocator, Page } from "@playwright/test";
import type { Db } from "../../src/lib/db/client";
import { expect } from "./fixtures";
import { type FixtureBuild, buildOrdersPortal, framedRun, ordersPortalRemote } from "./fixture-app";

/** Helpers for the fixture application running under the toolbar, in its frame. */

/** The running application's own page. */
export const application = (page: Page): FrameLocator => page.frameLocator("[data-target-frame]");

/**
 * Waits until the frame shows +heading+, the page's h1, and the toolbar is
 * reading it: its menu is ready, and the timing inspector it adds to each
 * page is running there, so interactions from now on are recorded.
 */
export async function waitForPage(page: Page, heading: string): Promise<void> {
  await expect(application(page).getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open toolbar menu/ })).toBeVisible();
  const frame = await (await page.locator("[data-target-frame]").elementHandle())!.contentFrame();
  await expect.poll(() => frame!.evaluate(() => Symbol.for("frontend-registry.inspector") in window)).toBe(true);
}

/** Builds the orders portal on a fresh remote and opens it under the toolbar at +route+. */
export async function runOrdersPortal(page: Page, db: Db, route = "/accounts"): Promise<FixtureBuild> {
  ordersPortalRemote();
  const build = await buildOrdersPortal(db);
  await openBuild(page, build, route);
  return build;
}

/** Opens +build+ under the toolbar at +route+, on Accounts or Settings. */
export async function openBuild(page: Page, build: FixtureBuild, route = "/accounts"): Promise<void> {
  await page.goto(framedRun(build, route));
  await waitForPage(page, route.startsWith("/settings") ? "Settings" : "Accounts");
}
