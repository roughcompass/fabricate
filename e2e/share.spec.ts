import type { Page } from "@playwright/test";
import { deleteApplication } from "../src/lib/applications/records";
import { deletePreview } from "../src/lib/previews/lifecycle";
import { openTool, startComment } from "./support/toolbar";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { removeSavedPreview } from "../src/lib/applications/saved-previews";
import { ORDERS_PORTAL_BRANDS, commitToOrdersPortal, rebuildOrdersPortal, saveOrdersPortalPreview } from "./support/fixture-app";
import { paths } from "./support/paths";
import { runJobs, serverConfig } from "./support/results";
import { buildSavedPreview } from "../src/lib/applications/pipeline";
import { application, resetFromApplications, runOrdersPortal, visitorContext, waitForPage } from "./support/running-app";

/*
 * Sharing a view of a running application (template-demo/toolbar spec,
 * "Visitors can share an application view" and "Shared links open the
 * captured view"; add-applications, task 8.6): a link captures the
 * application, the commit of the build shown, and the route, and opens them
 * anywhere with the view's comments, or the current build with a notice once
 * the shared build is gone.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(120_000);

const pin = (page: Page, number: number) => page.locator(`[data-comment-pin="${number}"]`);

/** Comments on Export orders as +name+ the first time. */
async function comment(page: Page, text: string, name?: string) {
  await startComment(page);
  await application(page).getByRole("button", { name: "Export orders" }).click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  if (name) await composer.getByLabel("Your name").fill(name);
  await composer.getByLabel("Comment", { exact: true }).fill(text);
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(composer).toBeHidden();
}

/** Opens Share and returns the link it made. */
async function shareLink(page: Page): Promise<string> {
  await openTool(page, "share");
  const share = page.getByRole("dialog", { name: "Share" });
  await expect(share.getByLabel("Link to this view")).toHaveValue(/\/s\/[A-Za-z0-9_-]{43}$/);
  return share.getByLabel("Link to this view").inputValue();
}

test("captures the application, commit, and route, opens them elsewhere with the comment pinned, and takes replies (Creating a link, Opening a shared link elsewhere, Reply through a share link)", async ({ page, browser, db }) => {
  const { application: orders, preview } = await runOrdersPortal(page, db, "/accounts/42");
  await comment(page, "Ship this account view", "Sam Rivera");
  await expect(pin(page, 1)).toBeVisible();
  await page.keyboard.press("Escape");

  await openTool(page, "share");
  const share = page.getByRole("dialog", { name: "Share" });
  await expect(share).toContainText("Anyone with the link can view this application and its comments, and add comments.");
  await expect(share.locator("[data-share-view]")).toHaveText(`The link opens Orders portal at /accounts/42, built from commit ${preview.commitSha.slice(0, 12)}, with this view's comments.`);
  await expect(share.getByRole("button", { name: "Copy link" })).toBeVisible();
  const link = await share.getByLabel("Link to this view").inputValue();
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);

  // A private window: another browser with no workspace of its own.
  const other = await browser.newContext();
  const recipient = await other.newPage();
  await recipient.goto(link);
  await expect(recipient).toHaveURL(new RegExp(`/run/${orders.slug}/accounts/42\\?share=[A-Za-z0-9_-]{43}$`));
  // A first-time visitor gets the guided hints, which open the toolbar menu; this one dismisses them.
  await recipient.locator("[data-hint]").getByRole("button", { name: "Dismiss hints" }).click();
  await waitForPage(recipient, "Accounts");
  await expect(application(recipient).getByRole("heading", { name: "Northwind Traders", level: 2 })).toBeVisible();
  await expect(pin(recipient, 1)).toBeVisible();
  await expect(recipient.locator("[data-run-notice]")).toHaveCount(0);

  await pin(recipient, 1).click();
  const thread = recipient.getByRole("dialog", { name: "Comment 1" });
  await expect(thread).toContainText("Ship this account view");
  await thread.getByLabel("Your name").fill("Robin");
  await thread.getByLabel("Reply").fill("Looks good to me");
  await thread.getByRole("button", { name: "Post reply" }).click();
  await expect(thread).toContainText("Looks good to me");

  // The presenter sees the reply after reloading.
  await page.reload();
  await waitForPage(page, "Accounts");
  await pin(page, 1).click();
  await expect(page.getByRole("dialog", { name: "Comment 1" })).toContainText("Robin");
  await expect(page.getByRole("dialog", { name: "Comment 1" })).toContainText("Looks good to me");
  await other.close();
});

