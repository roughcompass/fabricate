import type { Page } from "@playwright/test";
import { waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** The toolbar's Accessibility, Timing, and Settings tools (template-demo/toolbar spec). */

const region = (page: Page, member: string) => page.locator(`[data-demo-mfe="${member}"]`);
const panel = (page: Page, name: string) => page.getByRole("dialog", { name });

async function open(page: Page, slug: string) {
  await page.goto(`/run/ref-${slug}`);
  await waitForRegions(page);
}

async function openTool(page: Page, button: string, name: string) {
  await page.getByRole("button", { name: button }).click();
  await expect(panel(page, name)).toBeVisible();
}

async function swapPayeeList(page: Page, version: string) {
  await openTool(page, "Open microfrontends", "Microfrontends");
  await panel(page, "Microfrontends").locator('[data-member="payee-list"]').click();
  await panel(page, "Microfrontends").getByRole("radio", { name: new RegExp(`^${version.replaceAll(".", "\\.")}`) }).check();
  await panel(page, "Microfrontends").getByRole("button", { name: "Reload preview" }).click();
  await expect(region(page, "payee-list")).toHaveAttribute("data-demo-version", version);
  await waitForRegions(page);
}

test.describe("accessibility tool", () => {
  test("audits, swaps to the fixed version, and re-audits clean", async ({ page, db: _db }) => {
    await open(page, "payments-workspace");
    await openTool(page, "Open accessibility audit", "Accessibility");
    const audit = panel(page, "Accessibility");
    await audit.getByRole("button", { name: "Run audit" }).click();
    await expect(audit.getByRole("status")).toContainText("have violations");

    const results = audit.getByRole("list", { name: "Violations" }).locator("[data-audit-result]");
    expect((await results.evaluateAll((items) => items.map((item) => item.getAttribute("data-rule")))).sort()).toEqual(["button-name", "color-contrast", "label"]);
    await expect(audit.getByRole("button", { name: /Form elements must have labels/ })).toBeVisible();
    // Every affected element belongs to the payee list's defective version.
    const attributions = await audit.locator("[data-audit-node]").evaluateAll((items) => [...new Set(items.map((item) => item.firstElementChild?.textContent))]);
    expect(attributions).toEqual(["Payee list 1.4.2"]);
    const totals = audit.getByRole("definition");
    expect(Number(await totals.nth(0).textContent()) + Number(await totals.nth(1).textContent())).toBeGreaterThan(0);
    // The page is outlined, numbered by result.
    await expect(page.locator("[data-audit-outline]").first()).toBeVisible();

    await swapPayeeList(page, "2.0.0");
    await openTool(page, "Open accessibility audit", "Accessibility");
    await expect(audit.locator("[data-audit-stale]")).toContainText("may be out of date");
    await audit.getByRole("button", { name: "Run audit again" }).click();
    await expect(audit.getByRole("status")).toHaveText("No violations found.");
    await expect(audit.locator("[data-audit-result]")).toHaveCount(0);
    await expect(audit.locator("[data-audit-stale]")).toHaveCount(0);
    await expect(page.locator("[data-audit-outline]")).toHaveCount(0);
  });

  test("locates a violation on the page and hides outlines without losing results", async ({ page, db: _db }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await open(page, "payments-workspace");
    await openTool(page, "Open accessibility audit", "Accessibility");
    const audit = panel(page, "Accessibility");
    await audit.getByRole("button", { name: "Run audit" }).click();
    const result = audit.locator('[data-rule="label"]');
    await expect(result).toBeVisible();
    const number = await result.getAttribute("data-audit-result");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('[data-demo-anchor="payee-search"]')).not.toBeInViewport();
    await result.getByRole("button").click();
    await expect(page.locator('[data-demo-anchor="payee-search"]')).toBeInViewport();
    const outline = page.locator(`[data-audit-outline="${number}"]`);
    await expect(outline).toHaveAttribute("data-highlighted", "true");
    await expect(outline).toHaveText(number!);

    await audit.getByLabel("Show outlines on the page").uncheck();
    await expect(page.locator("[data-audit-outline]")).toHaveCount(0);
    await expect(result).toBeVisible();
    await audit.getByLabel("Show outlines on the page").check();
    await expect(outline).toBeVisible();
  });
});

