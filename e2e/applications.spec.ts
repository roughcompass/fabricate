import type { BrowserContext, Page } from "@playwright/test";
import { demoApplications, demoThreads } from "../src/lib/db/schema";
import { templateBySlug } from "../src/lib/demo/catalog";
import { createApplication, validateDeployInput } from "../src/lib/demo/deployments";
import { createShare, findShare } from "../src/lib/demo/shares";
import { WORKSPACE_COOKIE } from "../src/lib/demo/workspace-key";
import { ensureWorkspace } from "../src/lib/demo/workspaces";
import { expect, test } from "./support/fixtures";

/** The visitor's applications, deleting them, and resetting the demo. */

async function workspaceOf(page: Page, context: BrowserContext, db: Parameters<typeof ensureWorkspace>[0]) {
  await page.goto("/new");
  const key = (await context.cookies()).find((cookie) => cookie.name === WORKSPACE_COOKIE)!.value;
  return ensureWorkspace(db, key);
}

const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });
const sandbox = (name: string) => validateDeployInput({ name, environment: "sandbox", project: "", repository: "" });

test("lists the visitor's applications newest first and opens one", async ({ page, context, db }) => {
  const workspace = await workspaceOf(page, context, db);
  createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Older desk"), new Date(Date.now() - 60 * 60 * 1000));
  createApplication(db, workspace.id, templateBySlug("payments-workspace")!, sandbox("Newer payments"), new Date(Date.now() - 60 * 1000));

  await page.getByRole("link", { name: "View applications" }).click();
  await expect(page).toHaveTitle("Applications · DE FabLab");
  const table = page.getByRole("table", { name: "Applications" });
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Newer payments");
  await expect(rows.nth(0)).toContainText("Payments workspace");
  await expect(rows.nth(0)).toContainText("Sandbox");
  await expect(rows.nth(0)).toContainText("Ready");
  await expect(rows.nth(1)).toContainText("Older desk");
  await expect(rows.nth(1)).toContainText("Markets");

  await rows.nth(1).getByRole("button", { name: "Actions for Older desk" }).click();
  await expect(page.getByRole("link", { name: /Visit application/ })).toHaveAttribute("target", "_blank");
  await page.keyboard.press("Escape");

  await rows.nth(0).getByRole("link", { name: "Newer payments" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Newer payments" })).toBeVisible();
});

test("No applications yet: the empty state leads to the Salt Patterns gallery and to the import", async ({ page, db: _db }) => {
  await page.goto("/applications");
  await expect(page.getByText("No applications yet")).toBeVisible();
  const empty = page.getByRole("main").locator("[data-page-header] ~ *");
  await expect(empty.getByRole("link", { name: "Import from BitBucket" })).toHaveAttribute("href", "/applications/import");
  await empty.getByRole("link", { name: "Browse Salt Patterns" }).click();
  await expect(page).toHaveURL(/\/templates$/);
});

test("Header actions: Start with a template is the only primary action, beside Import from BitBucket, with no breadcrumbs", async ({ page, db: _db }) => {
  await page.goto("/applications");
  const header = page.locator("[data-page-header]");
  await expect(header.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Start with a template" })).toHaveAttribute("data-variant", "primary");
  await expect(header.getByRole("link", { name: "Import from BitBucket" })).toHaveAttribute("href", "/applications/import");
  await expect(header.locator('[data-variant="primary"]')).toHaveCount(1);
});

test("Visit while building: the row menu presents Visit application as unavailable until the build is ready", async ({ page, context, db }) => {
  const workspace = await workspaceOf(page, context, db);
  createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Fresh desk"));
  await page.goto("/applications");
  await page.getByRole("button", { name: "Actions for Fresh desk" }).click();
  await expect(page.getByRole("button", { name: /Visit application/ })).toBeDisabled();
  await expect(page.getByRole("link", { name: /Visit application/ })).toHaveCount(0);
});

test("does not show another visitor's application", async ({ page, context, browser, db }) => {
  const workspace = await workspaceOf(page, context, db);
  const application = createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Private desk"));

  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto("/applications");
  await expect(stranger.getByText("No applications yet")).toBeVisible();
  const response = await stranger.goto(`/applications/${application.publicId}`);
  expect(response?.status()).toBe(404);
  await expect(stranger.getByRole("heading", { level: 1, name: "Application not found" })).toBeVisible();
  await other.close();
});

test("deletes an application with its share link after confirmation", async ({ page, context, db }) => {
  const workspace = await workspaceOf(page, context, db);
  const application = createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Shared desk"));
  const token = createShare(db, { applicationId: application.id }, workspace.id, { route: "watch", overrides: {}, theme: "light", persona: "analyst" });

  await page.goto("/applications");
  await page.getByRole("button", { name: "Actions for Shared desk" }).click();
  await page.getByRole("button", { name: "Delete application" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Shared desk?" });
  await expect(dialog).toContainText("Its comments and share links are removed too.");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Delete application" }).click();

  await expect(toasts(page).getByText("The application was deleted.")).toBeVisible();
  await expect(page.getByText("No applications yet")).toBeVisible();
  expect(findShare(db, token)).toBeNull();
  expect((await page.request.get(`/s/${token}`)).status()).toBe(404);

  // Share link that no longer resolves, and the deleted application's own address: a not-found page with a way back.
  for (const address of [`/s/${token}`, `/run/${application.publicId}`]) {
    const response = await page.goto(address);
    expect(response?.status(), address).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Application not available" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await page.getByRole("link", { name: "Go to Applications" }).click();
    await expect(page).toHaveURL(/\/applications$/);
  }
});

test("resets the demo after confirmation, leaving the gallery unchanged", async ({ page, context, db }) => {
  const workspace = await workspaceOf(page, context, db);
  createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Demo desk"));
  db.insert(demoThreads)
    .values({ publicId: "thr_aaaaaaaaaaaaaaaa", referenceSlug: "market-watch", viewWorkspaceId: workspace.id, route: "watch", member: "watchlist", memberVersion: "1.8.0", anchor: "filter", offsetX: 0.5, offsetY: 0.5, createdAt: new Date() })
    .run();

  // Reset demo is on the create page.
  await page.goto("/new");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset the demo?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(db.select().from(demoApplications).all()).toHaveLength(1);

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await dialog.getByRole("button", { name: "Reset demo" }).click();
  await expect(toasts(page).getByText("The demo was reset.")).toBeVisible();
  await expect(page).toHaveURL(/\/new$/);
  await page.goto("/templates");
  await expect(page.getByText("Showing 16 of 16 templates")).toBeVisible();
  expect(db.select().from(demoApplications).all()).toEqual([]);
  expect(db.select().from(demoThreads).all()).toEqual([]);

  await page.goto("/applications");
  await expect(page.getByText("No applications yet")).toBeVisible();
});