test("opens the captured commit's build, or the current build with a notice once the shared build is gone (Shared build pruned)", async ({ page, browser, db, baseURL }) => {
  const first = await runOrdersPortal(page, db, "/accounts");
  await comment(page, "On the first build", "Sam Rivera");
  await page.keyboard.press("Escape");
  const link = await shareLink(page);

  // A newer build becomes current; the link still opens the build it captured.
  commitToOrdersPortal({ "src/accounts.jsx": (source) => source.replace("Every account the orders team serves", "Every account we serve") }, { message: "Shorter lead" });
  const second = await rebuildOrdersPortal(db, first.application);
  const colleague = await visitorContext(browser, db, baseURL!);
  const recipient = await colleague.newPage();
  await recipient.goto(link);
  await waitForPage(recipient, "Accounts");
  await expect(recipient.locator("[data-target-frame]")).toHaveAttribute("src", `${first.base}accounts`);
  await expect(application(recipient).getByText("Every account the orders team serves")).toBeVisible();
  await expect(recipient.locator("[data-run-notice]")).toHaveCount(0);

  // Once that build is deleted, the current one opens at the captured route, saying so.
  expect(await deletePreview(db, first.preview.publicId, serverConfig())).toBe(true);
  await recipient.goto(link);
  await waitForPage(recipient, "Accounts");
  await expect(recipient.locator("[data-target-frame]")).toHaveAttribute("src", `${second.base}accounts`);
  await expect(application(recipient).getByText("Every account we serve")).toBeVisible();
  const notice = recipient.locator("[data-run-notice]");
  await expect(notice).toContainText(`The shared commit ${first.preview.commitSha.slice(0, 12)} is no longer available, so this is the current build.`);
  // The shared view's comment is listed, placed on the commit that's gone.
  await openTool(recipient, "comments");
  await expect(recipient.getByRole("dialog", { name: "Comments" })).toContainText(`Commit ${first.preview.commitSha.slice(0, 12)}`);
  await recipient.keyboard.press("Escape");
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  await colleague.close();
});