test.describe("timing tool", () => {
  test("shows the load waterfall in scripted order with the slow member flagged", async ({ page, db: _db }) => {
    await open(page, "payments-workspace");
    await openTool(page, "Open timing", "Timing");
    const loads = panel(page, "Timing").getByRole("list", { name: "Microfrontend loads" }).locator("[data-load-member]");
    expect(await loads.evaluateAll((items) => items.map((item) => item.getAttribute("data-load-member")))).toEqual(["payments-shell", "payee-list", "transfer-form", "payment-activity"]);
    await expect(loads.and(page.locator("[data-slowest]"))).toHaveAttribute("data-load-member", "payment-activity");
    await expect(loads.nth(3)).toContainText("Slowest load");
  });

  test("rates the planted interaction poor, attributes it, and ranks its region first", async ({ page, db: _db }) => {
    await open(page, "payments-workspace");
    await region(page, "payment-activity").getByRole("button", { name: "Recalculate totals" }).click();
    await openTool(page, "Open timing", "Timing");
    const timing = panel(page, "Timing");
    const interaction = timing.getByRole("list", { name: "Recorded interactions" }).locator('[data-interaction-member="payment-activity"]').first();
    await expect(interaction).toHaveAttribute("data-rating", "poor");
    await expect(interaction).toContainText('button "Recalculate totals"');
    await expect(interaction).toContainText("Payment activity");
    await expect(timing.locator("[data-slowest-interaction]")).toContainText("Poor");
    await expect(timing.locator("[data-slowest-interaction]")).toContainText("Payment activity");

    await timing.getByRole("checkbox", { name: /^Hot spots/ }).check();
    await expect(timing.getByRole("list", { name: "Costliest regions" }).locator("[data-hot-spot]").first()).toHaveAttribute("data-hot-spot", "payment-activity");
    await expect(page.locator('[data-hot-spot-tint="payment-activity"]')).toHaveAttribute("data-level", "high");
    // Interactions with the toolbar are never recorded.
    expect(await timing.locator("[data-interaction-member]").count()).toBe(1);
  });
});

test.describe("timing tool without Event Timing", () => {
  test("falls back to an approximate measure with a visible label", async ({ page, db: _db }) => {
    await page.addInitScript(() => {
      const types = PerformanceObserver.supportedEntryTypes.filter((type) => type !== "event");
      Object.defineProperty(PerformanceObserver, "supportedEntryTypes", { get: () => types });
    });
    await open(page, "payments-workspace");
    await region(page, "payment-activity").getByRole("button", { name: "Recalculate totals" }).click();
    await openTool(page, "Open timing", "Timing");
    const timing = panel(page, "Timing");
    await expect(timing).toContainText("Approximate: this browser does not support the Event Timing API");
    const interaction = timing.locator('[data-interaction-member="payment-activity"]').first();
    await expect(interaction).toHaveAttribute("data-rating", "poor");
    await expect(interaction).toContainText("≈");
  });
});

test.describe("settings tool", () => {
  test("switches to the dark theme without reloading the page", async ({ page, db: _db }) => {
    await open(page, "payments-workspace");
    await page.evaluate(() => ((window as unknown as { __marker: boolean }).__marker = true));
    await openTool(page, "Open settings", "Settings");
    await panel(page, "Settings").getByRole("radio", { name: "Dark" }).check();
    await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker)).toBe(true);
    await page.reload();
    await waitForRegions(page);
    await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-theme", "dark");
  });

  test("reveals Approve actions for the Approver role", async ({ page, db: _db }) => {
    await open(page, "payments-workspace");
    await expect(region(page, "payment-activity").getByRole("button", { name: /^Approve / })).toHaveCount(0);
    await openTool(page, "Open settings", "Settings");
    await panel(page, "Settings").getByRole("radio", { name: "Sam Rivera · Approver" }).check();
    await expect(region(page, "payment-activity").getByRole("button", { name: "Approve PMT-3302" })).toBeVisible();
    await expect(page.locator("[data-demo-portal]")).toContainText("Approver · New York");
  });

  test("publishes a message that the price chart receives, and logs it", async ({ page, db: _db }) => {
    await open(page, "market-watch");
    // Move the chart off ACME first, so publishing ACME visibly changes it.
    await region(page, "watchlist").locator('[data-demo-anchor="chart-GLBX"]').click();
    await expect(region(page, "price-chart")).toContainText("Price chart · GLBX");

    await openTool(page, "Open settings", "Settings");
    const settings = panel(page, "Settings");
    await settings.getByLabel("Topic", { exact: true }).selectOption("instrument:selected");
    await settings.getByLabel("Payload").fill('{"symbol": "ACME"}');
    await settings.getByRole("button", { name: "Publish message" }).click();
    await expect(region(page, "price-chart")).toContainText("Price chart · ACME");
    const logged = settings.getByRole("list", { name: "Event bus messages" }).locator('[data-bus-publisher="toolbar"]');
    await expect(logged).toHaveAttribute("data-bus-topic", "instrument:selected");
    await expect(logged).toContainText('{"symbol":"ACME"}');
    await expect(logged).toContainText("From Toolbar to");
    await expect(logged).toContainText("Price chart");
    // The watchlist's own message is in the log too, and the filter narrows it.
    await expect(settings.locator('[data-bus-publisher="watchlist"]')).toHaveCount(1);
  });

  test("rejects a payload that is not valid JSON", async ({ page, db: _db }) => {
    await open(page, "market-watch");
    await openTool(page, "Open settings", "Settings");
    const settings = panel(page, "Settings");
    await settings.getByLabel("Payload").fill("{symbol: ACME}");
    await settings.getByRole("button", { name: "Publish message" }).click();
    await expect(settings.getByLabel("Payload")).toHaveAccessibleDescription('The payload must be valid JSON, such as {"symbol": "ACME"}.');
    await expect(settings.locator("[data-bus-publisher]")).toHaveCount(0);
  });
});
