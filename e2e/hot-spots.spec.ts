import type { Page } from "@playwright/test";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { application, runOrdersPortal } from "./support/running-app";
import { expectToolbarOnTop, openTool } from "./support/toolbar";

/*
 * Timing's hot spots (restore-toolbar-tools-and-branch-previews, task 7.2;
 * template-demo/toolbar spec, "The timing tool highlights hot spots"), on
 * Orders portal, whose Recalculate totals button holds the main thread for
 * 650 ms.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(90_000);

const timing = (page: Page) => page.getByRole("dialog", { name: "Timing" });
const outlines = (page: Page) => page.locator("[data-hot-spot-outline]");

/** Uses the slow button, then opens Timing with hot spots shown. */
async function showHotSpots(page: Page) {
  await application(page).getByRole("button", { name: "Recalculate totals" }).click();
  await expect(application(page).getByText("Total balance $38,575")).toBeVisible();
  await openTool(page, "timing");
  await expect(timing(page).locator("[data-hot-spot]")).toHaveCount(1);
  await timing(page).getByLabel("Show hot spots").check();
}

/** The time a label or row gives, in milliseconds. */
const millis = (text: string) => Number(/([\d,]+) ms/.exec(text)![1]!.replace(/,/g, ""));

test("outlines Recalculate totals as the first hot spot, with its time and rating, and lists it", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  // A quick interaction is never a hot spot.
  await application(page).getByRole("button", { name: "Export orders" }).click();
  await openTool(page, "timing");
  await expect(timing(page).locator("[data-no-hot-spots]")).toHaveText("No interaction on this route needed improvement.");
  await timing(page).getByLabel("Show hot spots").check();
  await expect(outlines(page)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await showHotSpots(page);
  const outline = outlines(page);
  await expect(outline).toHaveCount(1);
  const label = await outline.innerText();
  expect(label).toMatch(/^#1 · [\d,]+ ms · Poor$/);
  expect(millis(label)).toBeGreaterThanOrEqual(650);
  // It's drawn on the button.
  const box = (await outline.boundingBox())!;
  const button = (await application(page).getByRole("button", { name: "Recalculate totals" }).boundingBox())!;
  expect(Math.abs(box.x - button.x)).toBeLessThan(2);
  expect(Math.abs(box.y - button.y)).toBeLessThan(2);

  const row = timing(page).locator("[data-hot-spot='1']");
  await expect(row).toHaveAttribute("data-rating", "poor");
  await expect(row).toContainText('#1 button "Recalculate totals"');
  await expect(row).toContainText("1 slow interaction on /accounts");
  await expect(row).toContainText("Poor");
  await expect(timing(page)).toContainText("Based on the interactions measured in this page since it loaded, never the toolbar's own.");
  // The outlines stay with the panel closed.
  await page.keyboard.press("Escape");
  await expect(outlines(page)).toHaveCount(1);
});

test("selecting a hot spot scrolls its element into view and highlights it", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  await showHotSpots(page);
  // The page grows and scrolls past the button.
  await application(page).locator("body").evaluate((body) => {
    body.style.paddingBottom = "3000px";
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect(application(page).getByRole("button", { name: "Recalculate totals" })).not.toBeInViewport();
  await timing(page).locator("[data-hot-spot='1']").getByRole("button").click();
  await expect(application(page).getByRole("button", { name: "Recalculate totals" })).toBeInViewport();
  await expect(timing(page).locator("[data-hot-spot='1']").getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(outlines(page)).toHaveAttribute("data-highlighted", "true");
});

test("Clear interactions removes the outlines and the list", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  await showHotSpots(page);
  await expect(outlines(page)).toHaveCount(1);
  await timing(page).getByRole("button", { name: "Clear interactions" }).click();
  await expect(outlines(page)).toHaveCount(0);
  await expect(timing(page).locator("[data-hot-spot]")).toHaveCount(0);
});

test("an element removed from the page is listed as not on this page, and one re-rendered is found again", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  await showHotSpots(page);
  const row = timing(page).locator("[data-hot-spot='1']");
  // The application renders the button again as a new element in the same place.
  await application(page)
    .getByRole("button", { name: "Recalculate totals" })
    .evaluate((button) => button.replaceWith(button.cloneNode(true)));
  await expect(outlines(page)).toHaveCount(1);
  await expect(row).toContainText("1 slow interaction on /accounts");
  // And then removes it.
  await application(page)
    .getByRole("button", { name: "Recalculate totals" })
    .evaluate((button) => button.remove());
  await expect(row).toContainText("Not on this page · /accounts");
  await expect(outlines(page)).toHaveCount(0);
});

test("a hot spot under the pill passes beneath it, and the pill's buttons still respond", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  // The application's Feedback tab, fixed under the pill, becomes slow to respond.
  const feedback = application(page).getByRole("button", { name: "Feedback" });
  await feedback.evaluate((button) =>
    button.addEventListener("click", () => {
      const end = performance.now() + 320;
      while (performance.now() < end) {
        // Busy, as a slow handler is.
      }
    }),
  );
  await feedback.focus();
  await page.keyboard.press("Enter");
  await openTool(page, "timing");
  await expect(timing(page).locator("[data-hot-spot]")).toHaveCount(1);
  await timing(page).getByLabel("Show hot spots").check();
  await page.keyboard.press("Escape");
  const outline = outlines(page);
  await expect(outline).toHaveCount(1);
  const box = (await outline.boundingBox())!;
  const pill = (await page.getByRole("complementary", { name: "Toolbar", exact: true }).boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(pill.x);
  expect(box.y).toBeLessThan(pill.y + pill.height);
  await expectToolbarOnTop(page);
  await page.getByRole("button", { name: /^Open toolbar menu/ }).click();
  await expect(page.getByRole("dialog", { name: "Toolbar", exact: true })).toBeVisible();
});