test.describe("a saved preview's share link (restore-toolbar-tools-and-branch-previews, task 4.2)", () => {
  test("shares a saved preview: the link opens it at its own address, at the captured route, with the comment (Sharing a saved preview)", async ({ page, browser, db, baseURL }) => {
    const { application: orders } = await runOrdersPortal(page, db, "/");
    const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
    await page.goto(paths.runningApplication(orders.slug, "/accounts/42", undefined, feature.key));
    await waitForPage(page, "Accounts");
    await comment(page, "Check the new navigation", "Sam Rivera");
    await page.keyboard.press("Escape");
    await openTool(page, "share");
    await expect(page.getByRole("dialog", { name: "Share" }).locator("[data-share-view]")).toHaveText(`The link opens Orders portal (feature/new-nav) at /accounts/42, built from commit ${feature.current!.commitSha.slice(0, 12)}, with this view's comments.`);
    const link = await page.getByRole("dialog", { name: "Share" }).getByLabel("Link to this view").inputValue();

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await expect(recipient).toHaveURL(new RegExp(`/run/${orders.slug}@feature-new-nav/accounts/42\\?share=[A-Za-z0-9_-]{43}$`));
    await waitForPage(recipient, "Accounts");
    await expect(application(recipient).getByText(ORDERS_PORTAL_BRANDS.feature, { exact: true })).toBeVisible();
    await expect(pin(recipient, 1)).toBeVisible();
    await expect(recipient.locator("[data-run-notice]")).toHaveCount(0);
    await colleague.close();
  });

  test("falls back to the preview's current build once the captured one is gone (Shared saved preview moved on)", async ({ page, browser, db, baseURL }) => {
    const { application: orders } = await runOrdersPortal(page, db, "/");
    const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
    await page.goto(paths.runningApplication(orders.slug, "/accounts", undefined, feature.key));
    await waitForPage(page, "Accounts");
    const link = await shareLink(page);

    // The branch moves, its new build becomes current, and the captured build is deleted.
    commitToOrdersPortal({ "src/accounts.jsx": (source) => source.replace("Every account the orders team serves", "Every account on the new navigation") }, { branch: "feature/new-nav", message: "New lead" });
    await buildSavedPreview(db, feature.publicId, { config: serverConfig() });
    await runJobs(db);
    expect(await deletePreview(db, feature.current!.preview, serverConfig())).toBe(true);

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await waitForPage(recipient, "Accounts");
    await expect(application(recipient).getByText("Every account on the new navigation")).toBeVisible();
    await expect(recipient.locator("[data-run-notice]")).toContainText(`The shared commit ${feature.current!.commitSha.slice(0, 12)} is no longer available, so this is feature/new-nav's current build.`);
    await colleague.close();
  });

  test("falls back to the application's current build after the preview was removed, saying so (Shared saved preview removed)", async ({ page, browser, db, baseURL }) => {
    const { application: orders, base } = await runOrdersPortal(page, db, "/");
    const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
    await page.goto(paths.runningApplication(orders.slug, "/accounts", undefined, feature.key));
    await waitForPage(page, "Accounts");
    const link = await shareLink(page);
    removeSavedPreview(db, orders.publicId, feature.key);

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await expect(recipient).toHaveURL(new RegExp(`/run/${orders.slug}/accounts\\?share=[A-Za-z0-9_-]{43}$`));
    await waitForPage(recipient, "Accounts");
    await expect(recipient.locator("[data-target-frame]")).toHaveAttribute("src", `${base}accounts`);
    await expect(application(recipient).getByText(ORDERS_PORTAL_BRANDS.main, { exact: true })).toBeVisible();
    await expect(recipient.locator("[data-run-notice]")).toContainText("The shared preview of feature/new-nav was removed, so this is the application's current build.");
    await colleague.close();
  });
});

test("stops working when the sharer resets their workspace or the application is deleted, leading back to Applications", async ({ page, db }) => {
  const { application: orders } = await runOrdersPortal(page, db);
  await comment(page, "Ship it", "Sam Rivera");
  await page.keyboard.press("Escape");
  const before = await shareLink(page);
  await page.keyboard.press("Escape");

  await resetFromApplications(page);
  const response = await page.goto(before);
  expect(response!.status()).toBe(404);
  await expect(page).toHaveURL(/\/run\/unavailable$/);
  await expect(page.getByRole("heading", { name: "Application not available", level: 1 })).toBeVisible();
  await expect(page.getByText("This link no longer opens an application.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Go to Applications" })).toHaveAttribute("href", paths.applications);
  expect((await page.request.get(paths.applications)).status()).toBe(200);

  await page.goto(paths.runningApplication(orders.slug));
  await waitForPage(page, "Accounts");
  const after = await shareLink(page);
  deleteApplication(db, orders.publicId);
  expect((await page.goto(after))!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Application not available", level: 1 })).toBeVisible();
});

test("refuses an unknown share link with a way back that opens a page", async ({ page, db: _db }) => {
  const response = await page.goto(`/s/${"A".repeat(43)}`);
  expect(response?.status()).toBe(404);
  await expect(page).toHaveURL(/\/run\/unavailable$/);
  await expect(page.getByRole("heading", { level: 1, name: "Application not available" })).toBeVisible();
  const back = page.getByRole("link", { name: /^Go to / });
  expect((await page.request.get((await back.getAttribute("href"))!)).status()).toBe(200);
});
