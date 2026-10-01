import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

/** The sidebar's navigation. */
export const primaryNavigation = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/** Opens a top-level section from the sidebar, first showing the section menu when a sub-menu is shown. */
export async function openSection(page: Page, name: string): Promise<void> {
  const nav = primaryNavigation(page);
  const back = nav.getByRole("link", { name: "Show all sections" });
  if (await back.isVisible()) await back.click();
  await nav.getByRole("link", { name, exact: true }).click();
}

/** Opens a section, then one of its sub-menu items, such as New application in Salt Patterns. */
export async function openItem(page: Page, section: string, item: string): Promise<void> {
  await openSection(page, section);
  await expect(primaryNavigation(page).locator("#sidebar-section-title")).toHaveText(section);
  await primaryNavigation(page).getByRole("link", { name: item, exact: true }).click();
}

/**
 * Waits until the page has hydrated, before clicking controls that work only
 * with JavaScript: the shell's Hide sidebar control submits a form until then,
 * and toggles in place after. The page hydrates in one pass, so the shell
 * hydrating means every control has.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-sidebar-toggle="hidden"]')).toHaveAttribute("type", "button");
}

/** Expects the sidebar to show the sub-menu of `section` with `item` marked as the page's item. */
export async function expectCurrentItem(page: Page, section: string, item: string): Promise<void> {
  const nav = primaryNavigation(page);
  await expect(nav.locator("#sidebar-section-title")).toHaveText(section);
  await expect(nav.getByRole("link", { name: item, exact: true })).toHaveAttribute("aria-current", "page");
}
