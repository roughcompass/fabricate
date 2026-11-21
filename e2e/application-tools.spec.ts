import type { Page } from "@playwright/test";
import { expectToolbarOnTop, openTool } from "./support/toolbar";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { application, runOrdersPortal, waitForPage } from "./support/running-app";

/*
 * The toolbar's Accessibility and Timing tools over a running application
 * (add-applications, tasks 8.3 and 8.4; template-demo/toolbar spec), on the
 * fixture application built through the preview pipeline and framed by the
 * test run page until /run/<application> exists.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(90_000);

const panel = (page: Page, name: string) => page.getByRole("dialog", { name });

async function openPanel(page: Page, id: string, name: string) {
  await openTool(page, id);
  await expect(panel(page, name)).toBeVisible();
}

test.describe("accessibility tool", () => {
  test("reports the unlabeled field by selector and route, is stale after navigating, and audits the new route again", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    await openPanel(page, "accessibility", "Accessibility");
    const audit = panel(page, "Accessibility");
    await audit.getByRole("button", { name: "Run audit" }).click();
    await expect(audit.getByRole("status")).toHaveText("1 element has violations.");

    const results = audit.getByRole("list", { name: "Violations" }).locator("[data-audit-result]");
    expect(await results.evaluateAll((items) => items.map((item) => item.getAttribute("data-rule")))).toEqual(["label"]);
    await expect(audit.getByRole("button", { name: /Form elements must have labels/ })).toBeVisible();
    // The element is named by its selector in the application's page, and the route it was found on.
    const node = audit.locator("[data-audit-node]");
    await expect(node).toHaveAttribute("data-route", "/accounts");
    await expect(node).toContainText("on /accounts");
    const selector = (await node.getAttribute("data-selector"))!;
    await expect(application(page).locator(selector)).toHaveAttribute("type", "search");
    // The field is outlined over the frame, numbered by result.
    const outline = page.locator('[data-audit-outline="1"]');
    await expect(outline).toBeVisible();
    const field = (await application(page).locator(selector).boundingBox())!;
    const drawn = (await outline.boundingBox())!;
    expect(Math.abs(drawn.x - field.x)).toBeLessThan(2);
    expect(Math.abs(drawn.y - field.y)).toBeLessThan(2);

    // Navigating inside the application marks the results stale and takes their outlines away.
    await page.keyboard.press("Escape");
    await application(page).getByRole("link", { name: "Settings" }).click();
    await waitForPage(page, "Settings");
    await expect(page.locator("[data-audit-outline]")).toHaveCount(0);
    await openPanel(page, "accessibility", "Accessibility");
    await expect(audit.locator("[data-audit-stale]")).toContainText("may be out of date");
    await audit.getByRole("button", { name: "Run audit again" }).click();
    await expect(audit.getByRole("status")).toHaveText("No violations found.");
    await expect(audit.locator("[data-audit-result]")).toHaveCount(0);
    await expect(audit.locator("[data-audit-stale]")).toHaveCount(0);
  });

  test("locates a violation in the application's page and hides outlines without losing results", async ({ page, db }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await runOrdersPortal(page, db, "/accounts/42");
    await openPanel(page, "accessibility", "Accessibility");
    const audit = panel(page, "Accessibility");
    await audit.getByRole("button", { name: "Run audit" }).click();
    const result = audit.locator('[data-rule="label"]');
    await expect(result).toBeVisible();
    const field = application(page).getByRole("searchbox");

    await application(page).locator("body").evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(field).not.toBeInViewport();
    await result.getByRole("button").click();
    await expect(field).toBeInViewport();
    const outline = page.locator('[data-audit-outline="1"]');
    await expect(outline).toHaveAttribute("data-highlighted", "true");
    await expect(outline).toHaveText("1");

    await audit.getByLabel("Show outlines on the page").uncheck();
    await expect(page.locator("[data-audit-outline]")).toHaveCount(0);
    await expect(result).toBeVisible();
    await audit.getByLabel("Show outlines on the page").check();
    await expect(outline).toBeVisible();
  });
});

test.describe("timing tool", () => {
  test("lists the entry script and stylesheet, then the lazily loaded chunk, in start order with the slowest flagged", async ({ page, db }) => {
    const { preview } = await runOrdersPortal(page, db);
    await openPanel(page, "timing", "Timing");
    const loads = panel(page, "Timing").getByRole("list", { name: "Loaded files" }).locator("[data-load-file]");
    // The entry script and stylesheet, and the script of the rates worker the Accounts page starts (add-mock-sets, task 1.1).
    await expect(loads).toHaveCount(3);
    const files = () => loads.evaluateAll((items) => items.map((item) => [item.getAttribute("data-load-file"), item.getAttribute("data-load-kind")]));
    expect((await files()).map(([, kind]) => kind).sort()).toEqual(["Script", "Script", "Stylesheet"]);
    expect((await files()).every(([file]) => /^assets\/(index|rates-worker)-[\w-]+\.(js|css)$/.test(file!))).toBe(true);
    // The inspector the toolbar adds isn't one of the application's loads.
    await expect(loads.filter({ hasText: "inspector" })).toHaveCount(0);
    await expect(loads.and(page.locator("[data-slowest]"))).toHaveCount(1);
    await expect(loads.first()).toContainText(/\+\d[\d,]* ms · \d[\d,]* ms/);

    // Settings loads its own chunk on the first visit, listed after the others.
    await page.keyboard.press("Escape");
    await application(page).getByRole("link", { name: "Settings" }).click();
    await waitForPage(page, "Settings");
    await openPanel(page, "timing", "Timing");
    await expect(loads).toHaveCount(4);
    await expect(loads.last()).toHaveAttribute("data-load-file", /^assets\/settings-[\w-]+\.js$/);
    await expect(loads.last()).toHaveAttribute("data-load-kind", "Script");
    expect(preview.publicId).toMatch(/^pvw_/);
  });

  test("reports the page load's Web Vitals, with INP from the application's interactions only", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    await openPanel(page, "timing", "Timing");
    const vitals = panel(page, "Timing").getByRole("list", { name: "Web Vitals" });
    for (const name of ["LCP", "FCP", "TTFB"]) await expect(vitals.locator(`[data-vital="${name}"]`)).toHaveAttribute("data-rating", /^(good|needs-improvement|poor)$/);
    await expect(vitals.locator('[data-vital="INP"]')).toContainText("No interactions");
    // Each vital explains itself in a tooltip on keyboard focus.
    await vitals.locator('[data-vital="LCP"] [tabindex="0"]').focus();
    await expect(vitals.getByRole("tooltip", { name: /^Largest Contentful Paint\./ })).toBeVisible();

    await page.getByRole("button", { name: "Close timing" }).click();
    await application(page).getByRole("button", { name: "Recalculate totals" }).click();
    await expect(application(page).getByText("Total balance $38,575")).toBeVisible();
    await openPanel(page, "timing", "Timing");
    await expect(vitals.locator('[data-vital="INP"]')).toHaveAttribute("data-rating", "poor");
    await panel(page, "Timing").getByRole("button", { name: "Clear interactions" }).click();
    // Clearing the list keeps the page's INP.
    await expect(vitals.locator('[data-vital="INP"]')).toHaveAttribute("data-rating", "poor");
    await expect(panel(page, "Timing").getByRole("list", { name: "Recorded interactions" })).toHaveCount(0);
  });

  test("rates the planted slow button poor, naming it and its route", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    await application(page).getByRole("button", { name: "Recalculate totals" }).click();
    await openPanel(page, "timing", "Timing");
    const timing = panel(page, "Timing");
    const interaction = timing.getByRole("list", { name: "Recorded interactions" }).locator("[data-interaction-route]");
    await expect(interaction).toHaveCount(1);
    await expect(interaction).toHaveAttribute("data-rating", "poor");
    await expect(interaction).toHaveAttribute("data-interaction-route", "/accounts");
    await expect(interaction).toContainText('Click on button "Recalculate totals"');
    await expect(interaction).not.toContainText("≈");
    // 650 ms of work before the next paint.
    expect(Number(/([\d,]+) ms/.exec(await interaction.innerText())![1]!.replace(/,/g, ""))).toBeGreaterThanOrEqual(650);
    await expect(timing.locator("[data-slowest-interaction]")).toContainText("Poor");
    await expect(timing.locator("[data-slowest-interaction]")).toContainText('on button "Recalculate totals" at /accounts');
    // Using the toolbar records nothing.
    await timing.getByRole("button", { name: "Back to menu" }).click();
    await page.keyboard.press("Escape");
    await openPanel(page, "timing", "Timing");
    await expect(timing.locator("[data-interaction-route]")).toHaveCount(1);
  });
});

test.describe("keyboard in the application", () => {
  test("records Enter on a button once, and never the toolbar shortcut pressed in the application", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    await application(page).getByRole("button", { name: "Export orders" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("t");
    const timing = panel(page, "Timing");
    await expect(timing).toBeVisible();
    // The shortcut moved focus into the panel.
    await expect(timing.getByRole("button", { name: "Clear interactions" })).toBeVisible();
    expect(await timing.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    const interactions = timing.getByRole("list", { name: "Recorded interactions" }).locator("[data-interaction-route]");
    await expect(interactions).toHaveCount(1);
    await expect(interactions.first()).toContainText('Key press on button "Export orders"');
  });

  test("types a shortcut's letter into the application's field without starting comment mode", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    const field = application(page).getByRole("searchbox");
    await field.click();
    await page.keyboard.type("ac");
    await expect(field).toHaveValue("ac");
    await expect(page.getByText("Choose any element to comment on it. Press Esc to cancel.")).toHaveCount(0);
    await expect(panel(page, "Accessibility")).toHaveCount(0);
    // Out of the field, the same key is the shortcut.
    await application(page).getByRole("heading", { name: "Accounts" }).click();
    await page.keyboard.press("c");
    await expect(page.getByText("Choose any element to comment on it. Press Esc to cancel.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Choose any element to comment on it. Press Esc to cancel.")).toHaveCount(0);
  });
});

test.describe("isolation from the application", () => {
  test("audits only the application, stays above its Feedback tab at the right edge, and keeps its own look", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    // Nothing the audit reports is the toolbar's: every element is in the application's page.
    await openPanel(page, "accessibility", "Accessibility");
    await panel(page, "Accessibility").getByRole("button", { name: "Run audit" }).click();
    await expect(panel(page, "Accessibility").locator("[data-audit-node]")).toHaveCount(1);
    const selector = (await panel(page, "Accessibility").locator("[data-audit-node]").getAttribute("data-selector"))!;
    await expect(application(page).locator(selector)).toHaveAttribute("type", "search");
    await page.keyboard.press("Escape");

    // The application's tab sits under the pill, at the highest stacking order, and its stylesheet turns every button red.
    const feedback = (await application(page).getByRole("button", { name: "Feedback" }).boundingBox())!;
    const pill = (await page.getByRole("complementary", { name: "Toolbar", exact: true }).boundingBox())!;
    expect(feedback.x + feedback.width).toBeGreaterThan(pill.x);
    expect(feedback.y).toBeLessThan(pill.y + pill.height);
    await application(page).locator("head").evaluate((head) => head.insertAdjacentHTML("beforeend", "<style>button { background: rgb(255, 0, 0) !important; }</style>"));
    await expect(application(page).getByRole("button", { name: "Feedback" })).toHaveCSS("background-color", "rgb(255, 0, 0)");
    const menu = page.getByRole("button", { name: /^Open toolbar menu/ });
    await expect(menu).not.toHaveCSS("background-color", "rgb(255, 0, 0)");
    await expectToolbarOnTop(page);
    await menu.click();
    await expect(page.getByRole("dialog", { name: "Toolbar", exact: true })).toBeVisible();
  });
});

test.describe("timing tool without Event Timing", () => {
  test("falls back to an approximate measure with a visible label", async ({ page, db }) => {
    // Init scripts run in every frame, so the application's page lacks Event Timing too.
    await page.addInitScript(() => {
      const types = PerformanceObserver.supportedEntryTypes.filter((type) => type !== "event");
      Object.defineProperty(PerformanceObserver, "supportedEntryTypes", { get: () => types });
    });
    await runOrdersPortal(page, db);
    await application(page).getByRole("button", { name: "Recalculate totals" }).click();
    await openPanel(page, "timing", "Timing");
    const timing = panel(page, "Timing");
    await expect(timing).toContainText("Approximate: this browser does not support the Event Timing API");
    const interaction = timing.locator("[data-interaction-route]").first();
    await expect(interaction).toHaveAttribute("data-rating", "poor");
    await expect(interaction).toContainText("≈");
  });
});
