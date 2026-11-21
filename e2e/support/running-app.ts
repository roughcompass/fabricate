import type { Browser, BrowserContext, FrameLocator, Page } from "@playwright/test";
import type { Db } from "../../src/lib/db/client";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "../../src/lib/workspaces/workspace-key";
import { type Workspace, ensureWorkspace, findWorkspace, setHints } from "../../src/lib/workspaces/workspaces";
import { expect } from "./fixtures";
import { type FixtureApplication, buildOrdersPortal, framedRun, ordersPortalRemote } from "./fixture-app";

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

/** Onboards the orders portal from a fresh remote and opens it running under the toolbar at +route+. */
export async function runOrdersPortal(page: Page, db: Db, route = "/accounts"): Promise<FixtureApplication> {
  ordersPortalRemote();
  const build = await buildOrdersPortal(db);
  await openBuild(page, build, route);
  return build;
}

/** Opens +build+'s application running under the toolbar at +route+, on Accounts or Settings. */
export async function openBuild(page: Page, build: FixtureApplication, route = "/accounts"): Promise<void> {
  await page.goto(framedRun(build, route));
  await waitForPage(page, route.startsWith("/settings") ? "Settings" : "Accounts");
}

/**
 * Another visitor's browser: a fresh context with a workspace of its own,
 * with guided hints off like the test's main browser.
 */
export async function visitorContext(browser: Browser, db: Db, baseURL: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  const key = newWorkspaceKey();
  setHints(db, ensureWorkspace(db, key).id, { off: true });
  await context.addCookies([{ name: WORKSPACE_COOKIE, value: key, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  return context;
}

/** The workspace of the browser +context+, from its credential. */
export async function workspaceOf(context: BrowserContext, db: Db): Promise<Workspace> {
  const key = (await context.cookies()).find((cookie) => cookie.name === WORKSPACE_COOKIE)?.value;
  const workspace = findWorkspace(db, key);
  if (!workspace) throw new Error("This browser has no workspace yet");
  return workspace;
}

/** Resets the workspace of +page+'s browser from the Applications page, confirming, as a presenter would. */
export async function resetFromApplications(page: Page): Promise<void> {
  await page.goto("/applications");
  const section = page.getByRole("region", { name: "Reset workspace" });
  await section.getByRole("button", { name: "Reset workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset your workspace?" });
  await expect(dialog).toContainText("Removes the comment threads in your views, your share links, your choices of session presets and mock sets, and your display name, so links you shared stop working. Replies you left in views others shared with you stay there.");
  await dialog.getByRole("button", { name: "Reset workspace" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Your workspace was reset.")).toBeVisible();
}
