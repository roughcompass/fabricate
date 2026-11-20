import type { Page } from "@playwright/test";
import { createSavedPreview } from "../src/lib/applications/pipeline";
import { routes } from "../src/lib/web/routes";
import { E2E_PREVIEWS } from "./support/env";
import { framedRun, settle } from "./support/fixture-app";
import { expect, test } from "./support/fixtures";
import { QUOTES_PANEL_REMOTE, buildQuotes } from "./support/quotes-fixtures";
import { commitToRemote } from "./support/fixture-app";
import { serverConfig } from "./support/results";
import { application, runOrdersPortal, waitForPage } from "./support/running-app";
import { openTool } from "./support/toolbar";

/*
 * The Microfrontends tool (restore-toolbar-tools-and-branch-previews, tasks
 * 9.3, 9.4, and 9.6; template-demo/microfrontends spec) on Quotes desk,
 * whose remote quotesPanel and import-map entry @fixtures/quotes-panel point
 * where nothing listens as built, and which Quotes panel's builds route to.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(150_000);

const panel = (page: Page) => page.getByRole("dialog", { name: "Microfrontends" });
const member = (page: Page, name: string) => panel(page).locator(`[data-member="${name}"]`);
const version = (page: Page) => panel(page).getByRole("group", { name: "Version" });

/** Quotes desk and Quotes panel, with their feature branches saved, and Quotes desk running at +route+ with Microfrontends open. */
async function openDesk(page: Page, db: Parameters<typeof buildQuotes>[0], route = "/") {
  const quotes = await buildQuotes(db);
  await page.goto(framedRun(quotes.desk, route));
  await waitForPage(page, route === "/blotter" ? "Blotter" : "Quotes desk");
  await openTool(page, "microfrontends");
  await expect(member(page, "quotesPanel")).toBeVisible();
  return quotes;
}

/** Chooses +label+ for +name+ in the Version choice. */
async function route(page: Page, name: string, label: RegExp) {
  await member(page, name).click();
  await version(page).getByRole("radio", { name: label }).check();
}

test("lists Quotes desk's composition, each with its address and state, and offers versions, not environments", async ({ page, db }) => {
  const { panel: quotesPanel, blueQuotes } = await openDesk(page, db);
  await expect(panel(page)).toContainText("Quotes desk · 2 microfrontends");
  const remote = member(page, "quotesPanel");
  await expect(remote).toContainText("Module Federation remote");
  await expect(remote).toContainText("http://127.0.0.1:9311/remoteEntry.js");
  // As built, its address fails: nothing listens there.
  await expect(remote).toHaveAttribute("data-member-state", "failed");
  await expect(remote).toContainText("Failed to load");
  const ticker = member(page, "@fixtures/quotes-panel");
  await expect(ticker).toContainText("Import-map entry");
  await expect(ticker).toContainText("http://127.0.0.1:9312/ticker.js");
  await expect(ticker).toHaveAttribute("data-member-state", "failed");

  await remote.click();
  const radios = version(page).getByRole("radio");
  await expect(radios).toHaveCount(3);
  await expect(version(page).getByRole("radio", { name: /^As built/ })).toBeChecked();
  await expect(version(page)).toContainText(`Quotes panel · main${quotesPanel.application.current!.commitSha.slice(0, 12)}`);
  await expect(version(page)).toContainText(`Quotes panel · feature/blue-quotes${blueQuotes!.current!.commitSha.slice(0, 12)}`);
  await expect(panel(page).getByRole("group", { name: "Environment" })).toHaveCount(0);
  // Nothing lets an operator type an address of their own.
  await expect(version(page).getByRole("textbox")).toHaveCount(0);
  await expect(panel(page).locator("[data-no-region]")).toHaveText("Module Federation modules have no region of their own on the page, so quotesPanel can't be outlined or selected on it.");
});

