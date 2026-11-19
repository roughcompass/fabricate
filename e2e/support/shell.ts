import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "./fixtures";

/** The sidebar's navigation. */
const primaryNavigation = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/** Opens a top-level section from the sidebar. */
export async function openSection(page: Page, name: string): Promise<void> {
  await primaryNavigation(page).getByRole("link", { name, exact: true }).click();
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

/** Expects the sidebar to mark `item` as the page's item: "page" on the item's own page, "true" on a page below it. */
export async function expectCurrentItem(page: Page, item: string, current: "page" | "true" = "page"): Promise<void> {
  await expect(primaryNavigation(page).getByRole("link", { name: item, exact: true })).toHaveAttribute("aria-current", current);
}

/** The page header: the page's title, breadcrumbs, and actions. */
export const pageHeader = (page: Page) => page.locator("[data-page-header]");

/** The toasts on screen, newest last. */
export const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" }).getByRole("listitem");

/** Sets the theme cookie, so pages the context loads next render in +theme+. */
export async function useTheme(context: BrowserContext, theme: "light" | "dark", baseURL: string): Promise<void> {
  await context.addCookies([{ name: "frontend-registry-theme", value: theme, url: baseURL }]);
}
