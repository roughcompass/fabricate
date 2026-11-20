import type { Page } from "@playwright/test";
import { E2E_PREVIEWS } from "./support/env";
import type { FixtureApplication } from "./support/fixture-app";
import { expect, test } from "./support/fixtures";
import { buildQuotes } from "./support/quotes-fixtures";
import { application, runOrdersPortal, waitForPage } from "./support/running-app";
import { framedRun } from "./support/fixture-app";
import { openTool } from "./support/toolbar";

/*
 * The Settings tool (restore-toolbar-tools-and-branch-previews, tasks 11.2
 * and 11.3; template-demo/runtime-settings spec): Salt's theme switch on
 * Quotes panel and Quotes desk, which render Salt providers, and not on
 * Orders portal, and the event bus log of Quotes desk's window events and
 * single-spa's routing, with Send an event.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(120_000);

const settings = (page: Page) => page.getByRole("dialog", { name: "Settings" });
const log = (page: Page) => settings(page).getByRole("list", { name: "Event bus entries" }).getByRole("listitem");

/** Opens +build+ running under the toolbar at +route+, once its page shows +heading+. */
async function run(page: Page, build: FixtureApplication, heading: string, route = "/") {
  await page.goto(framedRun(build, route));
  await waitForPage(page, heading);
}

/** Every Salt provider element in the frame, with its mode and density. */
const providers = (page: Page) =>
  application(page)
    .locator(":root")
    .evaluate(() => [...document.querySelectorAll(".salt-theme, .salt-theme-next")].map((element) => `${element.tagName.toLowerCase()} ${element.getAttribute("data-mode")} ${[...element.classList].find((name) => name.startsWith("salt-density-"))}`));

/** The page's container background, which Salt's mode decides. */
const background = (page: Page) => application(page).locator(":root").evaluate((root) => getComputedStyle(root).getPropertyValue("--salt-container-primary-background").trim());

test.describe("theme", () => {
  test("Dark applies without a reload, nested provider included; it survives a reload; and the application's own restores it", async ({ page, db }) => {
    const { panel } = await buildQuotes(db);
    await run(page, panel, "Quotes panel");
    // The remote's own page renders its root provider and the exposed module's nested one.
    expect(await providers(page)).toEqual(["html light salt-density-medium", "div light salt-density-medium"]);
    const light = await background(page);

    await openTool(page, "settings");
    await expect(settings(page).getByRole("group", { name: "Mode" }).getByLabel("Application's own")).toBeChecked();
    await expect(settings(page).getByRole("group", { name: "Density" }).getByLabel("Application's own")).toBeChecked();
    await expect(settings(page).locator("[data-theme-limits]")).toHaveText("The switch changes Salt's styles only. Code that reads the theme from JavaScript, the application's own theme setting, and anything Salt doesn't style keep the application's choice.");
    // Next-theme settings are offered only for Salt's next theme.
    await expect(settings(page).getByRole("group", { name: "Accent" })).toHaveCount(0);

    const navigations: string[] = [];
    page.on("framenavigated", (frame) => navigations.push(frame.url()));
    await settings(page).getByRole("group", { name: "Mode" }).getByLabel("Dark").check();
    await settings(page).getByRole("group", { name: "Density" }).getByLabel("High").check();
    await expect.poll(() => providers(page)).toEqual(["html dark salt-density-high", "div dark salt-density-high"]);
    expect(await background(page)).not.toBe(light);
    expect(navigations, "no reload").toEqual([]);

    // The application renders its provider again: the choice stays.
    await application(page).locator(":root").evaluate((root) => root.setAttribute("data-mode", "light"));
    await expect.poll(() => providers(page)).toEqual(["html dark salt-density-high", "div dark salt-density-high"]);

    await page.reload();
    await waitForPage(page, "Quotes panel");
    await expect.poll(() => providers(page)).toEqual(["html dark salt-density-high", "div dark salt-density-high"]);
    await openTool(page, "settings");
    await expect(settings(page).getByRole("group", { name: "Mode" }).getByLabel("Dark")).toBeChecked();

    await settings(page).getByRole("group", { name: "Mode" }).getByLabel("Application's own").check();
    await settings(page).getByRole("group", { name: "Density" }).getByLabel("Application's own").check();
    await expect.poll(() => providers(page)).toEqual(["html light salt-density-medium", "div light salt-density-medium"]);
  });

  test("isn't offered for Orders portal, whose Profile shows no Salt provider", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    await openTool(page, "settings");
    await expect(settings(page).locator("[data-theme-unavailable]")).toHaveText("The theme switch needs a Salt provider, which Orders portal's Profile doesn't show.");
    await expect(settings(page).getByRole("group", { name: "Mode" })).toHaveCount(0);
  });
});

