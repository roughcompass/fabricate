import type { Page } from "@playwright/test";
import { waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** Guided hints for self-serve visitors (template-demo/demo-mode spec). */

test.use({ guidedHints: true });

const hint = (page: Page) => page.locator("[data-hint]");

async function openRunning(page: Page, slug: string) {
  await page.goto(`/run/ref-${slug}`);
  await waitForRegions(page);
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  return page.getByRole("dialog", { name: "Settings" });
}

test("walks a first-time visitor through the create page, and does not repeat", async ({ page, db: _db }) => {
  await page.goto("/new");
  // Two hints: the import moved to the Applications section.
  await expect(page.getByRole("dialog", { name: "Hint 1 of 2: Describe what you need" })).toBeVisible();
  await hint(page).getByRole("button", { name: "Next hint" }).click();
  await expect(page.getByRole("dialog", { name: "Hint 2 of 2: Start from a template" })).toBeVisible();
  const stored = page.waitForResponse((response) => response.url().endsWith("/api/demo/hints") && response.ok());
  await hint(page).getByRole("button", { name: "Finish hints" }).click();
  await expect(hint(page)).toHaveCount(0);
  await stored;

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Let's build something new" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);
});

test("points a first running application's visitor to the Accessibility tool, and remembers a dismissal", async ({ page, db: _db }) => {
  await openRunning(page, "payments-workspace");
  const first = page.getByRole("dialog", { name: "Hint 1 of 3: Audit accessibility" });
  await expect(first).toBeVisible();
  await expect(first.getByRole("button", { name: "Next hint" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Dismiss hints" })).toBeVisible();
  // The hint sits just above the Accessibility tool.
  const tool = (await page.getByRole("button", { name: "Open accessibility audit" }).boundingBox())!;
  const card = (await first.boundingBox())!;
  expect(card.y + card.height).toBeLessThanOrEqual(tool.y);
  expect(card.x).toBeLessThanOrEqual(tool.x + tool.width);
  expect(card.x + card.width).toBeGreaterThanOrEqual(tool.x);

  await first.getByRole("button", { name: "Next hint" }).click();
  await expect(page.getByRole("dialog", { name: "Hint 2 of 3: Swap microfrontend versions" })).toBeVisible();
  const stored = page.waitForResponse((response) => response.url().endsWith("/api/demo/hints") && response.ok());
  await hint(page).getByRole("button", { name: "Dismiss hints" }).click();
  await expect(hint(page)).toHaveCount(0);
  await stored;

  await openRunning(page, "market-watch");
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);
});

test("replays the hints from the toolbar's Settings", async ({ page, db: _db }) => {
  await openRunning(page, "payments-workspace");
  await hint(page).getByRole("button", { name: "Dismiss hints" }).click();
  await expect(hint(page)).toHaveCount(0);

  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Replay hints" }).click();
  await expect(page.getByRole("dialog", { name: "Hint 1 of 3: Audit accessibility" })).toBeVisible();
  // Replaying covers the create page too.
  await page.goto("/new");
  await expect(page.getByRole("dialog", { name: "Hint 1 of 2: Describe what you need" })).toBeVisible();
});

test("never shows hints once they are turned off", async ({ page, db: _db }) => {
  await openRunning(page, "payments-workspace");
  await expect(hint(page)).toHaveCount(1);
  const settings = await openSettings(page);
  await settings.getByLabel("Show guided hints").uncheck();
  await expect(hint(page)).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Replay hints" })).toBeDisabled();

  await openRunning(page, "client-onboarding");
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);
  await page.goto("/new");
  await expect(page.getByRole("heading", { level: 1, name: "Let's build something new" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);

  // Turning them back on keeps finished sequences finished, and shows the rest.
  await openRunning(page, "client-onboarding");
  await (await openSettings(page)).getByLabel("Show guided hints").check();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Hint 1 of 3: Audit accessibility" })).toBeVisible();
});

test("shows no hints inside preview mode's frame", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview");
  const frame = (await (await page.locator("[data-preview-frame]").elementHandle())!.contentFrame())!;
  await frame.waitForSelector('[data-demo-mfe][data-demo-state="ready"]');
  await page.waitForTimeout(500);
  expect(await frame.locator("[data-hint]").count()).toBe(0);
  await expect(hint(page)).toHaveCount(0);
});
