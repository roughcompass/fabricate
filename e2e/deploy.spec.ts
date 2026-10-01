import type { BrowserContext, Page } from "@playwright/test";
import { templateBySlug } from "../src/lib/demo/catalog";
import { createApplication, validateDeployInput } from "../src/lib/demo/deployments";
import { WORKSPACE_COOKIE } from "../src/lib/demo/workspace-key";
import { APPLICATION_LIMIT, ensureWorkspace } from "../src/lib/demo/workspaces";
import { expect, test } from "./support/fixtures";
import { expectCurrentItem } from "./support/shell";

/** Deploying a template and watching its simulated build (template-demo/deployments spec). */

const log = (page: Page) => page.getByRole("list", { name: "Build log" });

/** The browser's demo workspace credential, issued on its first demo request. */
async function workspaceKey(page: Page, context: BrowserContext): Promise<string> {
  await page.goto("/templates");
  const cookie = (await context.cookies()).find((entry) => entry.name === WORKSPACE_COOKIE);
  expect(cookie?.httpOnly).toBe(true);
  return cookie!.value;
}

async function deployDev(page: Page, project: string, repository: string) {
  await page.goto("/templates/payments-workspace/deploy");
  await page.getByLabel("Application name").fill("Payee portal");
  await page.getByLabel("Dev environment").check();
  await page.getByLabel("BitBucket project").fill(project);
  await page.getByLabel("Repository name").fill(repository);
  await page.getByRole("button", { name: "Create application" }).click();
}

test("creates a sandbox application with the defaults and watches its build finish", async ({ page, db: _db }) => {
  test.setTimeout(60_000);
  await page.goto("/templates/payments-workspace");
  await page.getByRole("link", { name: "Deploy template" }).click();
  await expect(page).toHaveTitle("Deploy Payments workspace · DE FabLab");
  await expect(page.getByLabel("Application name")).toHaveValue("Payments workspace");
  await expect(page.getByLabel("Sandbox")).toBeChecked();
  await expect(page.getByLabel("BitBucket project")).toBeHidden();

  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page).toHaveURL(/\/applications\/app_[a-z0-9]{16}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Payments workspace" })).toBeVisible();
  await expect(page.getByText("Building", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Visit application" })).toBeDisabled();
  await expect(page.getByText("Available when the build finishes")).toBeVisible();
  await expect(log(page)).toContainText("Queued");
  await expect(log(page)).toContainText("Cloning template");
  await expectCurrentItem(page, "Applications", "All Applications");

  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  const visit = page.getByRole("link", { name: /Visit application/ });
  await expect(visit).toBeVisible();
  await expect(visit).toHaveAttribute("target", "_blank");
  await expect(visit).toHaveAttribute("href", /^\/run\/app_[a-z0-9]{16}$/);
  await expect(page.getByText(/^https:\/\/payments-workspace-[a-z0-9]{4}\.sandbox\.deweb\.example$/)).toBeVisible();
  // Once ready, the log is collapsed.
  await expect(page.getByText("Build completed")).toBeVisible();
  await expect(log(page)).toBeHidden();
});

test("resumes the build where it was after a reload", async ({ page, db: _db }) => {
  await page.goto("/templates/market-watch/deploy");
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page).toHaveURL(/\/applications\/app_/);
  await expect(log(page).getByText("Installing dependencies, in progress")).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(log(page).getByText("Queued, done")).toBeVisible();
  await expect(log(page).getByText("Cloning template, done")).toBeVisible();
});

test("names the BitBucket project and repository in a dev build", async ({ page, db: _db }) => {
  await deployDev(page, "PAY", "payee-portal");
  await expect(page).toHaveURL(/\/applications\/app_/);
  await expect(log(page)).toContainText("Creating BitBucket repository PAY/payee-portal");
  await expect(log(page)).toContainText("Running pipeline #1");
  await expect(page.getByText("PAY/payee-portal", { exact: true })).toBeVisible();
  await expect(page.getByText("Dev environment").first()).toBeVisible();
});

test("skips the rest of the build for a presenter", async ({ page, db: _db }) => {
  await page.goto("/templates/operations-console/deploy");
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page).toHaveURL(/\/applications\/app_/);
  await page.getByRole("button", { name: "Skip build" }).click();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Visit application/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip build" })).toBeHidden();
  await expect(page.getByText("Build completed (skipped ahead)")).toBeVisible();
});

