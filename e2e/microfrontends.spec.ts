import type { Locator, Page } from "@playwright/test";
import { expectToolbarOnTop, openTool, setView, waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** Microfrontends in the toolbar (template-demo/microfrontends spec). */

type Box = { x: number; y: number; width: number; height: number };

const region = (page: Page, member: string) => page.locator(`[data-demo-mfe="${member}"]`);
const panel = (page: Page) => page.getByRole("dialog", { name: "Microfrontends" });
const member = (page: Page, id: string) => panel(page).locator(`[data-member="${id}"]`);

async function openPanel(page: Page) {
  await openTool(page, "microfrontends");
  await expect(panel(page)).toBeVisible();
}

async function choose(page: Page, id: string, version: string) {
  await member(page, id).click();
  await panel(page).getByRole("radio", { name: new RegExp(`^${version.replaceAll(".", "\\.")}`) }).check();
}

test.beforeEach(async ({ page, db: _db }) => {
  await page.goto("/run/ref-payments-workspace");
  await waitForRegions(page);
});

test("lists every member of the group with its version and environment", async ({ page }) => {
  await openPanel(page);
  await expect(panel(page)).toContainText("J.P. Morgan Access · 4 members in this group");
  await expect(member(page, "payments-shell")).toContainText("Access shell for Payments");
  await expect(member(page, "payments-shell")).toContainText("Default application");
  await expect(member(page, "payee-list")).toContainText("1.4.2");
  await expect(member(page, "payee-list")).toContainText("Production");
  await member(page, "payee-list").click();
  await expect(panel(page)).toContainText("Payments Experience · Route /payees");
  await expect(panel(page).getByRole("radio")).toHaveCount(4);
});

test("switches the payee list to its prerelease, replacing only that region", async ({ page }) => {
  // Typed input in another region survives the swap (portal-runtime spec).
  const amount = region(page, "transfer-form").getByLabel("Amount (USD)");
  await amount.fill("250");

  await openPanel(page);
  await choose(page, "payee-list", "2.1.0-beta.1");
  await expect(member(page, "payee-list")).toContainText("Pending");
  await panel(page).getByRole("button", { name: "Reload preview" }).click();

  await expect(region(page, "payee-list")).toHaveAttribute("data-demo-state", "swapping");
  await expect(region(page, "payee-list")).toHaveAttribute("data-demo-state", "ready");
  await expect(region(page, "payee-list")).toHaveAttribute("data-demo-version", "2.1.0-beta.1");
  await expect(region(page, "payee-list").getByText("Preview: favorites first")).toBeVisible();
  await expect(member(page, "payee-list")).toContainText("Overridden");
  await expect(member(page, "payee-list")).not.toContainText("Pending");
  await expect(amount).toHaveValue("250");
  await expect(region(page, "transfer-form")).toHaveAttribute("data-demo-version", "3.0.1");
});

test("applies two changes together and resets both to their defaults", async ({ page }) => {
  await openPanel(page);
  await choose(page, "payee-list", "2.0.0");
  await choose(page, "transfer-form", "3.1.0");
  await panel(page).getByRole("button", { name: "Reload preview (2 changes)" }).click();
  await expect(region(page, "payee-list")).toHaveAttribute("data-demo-version", "2.0.0");
  await expect(region(page, "transfer-form")).toHaveAttribute("data-demo-version", "3.1.0");
  await expect(region(page, "transfer-form").getByLabel("Payment reference")).toBeVisible();

  await panel(page).getByRole("button", { name: "Reset to default" }).click();
  await expect(region(page, "payee-list")).toHaveAttribute("data-demo-version", "1.4.2");
  await expect(region(page, "transfer-form")).toHaveAttribute("data-demo-version", "3.0.1");
  await expect(panel(page).getByText("Overridden")).toHaveCount(0);
});

test("keeps overrides after a reload", async ({ page }) => {
  await openPanel(page);
  await choose(page, "payee-list", "2.0.0");
  await panel(page).getByRole("button", { name: "Reload preview" }).click();
  await expect(region(page, "payee-list")).toHaveAttribute("data-demo-version", "2.0.0");
  await page.reload();
  await waitForRegions(page);
  await expect(region(page, "payee-list")).toHaveAttribute("data-demo-version", "2.0.0");
  await openPanel(page);
  await expect(member(page, "payee-list")).toContainText("Overridden");
});

test.describe("select mode", () => {
  test("outlines the region under the pointer and opens the chosen one in the panel", async ({ page }) => {
    await openPanel(page);
    await panel(page).getByRole("button", { name: "Select on page" }).click();
    await expect(panel(page)).toBeHidden();
    await expect(page.getByText("Select a microfrontend on the page. Press Esc to cancel.")).toBeVisible();

    await region(page, "payee-list").hover();
    await expect(page.locator('[data-select-outline="payee-list"]')).toContainText("Payee list · 1.4.2");
    // The toolbar itself is never selectable.
    await page.getByRole("button", { name: /^Open toolbar menu/ }).hover();
    await expect(page.locator("[data-select-outline]")).toHaveCount(0);

    // Choosing a region does not operate the application underneath.
    await page.locator('[data-demo-anchor="pay-lumen"]').click();
    await expect(panel(page)).toBeVisible();
    await expect(member(page, "payee-list")).toHaveAttribute("aria-pressed", "true");
    await expect(panel(page).getByRole("radio", { name: /^1\.4\.2/ })).toBeChecked();
    await expect(region(page, "transfer-form").getByRole("combobox", { name: "Payee" })).toHaveText("Northwind Supplies");
  });

  test("selects with the keyboard and leaves with Escape", async ({ page }) => {
    await page.keyboard.press("m");
    await panel(page).getByRole("button", { name: "Select on page" }).click();
    await region(page, "transfer-form").getByLabel("Amount (USD)").focus();
    await expect(page.locator('[data-select-outline="transfer-form"]')).toContainText("Transfer form · 3.0.1");
    await page.keyboard.press("Escape");
    await expect(page.getByText("Select a microfrontend on the page. Press Esc to cancel.")).toBeHidden();
    await expect(panel(page)).toBeHidden();

    // Shortcuts are ignored while a field has focus, so leave the field first.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("m");
    await panel(page).getByRole("button", { name: "Select on page" }).click();
    await region(page, "transfer-form").getByLabel("Amount (USD)").focus();
    await page.keyboard.press("Enter");
    await expect(member(page, "transfer-form")).toHaveAttribute("aria-pressed", "true");
  });
});

test("shows which microfrontend serves each route in the zone indicator", async ({ page }) => {
  await openPanel(page);
  await panel(page).getByLabel("Zone indicator").check();
  const zone = page.getByRole("status", { name: "Zone indicator" });
  await expect(zone).toContainText("Payee list");
  await expect(zone).toContainText("1.4.2");
  await expect(zone).toContainText("Production");
  await page.keyboard.press("Escape");

  await page.getByRole("navigation", { name: "J.P. Morgan Access navigation" }).getByRole("link", { name: "Activity" }).click();
  await expect(zone).toContainText("Payment activity");
  await page.reload();
  await expect(page.getByRole("status", { name: "Zone indicator" })).toContainText("Payment activity");
});

test.describe("overlays beside the toolbar", () => {
  const pill = (page: Page) => page.getByRole("complementary", { name: "Toolbar", exact: true });
  const zone = (page: Page) => page.getByRole("status", { name: "Zone indicator" });
  const boxOf = async (locator: Locator) => (await locator.boundingBox())!;
  const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  test("moves the zone indicator left of an open panel, and neither covers the pill", async ({ page }) => {
    await openPanel(page);
    await panel(page).getByLabel("Zone indicator").check();
    await expect(zone(page)).toBeVisible();
    await expect.poll(async () => overlap(await boxOf(zone(page)), await boxOf(panel(page)))).toBe(false);
    expect(overlap(await boxOf(zone(page)), await boxOf(pill(page)))).toBe(false);
    expect(overlap(await boxOf(panel(page)), await boxOf(pill(page)))).toBe(false);
    await expectToolbarOnTop(page);

    // With the panel closed, it goes back to the top right.
    await page.keyboard.press("Escape");
    await expect.poll(async () => page.viewportSize()!.width - (await boxOf(zone(page)).then((box) => box.x + box.width))).toBeLessThan(16);
  });

  test("shows the zone indicator in full on a narrow viewport, clear of the pill", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openPanel(page);
    await panel(page).getByLabel("Zone indicator").check();
    await page.keyboard.press("Escape");
    await expect(zone(page)).toBeVisible();
    const box = await boxOf(zone(page));
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(overlap(box, await boxOf(pill(page)))).toBe(false);
  });

  test("places a debug label that would fall under the pill beside it", async ({ page }) => {
    // A region docked to the right edge, level with the pill, puts its label under the pill.
    await page.addStyleTag({ content: '[data-demo-mfe="payee-list"] { position: fixed !important; top: calc(50% - 40px) !important; right: 0 !important; width: 240px !important; }' });
    await openPanel(page);
    await panel(page).getByLabel("Enable debug mode").check();
    await page.keyboard.press("Escape");
    const label = page.locator('[data-debug-label="payee-list"]');
    await expect(label).toBeVisible();
    const region = await boxOf(page.locator('[data-demo-mfe="payee-list"]'));
    expect(overlap({ x: region.x + 4, y: region.y + 4, width: (await boxOf(label)).width, height: (await boxOf(label)).height }, await boxOf(pill(page)))).toBe(true);
    await expect.poll(async () => overlap(await boxOf(label), await boxOf(pill(page)))).toBe(false);
    expect((await boxOf(label)).x + (await boxOf(label)).width).toBeLessThanOrEqual((await boxOf(pill(page))).x);
    await expectToolbarOnTop(page);
    await page.getByRole("button", { name: /^Open toolbar menu/ }).click();
    await expect(page.getByRole("dialog", { name: "Toolbar", exact: true })).toBeVisible();
  });
});

test("explains each routing decision in debug mode", async ({ page }) => {
  await setView(page, { overrides: { "payee-list": { version: "2.0.0", environment: "production" } } });
  await openPanel(page);
  await panel(page).getByLabel("Enable debug mode").check();

  await expect(page.locator('[data-debug-label="payee-list"]')).toHaveText("payee-list@2.0.0 · Production · override");
  await expect(page.locator('[data-debug-label="payments-shell"]')).toHaveText("payments-shell@5.2.0 · Production · default");
  await expect(page.locator('[data-debug-label="transfer-form"]')).toHaveText("transfer-form@3.0.1 · Production · default");
  await expect(page.locator('[data-debug-label="payment-activity"]')).toHaveText("payment-activity@2.3.0 · Production · default");

  await expect(panel(page).getByRole("definition").filter({ hasText: "fallback" })).toHaveCount(0);
  await expect(panel(page).getByLabel("Routing headers for Payee list")).toContainText("x-demo-mfe-reasonoverride");
});
