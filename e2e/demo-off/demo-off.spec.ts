import type { Page } from "@playwright/test";
import { registerApplication } from "../../test/support/applications";
import { onboardPortal } from "../../test/support/onboarding";
import { expect, test } from "../support/fixtures";

// template-demo/demo-mode spec, with the demo turned off (npm run
// test:demo-off): Applications, Add application, the starters, and Create
// work on their own; Salt Patterns, demo deployments, and catalog templates
// don't exist.

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const heading = (page: Page) => page.locator("[data-shell-header]").getByRole("heading", { level: 1 });

test("Applications is shown and lists registered Applications, with no demo deployments", async ({ page, db }) => {
  registerApplication(db, { name: "Payee Hub", portal: onboardPortal(db, "Access") });
  await page.goto("/");
  await expect(primary(page).getByRole("link", { name: "Applications", exact: true })).toBeVisible();
  await expect(primary(page).getByRole("link", { name: "Salt Patterns", exact: true })).toHaveCount(0);
  await primary(page).getByRole("link", { name: "Applications", exact: true }).click();
  await expect(heading(page)).toHaveText("Applications");
  await expect(page.getByRole("list", { name: "Applications" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.locator("[data-demo-deployment]")).toHaveCount(0);
});

test("The gallery, a demo deployment's page, and Reset demo don't exist", async ({ page, db: _db }) => {
  for (const address of ["/templates", "/templates/market-watch", "/applications/app_aaaaaaaaaaaaaaaa"]) {
    const response = await page.goto(address);
    expect(response?.status(), address).toBe(404);
  }
  await page.goto("/applications/new");
  await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
});

test("Add application offers the four starters, and the full catalog lists only them", async ({ page, db: _db }) => {
  await page.goto("/applications/new");
  await expect(page.getByRole("list", { name: "Starters" }).getByRole("listitem")).toHaveCount(4);
  await page.getByRole("link", { name: "Browse all" }).click();
  await expect(page).toHaveURL(/\/applications\/new\/templates$/);
  const catalog = page.getByRole("list", { name: "Starters and templates" }).getByRole("listitem");
  await expect(catalog).toHaveCount(4);
  await expect(catalog).toHaveText([/DE Web Boilerplate/, /Salt Dashboard/, /Salt Starter/, /Agent Starter/]);
});

test("Create Application opens with a starter chosen", async ({ page, db }) => {
  onboardPortal(db, "Access");
  await page.goto("/applications/new");
  await page.getByRole("link", { name: /Salt Starter/ }).click();
  await expect(page).toHaveURL(/\/applications\/new\/create\?starter=salt-starter/);
  await expect(page.getByRole("heading", { level: 1, name: "Create Application" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start from Salt Starter" })).toBeVisible();
});