test("reveals BitBucket fields for a dev environment, prefilled from the application name", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/deploy");
  await page.getByLabel("Dev environment").check();
  await expect(page.getByLabel("BitBucket project")).toBeVisible();
  await expect(page.getByLabel("Repository name")).toHaveValue("payments-workspace");
  await page.getByLabel("Application name").fill("Payee Portal 2");
  await expect(page.getByLabel("Repository name")).toHaveValue("payee-portal-2");
});

test("rejects an invalid project key and keeps the other values", async ({ page, db: _db }) => {
  await deployDev(page, "pay-1", "payee-portal");
  await expect(page).toHaveURL(/\/deploy$/);
  await expect(page.getByText("Use 2 to 10 uppercase letters and digits, starting with a letter, such as PAY")).toBeVisible();
  await expect(page.getByLabel("BitBucket project")).toHaveValue("pay-1");
  await expect(page.getByLabel("Repository name")).toHaveValue("payee-portal");
  await expect(page.getByLabel("Application name")).toHaveValue("Payee portal");
  await expect(page.getByLabel("Dev environment")).toBeChecked();
});

test("reports a repository that already exists in the project", async ({ page, db: _db }) => {
  await deployDev(page, "PAY", "payee-portal");
  await expect(page).toHaveURL(/\/applications\/app_/);
  await deployDev(page, "PAY", "payee-portal");
  await expect(page.getByText("payee-portal already exists in PAY")).toBeVisible();
});

test("explains the application limit", async ({ page, context, db }) => {
  const key = await workspaceKey(page, context);
  const workspace = ensureWorkspace(db, key);
  const template = templateBySlug("market-watch")!;
  for (let index = 0; index < APPLICATION_LIMIT; index++) createApplication(db, workspace.id, template, validateDeployInput({ name: `App ${index}`, environment: "sandbox", project: "", repository: "" }));

  await page.goto("/templates/market-watch/deploy");
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "the most a demo workspace can hold" })).toContainText("Delete an application or reset the demo");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("shows the BitBucket fields with a note and creates a dev application", async ({ page, db: _db }) => {
    await page.goto("/templates/payments-workspace/deploy");
    await expect(page.getByText("Only needed for a dev environment.")).toBeVisible();
    await page.getByLabel("Dev environment").check();
    await page.getByLabel("BitBucket project").fill("PAY");
    await page.getByRole("button", { name: "Create application" }).click();
    await expect(page).toHaveURL(/\/applications\/app_/);
    await expect(page.getByText("PAY/payments-workspace", { exact: true })).toBeVisible();
  });
});

test.describe("microfrontends group", () => {
  test("lists every member of a sandbox application served from the sandbox", async ({ page, db: _db }) => {
    await page.goto("/templates/payments-workspace/deploy");
    await page.getByRole("button", { name: "Create application" }).click();
    await expect(page).toHaveURL(/\/applications\/app_/);
    const group = page.getByRole("table", { name: "Microfrontends group" });
    const rows = group.locator("tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("Access shell for Payments");
    await expect(rows.nth(0)).toContainText("Default application");
    await expect(rows.nth(0)).toContainText("All routes");
    await expect(rows.nth(1)).toContainText("Payee list");
    await expect(rows.nth(1)).toContainText("Route /payees");
    await expect(rows.nth(1)).toContainText("1.4.2");
    await expect(rows.nth(2)).toContainText("Slot Sidebar on /payees");
    await expect(rows.nth(2)).toContainText("Payments Experience");
    for (let index = 0; index < 4; index++) await expect(rows.nth(index).locator('td[data-label="Environment"]')).toHaveText("Sandbox");
  });

  test("shows the portal shell falling back to production in a dev application", async ({ page, db: _db }) => {
    await deployDev(page, "MKT", "market-desk");
    await expect(page).toHaveURL(/\/applications\/app_/);
    const rows = page.getByRole("table", { name: "Microfrontends group" }).locator("tbody tr");
    await expect(rows.nth(0).locator('td[data-label="Environment"]')).toHaveText("Production (fallback)");
    for (let index = 1; index < 4; index++) await expect(rows.nth(index).locator('td[data-label="Environment"]')).toHaveText("Dev");
  });
});
