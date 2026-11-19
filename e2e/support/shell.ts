import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/** The sidebar's navigation. */
const primaryNavigation = (page: Page) => page.getByRole("navigation", { name: "Primary" });

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

/** The page header: the page's title, breadcrumbs, and actions; within +scope+, and of one template when +template+ is given, as in the gallery's specimens. */
export const pageHeader = (scope: Page | Locator, template?: string) => scope.locator(template ? `[data-page-header][data-template="${template}"]` : "[data-page-header]");

/** The page's title: its only top-level heading, in its page header (page-patterns spec, "Title in the page"). */
export const pageTitle = (page: Page) => pageHeader(page).getByRole("heading", { level: 1 });

/** The toasts on screen, newest last. */
export const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" }).getByRole("listitem");

/** Sets the theme cookie, so pages the context loads next render in +theme+. */
export async function useTheme(context: BrowserContext, theme: "light" | "dark", baseURL: string): Promise<void> {
  await context.addCookies([{ name: "frontend-registry-theme", value: theme, url: baseURL }]);
}
