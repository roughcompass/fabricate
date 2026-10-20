import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { addItem, setDefault } from "../src/lib/onboarding/navigation";
import { getPortal, promotePortal } from "../src/lib/onboarding/portals";
import { registerApplication } from "../test/support/applications";
import { ana, onboardPortal } from "../test/support/onboarding";
import { expect, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

// web-onboarding/runtime-configuration spec: Runtime Configuration in the
// primary menu, and the Portals page shown for All Portals.

const cards = (page: Page) => page.getByRole("list", { name: "Portals" }).getByRole("listitem");
const card = (page: Page, name: string) => page.locator(`[data-portal]`).filter({ has: page.getByRole("heading", { name, exact: true }) });
const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });

function promote(db: Db, portal: { publicId: string }) {
  const version = () => getPortal(db, portal.publicId).lockVersion;
  const application = registerApplication(db, { name: `${getPortal(db, portal.publicId).label} Home`, portal: getPortal(db, portal.publicId) });
  const item = addItem(db, portal.publicId, { lockVersion: version(), label: "Home", route: "/home", application: application.publicId, parent: null }, ana);
  setDefault(db, portal.publicId, { lockVersion: version(), entry: item.publicId }, ana);
  promotePortal(db, portal.publicId, { lockVersion: version() }, ana);
}

test("A Portal is current: Runtime Configuration opens its Experience Editor (A Portal is current)", async ({ page, db, baseURL }) => {
  const access = onboardPortal(db, "Access");
  await page.context().addCookies([{ name: "fabricate-portal", value: access.publicId, url: baseURL! }]);
  await page.goto("/");
  await primary(page).getByRole("link", { name: "Runtime Configuration" }).click();
  await expect(page).toHaveURL(new RegExp(`/portals/${access.publicId}/editor/frame-zones$`));
  await expect(primary(page).getByRole("link", { name: "Experience Editor" })).toHaveAttribute("aria-current", "page");
});

test("All Portals is current: Runtime Configuration opens the Portals page, with every Portal as a card (All Portals is current)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access", { ownerTeam: "Access Platform" });
  onboardPortal(db, "Markets");
  registerApplication(db, { name: "Payee Hub", portal: access });
  await page.goto("/");
  await primary(page).getByRole("link", { name: "Runtime Configuration" }).click();
  await expect(page).toHaveURL(/\/portals$/);
  await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Portals");
  await expect(primary(page).getByRole("link", { name: "All Portals" })).toHaveAttribute("aria-current", "page");
  await expect(cards(page)).toHaveCount(2);
  await expect(card(page, "Access")).toContainText("Web");
  await expect(card(page, "Access")).toContainText("Prototype");
  await expect(card(page, "Access")).toContainText("Access Platform");
  await expect(card(page, "Access")).toContainText("1 Application");
  await expect(card(page, "Access")).toContainText("0 menu items");
});

test("Choosing a Portal: its card makes it current and opens its Experience Editor (Choosing a Portal)", async ({ page, db }) => {
  onboardPortal(db, "Access");
  const markets = onboardPortal(db, "Markets");
  await page.goto("/portals");
  await waitForHydration(page);
  await card(page, "Markets").getByRole("button", { name: "Markets", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/portals/${markets.publicId}/editor/frame-zones$`));
  await expect(page.locator("#sidebar").getByRole("button", { name: /^Switch Portal, current: Markets/ })).toBeVisible();
});

test("Create Portal: the Portals page offers it (Create Portal)", async ({ page, db: _db }) => {
  await page.goto("/portals");
  await waitForHydration(page);
  await page.locator("[data-page-header]").getByRole("link", { name: "Create Portal" }).click();
  await expect(page.getByRole("dialog", { name: /^Create/ })).toBeVisible();
});

test("Searching: the search narrows the cards and is kept in the address, and no match offers to clear (Searching)", async ({ page, db }) => {
  onboardPortal(db, "Access");
  onboardPortal(db, "Markets");
  await page.goto("/portals");
  await waitForHydration(page);
  await page.getByRole("searchbox", { name: "Search Portals" }).fill("mark");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/portals\?q=mark$/);
  await expect(cards(page)).toHaveCount(1);
  await expect(card(page, "Markets")).toBeVisible();
  await page.goto("/portals?q=nothing");
  await expect(page.getByText("No Portal matches “nothing”.")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Clear search" }).last().click();
  await expect(cards(page)).toHaveCount(2);
});

test("Production tab: only Portals in Production are listed, and the address records the tab (Production tab)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  onboardPortal(db, "Markets");
  promote(db, access);
  await page.goto("/portals");
  await page.getByRole("link", { name: /^Production/ }).click();
  await expect(page).toHaveURL(/\/portals\?tab=production$/);
  await expect(cards(page)).toHaveCount(1);
  await expect(card(page, "Access")).toContainText("Production");
});

test("Wide viewport: seven Portals sit three per row (Wide viewport)", async ({ page, db }) => {
  for (const name of ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"]) onboardPortal(db, name);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/portals");
  const tops = await cards(page).evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(3);
  expect(tops.filter((top) => top === tops[0]).length).toBe(3);
  const heights = await cards(page).evaluateAll((items) => items.slice(0, 3).map((item) => Math.round(item.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
});

test("Narrow viewport: the cards stack in one column, and nothing overflows (Narrow viewport)", async ({ page, db }) => {
  for (const name of ["Alpha", "Bravo", "Charlie"]) onboardPortal(db, name);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/portals");
  const lefts = await cards(page).evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Applications: seven Applications at 1920px sit three per row (Three per row)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  for (let index = 0; index < 7; index++) registerApplication(db, { name: `Application ${index + 1}`, portal: access });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/applications?portal=all");
  const tops = await page.getByRole("list", { name: "Applications" }).getByRole("listitem").evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(3);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("Choosing a card makes the Portal current and opens its Experience Editor", async ({ page, db }) => {
    const markets = onboardPortal(db, "Markets");
    await page.goto("/portals");
    await card(page, "Markets").getByRole("button", { name: "Markets", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/portals/${markets.publicId}/editor/frame-zones$`));
    await expect(page.locator("#sidebar").getByRole("button", { name: /^Switch Portal, current: Markets/ })).toBeVisible();
  });
});
