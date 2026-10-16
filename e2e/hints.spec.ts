import type { Locator, Page } from "@playwright/test";
import { expectToolbarOnTop, openTool, waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** Guided hints for self-serve visitors (template-demo/demo-mode spec). */

test.use({ guidedHints: true });

const hint = (page: Page) => page.locator("[data-hint]");

async function openRunning(page: Page, slug: string) {
  await page.goto(`/run/ref-${slug}`);
  await waitForRegions(page);
}

async function openSettings(page: Page) {
  await openTool(page, "settings");
  return page.getByRole("dialog", { name: "Settings" });
}

test("walks a first-time visitor through the create page, and does not repeat", async ({ page, db: _db }) => {
  await page.goto("/applications/new");
  // Two hints, on Add application: the prompt bar, then the starters.
  await expect(page.getByRole("dialog", { name: "Hint 1 of 2: Describe what you need" })).toBeVisible();
  await hint(page).getByRole("button", { name: "Next hint" }).click();
  await expect(page.getByRole("dialog", { name: "Hint 2 of 2: Start from a starter" })).toBeVisible();
  const stored = page.waitForResponse((response) => response.url().endsWith("/api/demo/hints") && response.ok());
  await hint(page).getByRole("button", { name: "Finish hints" }).click();
  await expect(hint(page)).toHaveCount(0);
  await stored;

  await page.reload();
  await expect(page.getByRole("heading", { name: "Let's build something new" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);
});

test("opens the toolbar menu for a first running application's visitor, points to its items, and remembers a dismissal", async ({ page, db: _db }) => {
  await openRunning(page, "payments-workspace");
  const first = page.getByRole("dialog", { name: "Hint 1 of 3: Audit accessibility" });
  await expect(first).toBeVisible();
  await expect(first.getByRole("button", { name: "Next hint" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Dismiss hints" })).toBeVisible();
  const menu = page.getByRole("dialog", { name: "Toolbar", exact: true });
  await expect(menu).toBeVisible();

  // The hint sits to the left of the menu, level with the Accessibility item, and covers neither the menu nor the pill.
  const expectBeside = async (card: Locator, item: string) => {
    const [box, target, menuBox, pill] = await Promise.all([card.boundingBox(), menu.getByRole("option", { name: item }).boundingBox(), menu.boundingBox(), page.getByRole("complementary", { name: "Toolbar", exact: true }).boundingBox()]);
    expect(box!.x + box!.width).toBeLessThanOrEqual(menuBox!.x);
    expect(box!.y).toBeLessThan(target!.y + target!.height);
    expect(box!.y + box!.height).toBeGreaterThan(target!.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(pill!.x);
  };
  await expectBeside(first, "Accessibility");
  await expectToolbarOnTop(page);

  await first.getByRole("button", { name: "Next hint" }).click();
  const second = page.getByRole("dialog", { name: "Hint 2 of 3: Swap microfrontend versions" });
  await expect(second).toBeVisible();
  await expectBeside(second, "Microfrontends");
  const stored = page.waitForResponse((response) => response.url().endsWith("/api/demo/hints") && response.ok());
  await hint(page).getByRole("button", { name: "Dismiss hints" }).click();
  await expect(hint(page)).toHaveCount(0);
  // The hints opened the menu, so dismissing them closes it.
  await expect(menu).toBeHidden();
  await stored;

  await openRunning(page, "market-watch");
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);
  await expect(menu).toBeHidden();
});

test("walks through the last hint to the Comment item, and finishes", async ({ page, db: _db }) => {
  await openRunning(page, "payments-workspace");
  await hint(page).getByRole("button", { name: "Next hint" }).click();
  await hint(page).getByRole("button", { name: "Next hint" }).click();
  const last = page.getByRole("dialog", { name: "Hint 3 of 3: Comment on anything" });
  await expect(last).toBeVisible();
  const [card, item] = await Promise.all([last.boundingBox(), page.getByRole("dialog", { name: "Toolbar", exact: true }).getByRole("option", { name: "Comment", exact: true }).boundingBox()]);
  expect(card!.x + card!.width).toBeLessThanOrEqual(item!.x);
  await last.getByRole("button", { name: "Finish hints" }).click();
  await expect(hint(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Toolbar", exact: true })).toBeHidden();
});

test("replays the hints from the toolbar's Settings", async ({ page, db: _db }) => {
  await openRunning(page, "payments-workspace");
  await hint(page).getByRole("button", { name: "Dismiss hints" }).click();
  await expect(hint(page)).toHaveCount(0);

  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Replay hints" }).click();
  await expect(page.getByRole("dialog", { name: "Hint 1 of 3: Audit accessibility" })).toBeVisible();
  // Replaying covers the create page too.
  await page.goto("/applications/new");
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
  await page.goto("/applications/new");
  await expect(page.getByRole("heading", { name: "Let's build something new" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);

  // Turning them back on keeps finished sequences finished, and shows the rest.
  await openRunning(page, "client-onboarding");
  await (await openSettings(page)).getByLabel("Show guided hints").check();
  // The hints open the menu in place of the Settings panel.
  await expect(page.getByRole("dialog", { name: "Hint 1 of 3: Audit accessibility" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
});

test("shows no hints inside preview mode's frame", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview");
  const frame = (await (await page.locator("[data-preview-frame]").elementHandle())!.contentFrame())!;
  await frame.waitForSelector('[data-demo-mfe][data-demo-state="ready"]');
  await page.waitForTimeout(500);
  expect(await frame.locator("[data-hint]").count()).toBe(0);
  await expect(hint(page)).toHaveCount(0);
});