test.describe("event bus", () => {
  test("logs quotes:selected from the application and single-spa's routing events, and filters by name", async ({ page, db }) => {
    const { desk } = await buildQuotes(db);
    await run(page, desk, "Quotes desk");
    await application(page).getByRole("button", { name: "ACME" }).click();
    await expect(application(page).getByText("Selected: ACME")).toBeVisible();
    await openTool(page, "settings");
    const newest = log(page).first();
    await expect(newest).toHaveAttribute("data-bus-name", "quotes:selected");
    await expect(newest).toHaveAttribute("data-bus-kind", "window");
    await expect(newest).toHaveAttribute("data-bus-from", "application");
    await expect(newest).toContainText("Window event quotes:selected");
    await expect(newest).toContainText('{"symbol":"ACME"}');
    await expect(newest).toContainText(/\+\d+\.\d\d s/);
    await expect(newest).toContainText("From the application");

    // Single-spa's routing events, with the applications whose status changed.
    await expect(settings(page).locator("[data-bus-name='single-spa:routing-event']").first()).toBeVisible();
    await expect(settings(page).locator("[data-bus-name='single-spa:app-change'], [data-bus-name='single-spa:no-app-change']").first()).toContainText("@fixtures/quotes-panel");

    await settings(page).getByLabel("Filter by name").selectOption("quotes:selected");
    await expect(log(page)).toHaveCount(1);
    await expect(log(page).first()).toHaveAttribute("data-bus-name", "quotes:selected");
    await expect(settings(page)).toContainText("buses kept in JavaScript objects");
  });

  test("sends quotes:selected and the page shows EURUSD, refusing invalid JSON and a missing name first", async ({ page, db }) => {
    const { desk } = await buildQuotes(db);
    await run(page, desk, "Quotes desk");
    await openTool(page, "settings");
    const form = settings(page).locator("form").filter({ has: page.getByRole("heading", { name: "Send an event" }) });
    await expect(form.getByLabel("Send as")).toHaveValue("window");
    await expect(form.getByLabel("Detail")).toHaveValue("{}");

    await form.getByRole("button", { name: "Send event" }).click();
    await expect(form.getByLabel("Event name")).toBeFocused();
    await expect(form).toContainText("Enter an event name, such as quotes:selected.");

    await form.getByLabel("Event name").fill("quotes:selected");
    await form.getByLabel("Detail").fill("{symbol: EURUSD}");
    await form.getByRole("button", { name: "Send event" }).click();
    await expect(form).toContainText('The detail must be JSON, such as {"symbol": "EURUSD"}.');
    await expect(application(page).getByText("Selected: none")).toBeVisible();

    await form.getByLabel("Detail").fill('{"symbol":"EURUSD"}');
    await form.getByRole("button", { name: "Send event" }).click();
    await expect(application(page).getByText("Selected: EURUSD")).toBeVisible();
    const newest = log(page).first();
    await expect(newest).toHaveAttribute("data-bus-name", "quotes:selected");
    await expect(newest).toHaveAttribute("data-bus-from", "toolbar");
    await expect(newest).toContainText("Sent by the toolbar");

    // A message to the page needs no name.
    await form.getByLabel("Send as").selectOption("message");
    await expect(form.getByLabel("Event name")).toHaveCount(0);
    await form.getByLabel("Detail").fill('{"hello":"desk"}');
    await form.getByRole("button", { name: "Send event" }).click();
    await expect(log(page).first()).toHaveAttribute("data-bus-kind", "message");
    await expect(log(page).first()).toContainText('{"hello":"desk"}');
    await expect(log(page).first()).toHaveAttribute("data-bus-from", "toolbar");
  });

  test("the log starts over when the frame reloads, and keeps through a route change", async ({ page, db }) => {
    const { desk } = await buildQuotes(db);
    await run(page, desk, "Quotes desk");
    await application(page).getByRole("button", { name: "GLOBEX" }).click();
    await application(page).getByRole("link", { name: "Blotter" }).click();
    await expect(application(page).getByRole("heading", { name: "Blotter", level: 1 })).toBeVisible();
    await openTool(page, "settings");
    await expect(settings(page).locator("[data-bus-name='quotes:selected']")).toHaveCount(1);
    await page.keyboard.press("Escape");

    await application(page).locator(":root").evaluate(() => window.location.reload());
    await expect(application(page).getByRole("heading", { name: "Blotter", level: 1 })).toBeVisible();
    await openTool(page, "settings");
    await expect(settings(page).locator("[data-bus-name='quotes:desk-starting']")).toHaveCount(1);
    await expect(settings(page).locator("[data-bus-name='quotes:selected']")).toHaveCount(0);
    await settings(page).getByRole("button", { name: "Clear log" }).click();
    await expect(log(page)).toHaveCount(0);
  });
});
