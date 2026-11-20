import type { Locator, Page } from "@playwright/test";
import { expectToolbarOnTop, openTool } from "./support/toolbar";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { framedRun } from "./support/fixture-app";
import { runOrdersPortal, waitForPage } from "./support/running-app";

/*
 * Guided hints for a running application's first-time visitor
 * (template-demo/demo-mode spec, "Self-serve visitors receive guided hints";
 * add-applications, task 8.7): they open the toolbar menu and point to
 * Accessibility, Timing, and Comment, on the fixture application.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(90_000);
test.use({ guidedHints: true });

const hint = (page: Page) => page.locator("[data-hint]");
const menu = (page: Page) => page.getByRole("dialog", { name: "Toolbar", exact: true });

async function openPreferences(page: Page) {
  await openTool(page, "shortcuts");
  return page.getByRole("dialog", { name: "Preferences / Keyboard shortcuts" });
}

test("opens the toolbar menu for a first-time visitor, points to Accessibility and Timing, and remembers a dismissal (First visit to a running application)", async ({ page, db }) => {
  const running = await runOrdersPortal(page, db);
  const first = page.getByRole("dialog", { name: "Hint 1 of 3: Audit accessibility" });
  await expect(first).toBeVisible();
  await expect(first.getByRole("button", { name: "Next hint" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Dismiss hints" })).toBeVisible();
  await expect(menu(page)).toBeVisible();

  // The hint sits to the left of the menu, level with its item, and covers neither the menu nor the pill.
  const expectBeside = async (card: Locator, item: string) => {
    const [box, target, menuBox, pill] = await Promise.all([card.boundingBox(), menu(page).getByRole("option", { name: item }).boundingBox(), menu(page).boundingBox(), page.getByRole("complementary", { name: "Toolbar", exact: true }).boundingBox()]);
    expect(box!.x + box!.width).toBeLessThanOrEqual(menuBox!.x);
    expect(box!.y).toBeLessThan(target!.y + target!.height);
    expect(box!.y + box!.height).toBeGreaterThan(target!.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(pill!.x);
  };
  await expectBeside(first, "Accessibility");
  await expectToolbarOnTop(page);

  await first.getByRole("button", { name: "Next hint" }).click();
  const second = page.getByRole("dialog", { name: "Hint 2 of 3: See what's slow" });
  await expect(second).toBeVisible();
  await expectBeside(second, "Timing");
  const stored = page.waitForResponse((response) => response.url().endsWith("/api/workspace/hints") && response.ok());
  await hint(page).getByRole("button", { name: "Dismiss hints" }).click();
  await expect(hint(page)).toHaveCount(0);
  // The hints opened the menu, so dismissing them closes it.
  await expect(menu(page)).toBeHidden();
  await stored;

  // Not repeated, on this application or any other (Hints are not repeated).
  await page.goto(framedRun(running, "/settings"));
  await waitForPage(page, "Settings");
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);
  await expect(menu(page)).toBeHidden();
});

test("walks through the last hint to the Comment item, and finishes", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  await hint(page).getByRole("button", { name: "Next hint" }).click();
  await hint(page).getByRole("button", { name: "Next hint" }).click();
  const last = page.getByRole("dialog", { name: "Hint 3 of 3: Comment on anything" });
  await expect(last).toBeVisible();
  const [card, item] = await Promise.all([last.boundingBox(), menu(page).getByRole("option", { name: "Comment", exact: true }).boundingBox()]);
  expect(card!.x + card!.width).toBeLessThanOrEqual(item!.x);
  await last.getByRole("button", { name: "Finish hints" }).click();
  await expect(hint(page)).toHaveCount(0);
  await expect(menu(page)).toBeHidden();
});

test("replays the hints from the toolbar's Preferences", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  await hint(page).getByRole("button", { name: "Dismiss hints" }).click();
  await expect(hint(page)).toHaveCount(0);

  const preferences = await openPreferences(page);
  await preferences.getByRole("button", { name: "Replay hints" }).click();
  await expect(page.getByRole("dialog", { name: "Hint 1 of 3: Audit accessibility" })).toBeVisible();
});

test("never shows hints once they are turned off, and shows the unfinished ones when they're back on (Hints off for a presentation)", async ({ page, db }) => {
  const running = await runOrdersPortal(page, db);
  await expect(hint(page)).toHaveCount(1);
  const preferences = await openPreferences(page);
  await preferences.getByLabel("Show guided hints").uncheck();
  await expect(hint(page)).toHaveCount(0);
  await expect(preferences.getByRole("button", { name: "Replay hints" })).toBeDisabled();

  await page.goto(framedRun(running, "/accounts"));
  await waitForPage(page, "Accounts");
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);

  await (await openPreferences(page)).getByLabel("Show guided hints").check();
  // The hints open the menu in place of the Preferences panel.
  await expect(page.getByRole("dialog", { name: "Hint 1 of 3: Audit accessibility" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Preferences / Keyboard shortcuts" })).toBeHidden();
});
