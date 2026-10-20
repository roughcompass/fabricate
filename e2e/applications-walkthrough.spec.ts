import path from "node:path";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { expect, gitRepo, test } from "./support/fixtures";
import { saveEditor } from "./support/experience";
import { serverConfig } from "./support/results";
import { waitForHydration } from "./support/shell";

/**
 * The make-applications-first-class walkthrough (task 11.2), from an empty
 * database: create Access, add Payee Hub from Salt Starter with a local
 * single-spa repository, watch it reach Assessed and ESM, make it Access's
 * default item in the experience editor, promote Access, and see the checklist, Repositories, and
 * Home agree. The worker isn't running beside the browser tests, so the test
 * runs its jobs itself, as the worker would.
 */

const SINGLE_SPA = {
  "package.json": '{ "name": "payee-hub", "version": "1.0.0" }\n',
  "src/main.ts": "export async function bootstrap() {}\nexport async function mount() {}\nexport async function unmount() {}\n",
};

test("Access and Payee Hub, from an empty database to Production", async ({ page, db, sourcesDir }) => {
  test.setTimeout(120_000);
  const repository = gitRepo(path.join(sourcesDir, "payee-hub"), SINGLE_SPA);
  const header = page.locator("[data-page-header]");
  const notice = page.getByRole("region", { name: "Notifications" });

  // 1. Create the Portal Access.
  await page.goto("/portals");
  await waitForHydration(page);
  await header.getByRole("link", { name: "Create Portal" }).click();
  const dialog = page.getByRole("dialog", { name: /^Create/ });
  await dialog.getByRole("group", { name: /^Platform/ }).getByRole("radio", { name: /^Web/ }).check();
  await dialog.getByLabel("SEAL ID").fill("88001");
  await dialog.getByLabel("Name", { exact: true }).fill("Access");
  await dialog.getByLabel("Owning team").fill("Access Platform");
  await dialog.getByLabel("Description").fill("Sign-in and entitlements for every desk.");
  await dialog.getByRole("button", { name: "Create Portal" }).click();
  await expect(notice).toContainText("Access was created as a Prototype.");
  const navigationPage = page.url();

  // 2. Add Payee Hub from Salt Starter, with the local repository.
  await page.goto("/applications/new");
  await page.getByRole("link", { name: /Salt Starter/ }).click();
  await waitForHydration(page);
  await page.getByLabel("SEAL ID").fill("88001");
  await page.getByLabel("Name", { exact: true }).fill("Payee Hub");
  await page.getByLabel("Description").fill("Manages the payees of a payments desk.");
  await page.getByLabel("Repository URL").fill(`file://${repository}`);
  await expect(page.getByRole("combobox", { name: "Portal", exact: true })).toHaveValue(/^ptl_/);
  await page.getByRole("button", { name: "Create Application" }).click();
  await expect(notice).toContainText("Payee Hub was created.");
  const dashboard = page.url();
  const overview = page.getByRole("region", { name: "Overview" });
  await expect(overview).toContainText("Queued");

  // 3. The dashboard reaches Assessed and ESM without a reload.
  await drainJobs(db, jobHandlers(db, serverConfig()));
  await expect(overview.getByRole("link", { name: "Assessed" })).toBeVisible({ timeout: 15_000 });
  await expect(overview).toContainText("ESM");

  // 4. Payee Hub becomes Access's default item.
  await page.goto(navigationPage);
  await waitForHydration(page);
  // Add to menu opens the experience editor's menu with an item started for it, saved as the Portal's experience.
  await page.getByRole("list", { name: "Applications not in the menu" }).getByRole("link", { name: "Add to menu" }).click();
  await waitForHydration(page);
  const add = page.getByRole("complementary", { name: "Add a menu item" });
  await add.getByLabel("Label").fill("Payees");
  await add.getByLabel("Route").fill("/payees");
  await add.getByRole("button", { name: "Add item" }).click();
  await page.locator('[data-entry="Payees"]').getByRole("button", { name: "Make default" }).click();
  await saveEditor(page);
  await page.goto(navigationPage);
  await waitForHydration(page);
  await expect(page.locator("#menu [data-kind]").filter({ hasText: "Payees" })).toContainText("Default");

  // 5. Promote Access.
  await header.getByRole("button", { name: "Promote to Production" }).click();
  await page.getByRole("dialog", { name: "Promote Access to Production?" }).getByRole("button", { name: "Promote to Production" }).click();
  await expect(notice).toContainText("Access is in Production.");

  // 6. The checklist reads 6/6, Repositories names Payee Hub, and Home counts it.
  await page.goto(dashboard);
  await expect(page.getByRole("region", { name: "Production checklist" })).toContainText("6/6");
  await page.goto("/repositories");
  await expect(page.getByRole("table", { name: "Repositories" }).getByRole("link", { name: "Payee Hub" })).toBeVisible();
  await page.goto("/");
  const figures = page.locator('dl[aria-label="Applications"]');
  await expect(figures.locator('[data-figure="Applications"] dd').first()).toHaveText("1");
  await expect(figures.locator('[data-figure="Production Portals"] dd').first()).toHaveText("1");
});
