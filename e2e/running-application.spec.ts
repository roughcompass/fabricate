import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { ORDERS_PORTAL_BRANDS, ordersPortalRemote, saveOrdersPortalPreview } from "./support/fixture-app";
import { removeSavedPreview } from "../src/lib/applications/saved-previews";
import { paths } from "./support/paths";
import { openTool } from "./support/toolbar";
import { application, runOrdersPortal, visitorContext, waitForPage } from "./support/running-app";
import { openToolbarMenu } from "./support/toolbar";

/*
 * A running application at /run/<slug>/<route> (add-applications, task 8.1;
 * page-patterns spec, "Pages share one shell, and running applications open
 * outside it"): the current build in a frame under the toolbar, with the
 * address following the route the application shows.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(90_000);

test("keeps the address in step with the application's route, and a reload or a deep link opens that route", async ({ page, db }) => {
  const { application: orders, base } = await runOrdersPortal(page, db, "/");
  // The application takes its root to /accounts, and the address follows.
  await expect(page).toHaveURL(paths.runningApplication(orders.slug, "/accounts"));
  await expect(page.locator("[data-target-frame]")).toHaveAttribute("src", base);
  await expect(page).toHaveTitle(/^Orders portal/);
  // No part of the operator shell.
  await expect(page.locator("#sidebar")).toHaveCount(0);
  await expect(page.locator("[data-shell-header]")).toHaveCount(0);

  await application(page).getByRole("link", { name: "Northwind Traders" }).click();
  await expect(page).toHaveURL(paths.runningApplication(orders.slug, "/accounts/42"));
  await application(page).getByRole("link", { name: "Settings" }).click();
  await waitForPage(page, "Settings");
  await expect(page).toHaveURL(paths.runningApplication(orders.slug, "/settings"));

  // Back goes through the application's own history, and the address follows it.
  await page.goBack();
  await expect(application(page).getByRole("heading", { name: "Northwind Traders", level: 2 })).toBeVisible();
  await expect(page).toHaveURL(paths.runningApplication(orders.slug, "/accounts/42"));

  await page.reload();
  await expect(application(page).getByRole("heading", { name: "Northwind Traders", level: 2 })).toBeVisible();
  await expect(page.locator("[data-target-frame]")).toHaveAttribute("src", `${base}accounts/42`);

  await page.goto(paths.runningApplication(orders.slug, "/settings"));
  await waitForPage(page, "Settings");
  await expect(application(page).getByLabel("Display name")).toHaveValue("Orders team");
});

test("forwards the application's own query to its page, keeps it as the page changes it, and a reload and a share restore it", async ({ page, browser, db, baseURL }) => {
  const { application: orders, base } = await runOrdersPortal(page, db, "/accounts?tab=billing");
  const search = async (on = page) => (await (await on.locator("[data-target-frame]").elementHandle())!.contentFrame())!.evaluate(() => window.location.search);
  await expect(page.locator("[data-target-frame]")).toHaveAttribute("src", `${base}accounts?tab=billing`);
  expect(await search()).toBe("?tab=billing");
  await expect(page).toHaveURL(paths.runningApplication(orders.slug, "/accounts?tab=billing"));

  // The application keeps a tab in its query, as a page with tabs might.
  const frame = (await (await page.locator("[data-target-frame]").elementHandle())!.contentFrame())!;
  await frame.evaluate(() => window.history.replaceState(null, "", `${window.location.pathname}?tab=orders&sort=balance`));
  await expect(page).toHaveURL(paths.runningApplication(orders.slug, "/accounts?tab=orders&sort=balance"));
  await page.reload();
  await waitForPage(page, "Accounts");
  expect(await search()).toBe("?tab=orders&sort=balance");

  // Share captures it with the route, and the link opens it.
  await openTool(page, "share");
  const share = page.getByRole("dialog", { name: "Share" });
  await expect(share.locator("[data-share-view]")).toContainText("The link opens Orders portal at /accounts?tab=orders&sort=balance, built from commit");
  await expect(share.getByLabel("Link to this view")).toHaveValue(/\/s\/[A-Za-z0-9_-]{43}$/);
  const link = await share.getByLabel("Link to this view").inputValue();
  const visitor = await (await visitorContext(browser, db, baseURL!)).newPage();
  await visitor.goto(link);
  await expect(visitor).toHaveURL(new RegExp(`/run/${orders.slug}/accounts\\?tab=orders&sort=balance&share=[A-Za-z0-9_-]{43}$`));
  await waitForPage(visitor, "Accounts");
  expect(await search(visitor)).toBe("?tab=orders&sort=balance");
});

test("runs a saved preview at its own address, with the address following its routes and the menu naming its branch (Running a saved preview)", async ({ page, db }) => {
  const { application: orders } = await runOrdersPortal(page, db, "/");
  const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
  await page.goto(paths.runningApplication(orders.slug, "/accounts", undefined, feature.key));
  await waitForPage(page, "Accounts");
  await expect(application(page).getByText(ORDERS_PORTAL_BRANDS.feature, { exact: true })).toBeVisible();
  await expect(page.locator("[data-target-frame]")).toHaveAttribute("src", `/previews/${feature.current!.preview}/accounts`);
  await expect(page).toHaveTitle(/^Orders portal \(feature\/new-nav\)/);

  await application(page).getByRole("link", { name: "Northwind Traders" }).click();
  await expect(page).toHaveURL(paths.runningApplication(orders.slug, "/accounts/42", undefined, feature.key));
  await openToolbarMenu(page);
  await expect(page.locator("[data-menu-context]")).toContainText("feature/new-nav");
  await expect(page.locator("[data-menu-context]")).toContainText(feature.current!.commitSha.slice(0, 7));
});

test("answers not available for a removed preview (Removing a preview)", async ({ page, db }) => {
  const { application: orders } = await runOrdersPortal(page, db, "/");
  const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
  removeSavedPreview(db, orders.publicId, feature.key);
  const response = await page.goto(paths.runningApplication(orders.slug, "/accounts", undefined, feature.key));
  expect(response!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Application not available", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Applications" })).toHaveAttribute("href", paths.applications);
});

test("answers not found for an application that doesn't exist, with a way back to Applications", async ({ page, db }) => {
  ordersPortalRemote();
  const response = await page.goto(paths.runningApplication("no-such-application"));
  expect(response!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Application not available", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Applications" })).toHaveAttribute("href", paths.applications);
  expect(db).toBeTruthy();
});