test("routes quotesPanel to feature/blue-quotes, two pending changes reload together, and routing survives a reload", async ({ page, db }) => {
  await openDesk(page, db);
  await route(page, "quotesPanel", /feature\/blue-quotes/);
  await expect(member(page, "quotesPanel")).toContainText("Pending");
  await expect(panel(page).getByRole("button", { name: "Reload application", exact: true })).toBeEnabled();
  await route(page, "@fixtures/quotes-panel", /feature\/blue-quotes/);
  await expect(panel(page).getByRole("button", { name: "Reload application (2 changes)" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Reload application (2 changes)" }).click();

  // The frame reloads at the same route, with the remote and the ticker from feature/blue-quotes.
  await expect(application(page).getByRole("heading", { name: "Blue quotes panel", level: 2 })).toBeVisible();
  await expect(application(page).getByRole("complementary", { name: "Ticker" })).toHaveText("Blue ticker: ACME 101.20 · GLOBEX 48.75");
  await expect(application(page).getByRole("heading", { name: "Quotes desk", level: 1 })).toBeVisible();
  await expect(member(page, "quotesPanel")).toHaveAttribute("data-member-state", "routed");
  await expect(member(page, "quotesPanel")).toContainText("Routed to Quotes panel · feature/blue-quotes");
  await expect(member(page, "quotesPanel")).not.toContainText("Pending");

  await page.reload();
  await waitForPage(page, "Quotes desk");
  await expect(application(page).getByRole("heading", { name: "Blue quotes panel", level: 2 })).toBeVisible();
  await expect(application(page).getByRole("complementary", { name: "Ticker" })).toHaveText("Blue ticker: ACME 101.20 · GLOBEX 48.75");
  await openTool(page, "microfrontends");
  await expect(member(page, "quotesPanel")).toHaveAttribute("data-member-state", "routed");
  await expect(member(page, "@fixtures/quotes-panel")).toHaveAttribute("data-member-state", "routed");
});

test("routes the import-map entry alone, on another route, and preview mode isn't routed", async ({ page, db }) => {
  const { desk } = await openDesk(page, db, "/blotter");
  await route(page, "@fixtures/quotes-panel", /Quotes panel · main/);
  await panel(page).getByRole("button", { name: "Reload application", exact: true }).click();
  await expect(application(page).getByRole("complementary", { name: "Ticker" })).toHaveText("Ticker: ACME 101.20 · GLOBEX 48.75");
  await expect(application(page).getByRole("heading", { name: "Blotter", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/run\/quotes-desk\/blotter$/);

  // The same browser's preview mode loads the build as it was built.
  await page.goto(routes.applicationPreview(desk.application.slug));
  const preview = page.frameLocator("[data-preview-frame]");
  await expect(preview.getByRole("heading", { name: "Quotes desk", level: 1 })).toBeVisible();
  await expect(preview.getByText("Quotes unavailable")).toBeVisible();
  await expect(preview.getByRole("complementary", { name: "Ticker" })).toHaveText("Ticker unavailable");
});

test("Reset routing returns every microfrontend to As built and reloads", async ({ page, db }) => {
  await openDesk(page, db);
  await route(page, "quotesPanel", /Quotes panel · main/);
  await panel(page).getByRole("button", { name: "Reload application", exact: true }).click();
  await expect(application(page).getByRole("heading", { name: "Quotes panel", level: 2 })).toBeVisible();
  await panel(page).getByRole("button", { name: "Reset routing" }).click();
  await expect(application(page).getByText("Quotes unavailable")).toBeVisible();
  await expect(member(page, "quotesPanel")).toHaveAttribute("data-member-state", "failed");
  await expect(panel(page).getByRole("button", { name: "Reset routing" })).toBeDisabled();
  // Nothing of the routing is left in the browser.
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("frontend-registry:routing:")))).toEqual([]);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test("refuses a build without the entry's file before reloading, naming the file", async ({ page, db }) => {
  const quotes = await buildQuotes(db);
  // A branch of Quotes panel that ships no ticker.
  commitToRemote(QUOTES_PANEL_REMOTE, { "rspack.config.mjs": (source) => source.replace(/\n\s*new CopyRspackPlugin\([^\n]*\),/, ""), "src/ticker.js": null }, { branch: "feature/no-ticker", message: "No ticker" });
  await createSavedPreview(db, quotes.panel.application.publicId, { ref: "refs/heads/feature/no-ticker" }, { config: serverConfig() });
  await settle(db);
  await page.goto(framedRun(quotes.desk));
  await waitForPage(page, "Quotes desk");
  await openTool(page, "microfrontends");
  await route(page, "@fixtures/quotes-panel", /feature\/no-ticker/);
  await expect(version(page)).toContainText("Quotes panel · feature/no-ticker has no ticker.js, so @fixtures/quotes-panel can't be routed to it.");
  await expect(member(page, "@fixtures/quotes-panel")).not.toContainText("Pending");
  await expect(panel(page).getByRole("button", { name: "Reload application", exact: true })).toBeDisabled();
});

test("Orders portal has no microfrontends, and says what it looked for", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  await openTool(page, "microfrontends");
  await expect(panel(page).locator("[data-no-microfrontends]")).toHaveText("No Module Federation remotes, single-spa applications, or import maps were found in Orders portal's Profile or on the page.");
  await expect(panel(page).getByRole("button", { name: "Select on page" })).toHaveCount(0);
});

test("Quotes panel says it's a remote shown through its own page", async ({ page, db }) => {
  const { panel: quotesPanel } = await buildQuotes(db, { saved: false });
  await page.goto(framedRun(quotesPanel));
  await waitForPage(page, "Quotes panel");
  await openTool(page, "microfrontends");
  await expect(panel(page).locator("[data-own-page]")).toHaveText("Quotes panel is a Module Federation remote shown through its own page.");
});

test.describe("single-spa regions", () => {
  test("outlines the region, labeled with its name and whether it's routed", async ({ page, db }) => {
    await openDesk(page, db);
    await panel(page).getByLabel("Show regions").check();
    const outline = page.locator('[data-region-outline="@fixtures/quotes-panel"]');
    await expect(outline).toHaveText("@fixtures/quotes-panel · As built");
    const region = (await application(page).getByRole("complementary", { name: "Ticker" }).boundingBox())!;
    const box = (await outline.boundingBox())!;
    expect(Math.abs(box.y - region.y)).toBeLessThan(2);

    await route(page, "@fixtures/quotes-panel", /feature\/blue-quotes/);
    await panel(page).getByRole("button", { name: "Reload application", exact: true }).click();
    await expect(application(page).getByRole("complementary", { name: "Ticker" })).toHaveText(/^Blue ticker/);
    await expect(outline).toHaveText("@fixtures/quotes-panel · Routed to feature/blue-quotes");
  });

  test("selects a region by pointer and by keyboard without the application receiving the click, and Escape selects nothing", async ({ page, db }) => {
    await openDesk(page, db);
    await member(page, "quotesPanel").click();
    await application(page)
      .locator(":root")
      .evaluate(() => {
        (window as unknown as { clicks: number }).clicks = 0;
        document.addEventListener("click", () => (window as unknown as { clicks: number }).clicks++);
      });

    await panel(page).getByRole("button", { name: "Select on page" }).click();
    await expect(page.getByText("Select a microfrontend on the page. Press Esc to cancel.")).toBeVisible();
    await expect(panel(page)).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Select a microfrontend on the page. Press Esc to cancel.")).toBeHidden();
    await expect(panel(page)).toBeHidden();

    await openTool(page, "microfrontends");
    await panel(page).getByRole("button", { name: "Select on page" }).click();
    await application(page).getByRole("complementary", { name: "Ticker" }).hover();
    await expect(page.locator('[data-region-outline="@fixtures/quotes-panel"]')).toBeVisible();
    await application(page).getByRole("complementary", { name: "Ticker" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(member(page, "@fixtures/quotes-panel")).toHaveAttribute("aria-pressed", "true");
    expect(await application(page).locator(":root").evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(0);

    // By keyboard: Enter on what has focus in the region.
    await member(page, "quotesPanel").click();
    await panel(page).getByRole("button", { name: "Select on page" }).click();
    await application(page)
      .getByRole("complementary", { name: "Ticker" })
      .evaluate((region) => {
        region.setAttribute("tabindex", "0");
        (region as HTMLElement).focus();
      });
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await expect(member(page, "@fixtures/quotes-panel")).toHaveAttribute("aria-pressed", "true");
  });
});

test("refuses routing beside the application's own service worker", async ({ page, db }) => {
  const { desk } = await buildQuotes(db, { saved: false });
  await page.goto(framedRun(desk));
  await waitForPage(page, "Quotes desk");
  // The application registers a service worker for its own path.
  await application(page)
    .locator(":root")
    .evaluate(async () => {
      await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
    });
  await page.reload();
  await waitForPage(page, "Quotes desk");
  await openTool(page, "microfrontends");
  await expect(panel(page).getByText("Routing can't run beside the application's own service worker for its build's path.")).toBeVisible();
  await member(page, "quotesPanel").click();
  await expect(version(page)).toHaveCount(0);
});
