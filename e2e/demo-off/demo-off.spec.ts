import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";

// template-demo/demo-mode spec, with the demo turned off (npm run
// test:demo-off): Salt Patterns, reference deployments, and catalog templates
// don't exist; the operator pages work on their own.

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });

test("The primary menu has no Salt Patterns", async ({ page, db: _db }) => {
  await page.goto("/");
  await expect(primary(page).getByRole("link", { name: "All Assessments", exact: true })).toBeVisible();
  await expect(primary(page).getByRole("link", { name: "Salt Patterns", exact: true })).toHaveCount(0);
});

test("The gallery, a template, and a reference deployment don't exist", async ({ page, db: _db }) => {
  for (const address of ["/templates", "/templates/market-watch", "/run/ref-market-watch"]) {
    const response = await page.goto(address);
    expect(response?.status(), address).toBe(404);
  }
});
