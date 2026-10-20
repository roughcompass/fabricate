import type { Page } from "@playwright/test";
import { registerApplication } from "../test/support/applications";
import { onboardPortal } from "../test/support/onboarding";
import { waitForRegions } from "./support/demo";
import { openEditor, saveDirectly } from "./support/experience";
import { expect, test } from "./support/fixtures";

/*
 * A Portal's saved experience in the running portal (portal-runtime spec,
 * "A running portal applies a Portal's saved experience", "The saved
 * experience shapes the running shell", and "The experience editor opens the
 * running portal"): ?portal= loads the saved experience, routes keep it, and
 * pending changes never reach it.
 */

const header = (page: Page) => page.locator('[data-demo-anchor="portal-header"]');
const banner = (page: Page) => page.locator('[data-demo-anchor="portal-banner"]');
const footer = (page: Page) => page.getByRole("contentinfo");

test("A saved banner, a renamed portal, and a hidden footer reach the Access shell, and routes keep the Portal", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  saveDirectly(db, access, (draft) => {
    draft.brand.portalName = "Digital Platform";
    draft.frame.footer.visible = false;
    draft.messages.push({ id: "msg_maint", title: "Scheduled maintenance", description: "Saturday 02:00 to 04:00 UTC.", severity: "warning", dismissible: true, enabled: true, startsAt: null, endsAt: null });
  });
  await page.goto(`/run/ref-payments-workspace?portal=${access.publicId}`);
  await waitForRegions(page);
  await expect(page).toHaveTitle("Payments workspace · Digital Platform");
  await expect(header(page).getByRole("link", { name: "J.P. Morgan Digital Platform", exact: true })).toContainText("Digital Platform");
  await expect(banner(page)).toContainText("Scheduled maintenance Saturday 02:00 to 04:00 UTC.");
  await expect(footer(page)).toHaveCount(0);

  const navigation = page.getByRole("navigation", { name: "J.P. Morgan Digital Platform navigation" });
  await navigation.getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(new RegExp(`/run/ref-payments-workspace/activity\\?portal=${access.publicId}$`));
  await expect(banner(page)).toBeVisible();
  await expect(footer(page)).toHaveCount(0);

  await banner(page).getByRole("button", { name: "Dismiss message" }).click();
  await expect(banner(page)).toHaveCount(0);
});

test("The saved favicon is the page's icon, and none renders once it's turned off", async ({ page, db }) => {
  // A Portal's experience starts with the default favicon, before any save.
  const access = onboardPortal(db, "Access");
  await page.goto(`/run/ref-payments-workspace?portal=${access.publicId}`);
  await expect(page.locator('head link[rel="icon"][href^="data:image/svg+xml"]')).toHaveCount(1);
  saveDirectly(db, access, (draft) => void (draft.favicon.enabled = false));
  await page.goto(`/run/ref-payments-workspace?portal=${access.publicId}`);
  await expect(page.locator('head link[rel="icon"]')).toHaveCount(0);
});

test("Installed toolkits put Global Search and Notifications in the header, in the saved order, and the saved menu in the left menu", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const treasury = registerApplication(db, { name: "Treasury Sweeps", portal: access });
  saveDirectly(db, access, (draft) => {
    draft.toolkits.installed.push("global-search", "notifications");
    draft.toolkits.globalSearch.placeholder = "Search payments";
    draft.menu = [
      { id: "tmp_group", parentId: null, kind: "group", label: "Cash Management", route: null, application: null, isDefault: false },
      { id: "tmp_sub", parentId: "tmp_group", kind: "group", label: "Liquidity", route: null, application: null, isDefault: false },
      { id: "tmp_item", parentId: "tmp_sub", kind: "item", label: "Sweeps", route: "/sweeps", application: treasury.publicId, isDefault: false },
    ];
  });
  await page.goto(`/run/ref-payments-workspace?portal=${access.publicId}`);
  await waitForRegions(page);
  await expect(header(page).getByRole("textbox", { name: "Search" })).toHaveAttribute("placeholder", "Search payments");
  await expect(header(page).getByRole("button", { name: "Notifications" })).toBeVisible();
  const order = await header(page).locator('input[aria-label="Search"], button[aria-label="Notifications"], button[aria-label="Help"]').evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  expect(order).toEqual(["Search", "Help", "Notifications"]);
  await page.keyboard.press("/");
  await expect(header(page).getByRole("textbox", { name: "Search" })).toBeFocused();

  const navigation = page.getByRole("navigation", { name: "J.P. Morgan Access navigation" });
  await expect(navigation.getByRole("button", { name: "Reports and Insights" })).toHaveCount(0);
  await navigation.getByRole("button", { name: "Cash Management" }).click();
  await navigation.getByRole("button", { name: "Liquidity" }).click();
  await expect(navigation.getByText("Sweeps")).toBeVisible();
});

test("An unsaved change in the editor never reaches the running portal", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await openEditor(page, access);
  await page.locator("[data-zone-row='footer']").getByRole("button", { name: "Show Footer Zone" }).click();
  await expect(page.locator("[data-pending-count]")).toHaveText("1 unsaved change");
  const running = await page.context().newPage();
  await running.goto(`/run/ref-payments-workspace?portal=${access.publicId}`);
  await waitForRegions(running);
  await expect(running.getByRole("contentinfo")).toBeVisible();
  await running.close();
});

test("A Markets-themed Portal opens the Markets reference from the editor, with its saved name and a flyout menu", async ({ page, db }) => {
  const markets = onboardPortal(db, "Markets Desk");
  saveDirectly(db, markets, (draft) => {
    draft.theme.id = "markets";
    draft.frame.sidebar.menuType = "flyout";
    draft.copyright = "© 2026 JPMorgan Chase & Co. Markets.";
  });
  await openEditor(page, markets);
  const [running] = await Promise.all([page.context().waitForEvent("page"), page.getByRole("link", { name: /Open running portal/ }).click()]);
  await running.waitForLoadState();
  await expect(running).toHaveURL(new RegExp(`/run/ref-market-watch\\?portal=${markets.publicId}$`));
  await waitForRegions(running);
  await expect(running.locator("[data-demo-portal]")).toHaveAttribute("data-shell", "markets");
  await expect(running.getByRole("link", { name: "J.P. Morgan Markets Desk", exact: true })).toBeVisible();
  await expect(running.getByRole("contentinfo")).toContainText("© 2026 JPMorgan Chase & Co. Markets.");
  await running.getByRole("button", { name: "Open menu" }).click();
  await expect(running.getByRole("navigation", { name: "J.P. Morgan Markets Desk menu" })).toBeVisible();
  await running.keyboard.press("Escape");
  await expect(running.getByRole("navigation", { name: "J.P. Morgan Markets Desk menu" })).toBeHidden();
});

test("A Payments application opened for a Markets-themed Portal renders in the Markets shell", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  saveDirectly(db, access, (draft) => void (draft.theme.id = "markets"));
  await page.goto(`/run/ref-payments-workspace?portal=${access.publicId}`);
  await waitForRegions(page);
  await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-shell", "markets");
});
