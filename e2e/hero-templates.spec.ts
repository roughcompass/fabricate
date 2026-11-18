import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

// template-gallery spec: "Illustrative templates"; template-preview spec: the Code tab shows a hero's real source.

const card = (page: Page, title: string) => page.locator("li").filter({ has: page.getByRole("link", { name: title, exact: true }) });

test("labels a non-hero built-in Illustrative on its card, detail page, and Code tab (Illustrative templates)", async ({ page, db: _db }) => {
  await page.goto("/templates");
  await expect(card(page, "Corporate card controls").locator("[data-illustrative]")).toHaveText("Illustrative");
  await expect(card(page, "Payments workspace").locator("[data-illustrative]")).toHaveCount(0);

  await page.goto("/templates/corporate-card-controls");
  await expect(page.locator("dl").first()).toContainText("Illustrative: its code is generated from the catalog, not real Salt.");
  await page.goto("/templates/corporate-card-controls/preview?view=code");
  await expect(page.locator("[data-illustrative]")).toContainText("These files are illustrative");
});

test("shows a hero's real Salt source on the Code tab, with package.json naming its Salt packages", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview?view=code");
  await expect(page.locator("[data-illustrative]")).toHaveCount(0);
  await expect(page.getByRole("figure", { name: "package.json" })).toContainText('"@salt-ds/core"');
  await expect(page.getByRole("figure", { name: "package.json" })).toContainText('"@deweb/portal"');
  const files = page.getByRole("navigation", { name: "Files" });
  await files.getByRole("link", { name: "src/payee-list.tsx" }).click();
  const source = page.getByRole("figure", { name: "src/payee-list.tsx" });
  await expect(source).toContainText('from "@salt-ds/core"');
  await expect(source).toContainText('from "./data"');
});
