import type { Page } from "@playwright/test";
import { BITBUCKET_HOST } from "../src/lib/demo/bitbucket";
import { BRANDS, TEMPLATES } from "../src/lib/demo/catalog";
import { galleryOrder } from "../src/lib/demo/gallery";
import { chipTemplates } from "../src/lib/demo/prompt";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";

/** The create page and the BitBucket import (template-gallery and deployments specs). */

const prompt = (page: Page) => page.getByRole("textbox", { name: "Describe what you want to build, or paste a BitBucket repository URL" });
const chips = (page: Page) => page.getByRole("list", { name: "Quick-start templates" }).getByRole("link");

async function submitPrompt(page: Page, text: string) {
  await prompt(page).fill(text);
  await page.getByRole("button", { name: "Start building" }).click();
}

test("opens from the Templates navigation item with the prompt bar, chips, import, and Build your solution", async ({ page, db: _db }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Templates" }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page).toHaveTitle("Let's build something new · Fabricate");
  await expect(page.getByRole("heading", { level: 1, name: "Let's build something new" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Templates" })).toHaveAttribute("aria-current", "page");

  // In order: the prompt bar, the chips, the Import Git Repository panel, and Build your solution.
  const order = await page.evaluate(() => {
    const at = (element: Element | null) => element?.getBoundingClientRect().top ?? -1;
    return [
      at(document.querySelector("#new-prompt")),
      at(document.querySelector('[aria-label="Quick-start templates"]')),
      at([...document.querySelectorAll("h2")].find((heading) => heading.textContent === "Import Git Repository") ?? null),
      at([...document.querySelectorAll("h2")].find((heading) => heading.textContent === "Build your solution") ?? null),
    ];
  });
  expect(order.every((top) => top >= 0)).toBe(true);
  expect(order[0]).toBeLessThan(order[1]!);
  expect(order[1]).toBeLessThan(order[2]!);
  expect(order[2]).toBeLessThanOrEqual(order[3]!);

  await expect(chips(page)).toHaveText(chipTemplates(0).map((template) => template.title));
  await expect(page.getByRole("link", { name: "View applications" })).toBeVisible();
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
});

test("opens the gallery searched for a description", async ({ page, db: _db }) => {
  await page.goto("/new");
  await submitPrompt(page, "onboarding");
  await expect(page).toHaveURL(/\/templates\?q=onboarding$/);
  await expect(page.getByRole("searchbox", { name: "Search templates" })).toHaveValue("onboarding");
});

test("opens the import of a repository URL in the demo's BitBucket, and refuses any other URL", async ({ page, db: _db }) => {
  await page.goto("/new");
  await submitPrompt(page, "https://github.com/acme/payee-hub");
  await expect(prompt(page)).toHaveAccessibleDescription(`Only repositories in the demo's BitBucket, ${BITBUCKET_HOST}, can be imported.`);
  await expect(prompt(page)).toBeFocused();
  await expect(page).toHaveURL(/\/new$/);

  await submitPrompt(page, `https://${BITBUCKET_HOST}/projects/PAY/repos/payee-hub`);
  await expect(page).toHaveURL(/\/new\/import\?project=PAY&repository=payee-hub$/);
  await expect(page.getByRole("heading", { level: 1, name: "Import PAY/payee-hub" })).toBeVisible();
});

test("opens a template from a chip, and refreshes the chips through the catalog in a fixed order", async ({ page, db: _db }) => {
  await page.goto("/new");
  const sets = Math.ceil(TEMPLATES.length / 4);
  for (let set = 1; set <= sets; set++) {
    await page.getByRole("link", { name: "Show other templates" }).click();
    await expect(chips(page)).toHaveText(chipTemplates(set % sets).map((template) => template.title));
  }
  await chips(page).filter({ hasText: "Market watch" }).click();
  await expect(page).toHaveURL(/\/templates\/market-watch$/);
  await expect(page.getByRole("heading", { level: 1, name: "Market watch" })).toBeVisible();
});

test("shows four templates of the chosen brand and browses all of them in the gallery", async ({ page, db: _db }) => {
  await page.goto("/new");
  const solutions = (brand: keyof typeof BRANDS) => page.getByRole("list", { name: `${BRANDS[brand].label} templates` }).getByRole("heading");
  const expected = (brand: string) => galleryOrder(TEMPLATES.filter((template) => template.brand === brand)).slice(0, 4).map((template) => template.title);
  await expect(solutions("payments")).toHaveText(expected("payments"));

  await page.getByRole("combobox", { name: "Brand" }).selectOption("markets");
  await expect(page).toHaveURL(/\/new\?brand=markets$/);
  await expect(solutions("markets")).toHaveText(expected("markets"));
  await expect(solutions("markets").first()).toHaveText("Market watch");

  await page.getByRole("link", { name: "Browse all Markets templates" }).click();
  await expect(page).toHaveURL(/\/templates\?brand=markets$/);
  await expect(page.getByRole("checkbox", { name: /^Markets/ })).toBeChecked();
  const shown = TEMPLATES.filter((template) => template.brand === "markets").length;
  await expect(page.getByRole("status").filter({ hasText: "Showing" })).toHaveText(`Showing ${shown} of ${TEMPLATES.length} templates`);
});

test("imports a repository from the demo's BitBucket, then refuses to import it again", async ({ page, db: _db }) => {
  await page.goto("/new");
  const providers = page.getByRole("list", { name: "Git providers" });
  await expect(providers.getByRole("button", { name: "Continue with GitHub" })).toBeDisabled();
  await expect(providers.getByRole("button", { name: "Continue with GitHub" })).toHaveAccessibleDescription("Unavailable in the demo");
  await expect(providers.getByRole("button", { name: "Continue with GitLab" })).toBeDisabled();
  await providers.getByRole("link", { name: "Continue with BitBucket" }).click();

  const project = page.getByRole("combobox", { name: "Project" });
  await expect(project.locator("option")).toHaveText(["PAY · Payments", "GB · Global Banking", "MKT · Markets", "OPS · Operations"]);
  await project.selectOption("MKT");
  await expect(page.getByRole("list", { name: "Repositories in MKT" })).toContainText("fx-board");
  await project.selectOption("PAY");
  await page.getByRole("link", { name: "Import PAY/payee-hub" }).click();

  await expect(page).toHaveTitle("Import PAY/payee-hub · Fabricate");
  await expect(page.getByLabel("Application name")).toHaveValue("Payee hub");
  await expect(page.getByText("Payments workspace")).toBeVisible();
  await page.getByRole("button", { name: "Import application" }).click();

  await expect(page).toHaveURL(/\/applications\/app_[a-z0-9]{16}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Payee hub" })).toBeVisible();
  await expect(page.getByText("Connecting BitBucket repository PAY/payee-hub")).toBeVisible();
  await expect(page.getByText("Cloning PAY/payee-hub")).toBeVisible();
  await expect(page.getByText(/Creating BitBucket repository/)).toHaveCount(0);

  // The repository is now in the workspace, and a second import is refused.
  await page.goto("/new?provider=bitbucket");
  await expect(page.locator('[data-repository="PAY/payee-hub"]')).toContainText("In your workspace");
  await page.getByRole("link", { name: "Import PAY/payee-hub" }).click();
  await page.getByRole("button", { name: "Import application" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "payee-hub already exists in PAY" })).toBeVisible();
  await expect(page).toHaveURL(/\/new\/import/);
});

test("answers not found for a repository the demo's BitBucket does not have", async ({ page, db: _db }) => {
  const response = await page.goto("/new/import?project=PAY&repository=missing");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Repository not found" })).toBeVisible();
});

test("fits a narrow screen", async ({ page, db: _db }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/new?provider=bitbucket");
  await expectNoHorizontalOverflow(page);
});
