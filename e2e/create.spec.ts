import type { Page } from "@playwright/test";
import { BRANDS, TEMPLATES } from "../src/lib/demo/catalog";
import { galleryOrder } from "../src/lib/demo/gallery";
import { chipTemplates } from "../src/lib/demo/prompt";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { expectCurrentItem, openItem } from "./support/shell";
import { paths } from "./support/paths";

/** The create page (template-gallery spec). The BitBucket import has its own spec, import-bitbucket.spec.ts. */

const prompt = (page: Page) => page.getByRole("textbox", { name: "Describe what you want to build, or paste a BitBucket repository URL" });
const chips = (page: Page) => page.getByRole("list", { name: "Quick-start templates" }).getByRole("link");

async function submitPrompt(page: Page, text: string) {
  await prompt(page).fill(text);
  await page.getByRole("button", { name: "Start building" }).click();
}

test("Opening the create page: from the Salt Patterns section, with the prompt bar, chips, and Build your solution, and no import panel", async ({ page, db: _db }) => {
  await page.goto(paths.assessments);
  await openItem(page, "Salt Patterns", "New application");
  await expect(page).toHaveURL(/\/new$/);
  await expect(page).toHaveTitle("Let's build something new · DE FabLab");
  await expect(page.getByRole("heading", { level: 1, name: "Let's build something new" })).toBeVisible();
  await expectCurrentItem(page, "Salt Patterns", "New application");

  // In order: the prompt bar, the chips, and Build your solution. The import lives under Applications.
  const ordered = await page.evaluate(() => {
    const heading = (text: string) => [...document.querySelectorAll("h2")].find((element) => element.textContent === text) ?? null;
    const parts = [document.querySelector("#new-prompt"), document.querySelector('[aria-label="Quick-start templates"]'), heading("Build your solution")];
    return parts.every(Boolean) && parts.every((part, index) => index === 0 || Boolean(parts[index - 1]!.compareDocumentPosition(part!) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(ordered).toBe(true);
  await expect(page.getByRole("heading", { name: "Import Git Repository" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Git providers" })).toHaveCount(0);

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

  // Browsing all from the create page opens the page titled Salt Patterns, with the brand chosen.
  await page.getByRole("link", { name: "Browse all Markets templates" }).click();
  await expect(page).toHaveURL(/\/templates\?brand=markets$/);
  await expect(page.getByRole("heading", { level: 1, name: "Salt Patterns" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Markets/ })).toBeChecked();
  const shown = TEMPLATES.filter((template) => template.brand === "markets").length;
  await expect(page.getByRole("status").filter({ hasText: "Showing" })).toHaveText(`Showing ${shown} of ${TEMPLATES.length} templates`);
});

test("fits a narrow screen", async ({ page, db: _db }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/new");
  await expectNoHorizontalOverflow(page);
});
