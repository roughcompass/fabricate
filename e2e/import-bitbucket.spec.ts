import type { Page } from "@playwright/test";
import { BITBUCKET_HOST } from "../src/lib/demo/bitbucket";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { expectCurrentItem } from "./support/shell";

/** Import from BitBucket, in the Applications section (deployments spec). */

const breadcrumbs = (page: Page) => page.locator("[data-page-header]").getByRole("navigation", { name: "Breadcrumb" }).getByRole("link");

test("Importing a repository: from Applications, through a project's repositories, to the build log; Importing twice is refused", async ({ page, db: _db }) => {
  await page.goto("/applications");
  await page.getByRole("link", { name: "Import from BitBucket" }).first().click();
  await expect(page).toHaveURL(/\/applications\/import$/);
  await expect(page).toHaveTitle("Import from BitBucket · DE FabLab");
  await expectCurrentItem(page, "Applications", "Import from BitBucket");

  const project = page.getByRole("combobox", { name: "Project" });
  await expect(project.locator("option")).toHaveText(["PAY · Payments", "GB · Global Banking", "MKT · Markets", "OPS · Operations"]);
  await project.selectOption("MKT");
  await expect(page.getByRole("list", { name: "Repositories in MKT" })).toContainText("fx-board");
  await project.selectOption("PAY");
  await page.getByRole("link", { name: "Import PAY/payee-hub" }).click();

  await expect(page).toHaveURL(/\/applications\/import\/PAY\/payee-hub$/);
  await expect(page).toHaveTitle("Import PAY/payee-hub · DE FabLab");
  await expect(breadcrumbs(page)).toHaveText(["Applications", "Import from BitBucket"]);
  await expect(page.getByLabel("Application name")).toHaveValue("Payee hub");
  await expect(page.getByText("Payments workspace")).toBeVisible();
  await page.getByRole("button", { name: "Import application" }).click();

  await expect(page).toHaveURL(/\/applications\/app_[a-z0-9]{16}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Payee hub" })).toBeVisible();
  await expect(page.getByText("Connecting BitBucket repository PAY/payee-hub")).toBeVisible();
  await expect(page.getByText("Cloning PAY/payee-hub")).toBeVisible();
  await expect(page.getByText(/Creating BitBucket repository/)).toHaveCount(0);

  // The repository is now in the workspace, and a second import is refused.
  await page.goto("/applications/import");
  await expect(page.locator('[data-repository="PAY/payee-hub"]')).toContainText("In your workspace");
  await page.getByRole("link", { name: "Import PAY/payee-hub" }).click();
  await page.getByRole("button", { name: "Import application" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "payee-hub already exists in PAY" })).toBeVisible();
  await expect(page).toHaveURL(/\/applications\/import\/PAY\/payee-hub$/);
});

test("Unavailable providers: the import page offers only BitBucket", async ({ page, db: _db }) => {
  await page.goto("/applications/import");
  await expect(page.getByRole("list", { name: "Repositories in PAY" })).toBeVisible();
  await expect(page.getByText(/GitHub|GitLab/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(0);
});

test("Pasting a repository URL in the prompt bar opens its import form, in the Applications section", async ({ page, db: _db }) => {
  const prompt = page.getByRole("textbox", { name: "Describe what you want to build, or paste a BitBucket repository URL" });
  await page.goto("/new");
  await prompt.fill("https://github.com/acme/payee-hub");
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(prompt).toHaveAccessibleDescription(`Only repositories in the demo's BitBucket, ${BITBUCKET_HOST}, can be imported.`);
  await expect(prompt).toBeFocused();
  await expect(page).toHaveURL(/\/new$/);

  await prompt.fill(`https://${BITBUCKET_HOST}/projects/PAY/repos/payee-hub`);
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page).toHaveURL(/\/applications\/import\/PAY\/payee-hub$/);
  await expect(page.getByRole("heading", { level: 1, name: "Import PAY/payee-hub" })).toBeVisible();
  // Import form: the sidebar shows the Applications sub-menu with Import from BitBucket current.
  await expectCurrentItem(page, "Applications", "Import from BitBucket");
});

test("the import form's breadcrumb and Cancel return to the import page with the same project", async ({ page, db: _db }) => {
  await page.goto("/applications/import?project=MKT");
  await page.getByRole("link", { name: "Import MKT/fx-board" }).click();
  await expect(breadcrumbs(page).getByText("Import from BitBucket")).toHaveAttribute("href", "/applications/import?project=MKT");
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/applications\/import\?project=MKT$/);
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("MKT");
});

test("answers not found for a repository the demo's BitBucket does not have", async ({ page, db: _db }) => {
  const response = await page.goto("/applications/import/PAY/missing");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Repository not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Import from BitBucket" })).toHaveAttribute("href", "/applications/import");
});

test("the import page fits a narrow screen", async ({ page, db: _db }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/applications/import");
  await expectNoHorizontalOverflow(page);
  await page.goto("/applications/import/PAY/payee-hub");
  await expectNoHorizontalOverflow(page);
});
