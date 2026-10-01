import type { Page } from "@playwright/test";
import { createRequire } from "node:module";
import { waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** The toolbar over every running application (template-demo/toolbar spec). */

const require = createRequire(import.meta.url);
const toolbar = (page: Page) => page.getByRole("complementary", { name: "Demo toolbar" });

async function auditToolbar(page: Page) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
    const result = await axe.run({ include: [["[data-demo-toolbar]"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
    return result.violations.map((violation) => violation.id);
  });
}

test.beforeEach(async ({ page, db: _db }) => {
  await page.goto("/run/ref-payments-workspace");
  await waitForRegions(page);
});

test("floats at the bottom center with six tools and the Demo label", async ({ page }) => {
  const bar = toolbar(page);
  await expect(bar).toBeVisible();
  for (const name of ["Open comments", "Open microfrontends", "Open accessibility audit", "Open timing", "Open settings", "Open sharing"]) await expect(bar.getByRole("button", { name })).toBeVisible();
  await expect(bar.getByText("Demo", { exact: true })).toBeVisible();
  await expect(bar).toHaveAccessibleDescription("This is a demonstration. Builds and deployments are simulated.");

  const box = (await bar.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(viewport.height - (box.y + box.height)).toBeLessThan(40);
});

test("stays collapsed to a handle after a reload until it is shown again", async ({ page }) => {
  await toolbar(page).getByRole("button", { name: "Collapse toolbar" }).click();
  await expect(toolbar(page)).toBeHidden();
  const handle = page.getByRole("button", { name: "Show toolbar" });
  await expect(handle).toBeVisible();
  await page.reload();
  await expect(handle).toBeVisible();
  await expect(toolbar(page)).toBeHidden();
  await handle.click();
  await expect(toolbar(page)).toBeVisible();
});

test("opens a tool panel by its shortcut, with focus inside, and closes it with Escape", async ({ page }) => {
  await page.keyboard.press("s");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // Opened from its button, a panel returns focus to that button.
  const button = toolbar(page).getByRole("button", { name: "Open timing" });
  await button.click();
  await expect(page.getByRole("dialog", { name: "Timing" })).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
});

test("toggles the toolbar with its shortcut and lists every shortcut", async ({ page }) => {
  await page.keyboard.press(".");
  await expect(toolbar(page)).toBeHidden();
  await page.keyboard.press(".");
  await expect(toolbar(page)).toBeVisible();
  await page.keyboard.press("?");
  const reference = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  for (const action of ["Start or stop comment mode", "Open microfrontends", "Open accessibility audit", "Open timing", "Open settings", "Open sharing", "Collapse or show the toolbar"]) await expect(reference).toContainText(action);
});

test("ignores a shortcut letter typed into a field", async ({ page }) => {
  const amount = page.locator('[data-demo-mfe="transfer-form"]').getByLabel("Amount (USD)");
  await amount.click();
  await page.keyboard.type("cs");
  await expect(amount).toHaveValue("cs");
  await expect(toolbar(page).getByRole("button", { name: "Open comments" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("turns single-key shortcuts off, leaving Escape working", async ({ page }) => {
  await toolbar(page).getByRole("button", { name: "Show keyboard shortcuts" }).click();
  await page.getByLabel("Use single-key shortcuts").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("s");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
  await page.reload();
  await page.keyboard.press("s");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
});

for (const theme of ["light", "dark"] as const) {
  test(`has no accessibility violations in the ${theme} operator theme`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    await page.reload();
    await waitForRegions(page);
    expect(await auditToolbar(page)).toEqual([]);
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    expect(await auditToolbar(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await toolbar(page).getByRole("button", { name: "Collapse toolbar" }).click();
    expect(await auditToolbar(page)).toEqual([]);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`keeps the Accessibility, Timing, and Settings panels free of violations in the ${theme} operator theme`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    await page.reload();
    await waitForRegions(page);
    await page.locator('[data-demo-mfe="payment-activity"]').getByRole("button", { name: "Recalculate totals" }).click();

    await toolbar(page).getByRole("button", { name: "Open accessibility audit" }).click();
    await page.getByRole("dialog", { name: "Accessibility" }).getByRole("button", { name: "Run audit" }).click();
    await expect(page.locator("[data-audit-result]").first()).toBeVisible();
    expect(await auditToolbar(page)).toEqual([]);

    await toolbar(page).getByRole("button", { name: "Open timing" }).click();
    await page.getByRole("dialog", { name: "Timing" }).getByRole("checkbox", { name: /^Hot spots/ }).check();
    await expect(page.locator("[data-interaction-member]").first()).toBeVisible();
    expect(await auditToolbar(page)).toEqual([]);

    await toolbar(page).getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(await auditToolbar(page)).toEqual([]);
  });
}
