import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { ordersPortalRemote } from "./support/fixture-app";
import { paths } from "./support/paths";
import { application, runOrdersPortal, waitForPage } from "./support/running-app";

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

test("answers not found for an application that doesn't exist, with a way back to Applications", async ({ page, db }) => {
  ordersPortalRemote();
  const response = await page.goto(paths.runningApplication("no-such-application"));
  expect(response!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Application not available", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Applications" })).toHaveAttribute("href", paths.applications);
  expect(db).toBeTruthy();
});
