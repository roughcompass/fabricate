import type { Page } from "@playwright/test";
import { createRequire } from "node:module";
import { itemById } from "../../src/components/toolbar/toolbar-context";
import { expect } from "./fixtures";
import { application } from "./running-app";

/** Helpers for the toolbar over a running application. */

const require = createRequire(import.meta.url);

/** The toolbar's controls' WCAG 2 A and AA violations, by rule, as axe-core finds them in the page. */
export async function auditToolbar(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
    const result = await axe.run({ include: [['[data-toolbar="controls"]']] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"], iframes: false });
    return result.violations.map((violation) => violation.id);
  });
}

const menuDialog = (page: Page) => page.getByRole("dialog", { name: "Toolbar", exact: true });

/** Opens the toolbar menu from the pill. */
export async function openToolbarMenu(page: Page) {
  if (await menuDialog(page).isVisible()) return menuDialog(page);
  await page.getByRole("button", { name: /^Open toolbar menu/ }).click();
  await expect(menuDialog(page)).toBeVisible();
  return menuDialog(page);
}

/** Opens a toolbar item through the menu, as a visitor would: "accessibility", "timing", "comments", and so on. */
export async function openTool(page: Page, id: string) {
  const item = itemById(id);
  if (!item) throw new Error(`No toolbar item ${id}`);
  const menu = await openToolbarMenu(page);
  await menu.getByRole("option", { name: new RegExp(`^${item.name}( |,|$)`) }).click();
  await expect(menuDialog(page)).toBeHidden();
}

/** Starts comment mode through the menu. */
export async function startComment(page: Page) {
  await openTool(page, "comment");
  await expect(page.getByText("Choose any element to comment on it. Press Esc to cancel.")).toBeVisible();
}

/**
 * Asserts that nothing overlays the toolbar: the point at the center of every
 * visible toolbar control belongs to the controls themselves. A control
 * partly scrolled out of a panel counts only by the part its panel shows.
 */
export async function expectToolbarOnTop(page: Page): Promise<void> {
  const covered = await page.evaluate(() => {
    const controls = document.querySelector('[data-toolbar="controls"]');
    if (!controls) return ["no toolbar controls"];
    const visibleBox = (element: HTMLElement) => {
      let { left, top, right, bottom } = element.getBoundingClientRect();
      for (let parent = element.parentElement; parent && parent !== controls; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflow === "visible") continue;
        const clip = parent.getBoundingClientRect();
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
      return { left, top, width: right - left, height: bottom - top };
    };
    const targets = [...controls.querySelectorAll<HTMLElement>("button, a[href], input, [role='option'], [role='dialog']")].filter((element) => {
      const box = visibleBox(element);
      return box.width > 0 && box.height > 0;
    });
    return targets.flatMap((element) => {
      const box = visibleBox(element);
      const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return hit && controls.contains(hit) ? [] : [`${element.tagName.toLowerCase()} "${element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30)}" is covered by ${hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0]}` : "nothing"}`];
    });
  });
  expect(covered, "toolbar controls covered").toEqual([]);
}

/** Routes Quotes desk's quotesPanel to Quotes panel's feature/blue-quotes in Microfrontends, and waits until the frame shows it. */
export async function routeQuotesPanelToBlue(page: Page): Promise<void> {
  await openTool(page, "microfrontends");
  const microfrontends = page.getByRole("dialog", { name: "Microfrontends" });
  await microfrontends.locator('[data-member="quotesPanel"]').click();
  await microfrontends.getByRole("group", { name: "Version" }).getByRole("radio", { name: /feature\/blue-quotes/ }).check();
  await microfrontends.getByRole("button", { name: "Reload application", exact: true }).click();
  await expect(application(page).getByRole("heading", { name: "Blue quotes panel", level: 2 })).toBeVisible();
}
