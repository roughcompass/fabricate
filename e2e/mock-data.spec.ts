import fs from "node:fs";
import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { createDraft, saveDraft } from "../src/lib/mocks/imports";
import { allRules, editRule } from "../src/lib/mocks/records";
import { E2E_PREVIEWS } from "./support/env";
import { buildOrdersPortal, framedRun, ordersPortalRemote, saveOrdersPortalPreview } from "./support/fixture-app";
import { expect, test } from "./support/fixtures";
import { ORDERS_HAPPY_PATH, type SeedRule, mockApplicationId, seedMockSet, setDefault } from "./support/mock-sets";
import { buildQuotes } from "./support/quotes-fixtures";
import { serverConfig } from "./support/results";
import { application, visitorContext, waitForPage, workspaceOf } from "./support/running-app";
import { useTheme } from "./support/shell";
import { auditToolbar, openTool, routeQuotesPanelToBlue } from "./support/toolbar";

/*
 * The Data tool and the view's worker answering a view's API calls
 * (add-mock-sets, tasks 8.2, 8.3, and 10.2 to 10.6; template-demo/mock-data
 * spec) on Orders portal, whose calls to https://api.orders.test fail
 * without mocks, each part of its page saying so. These specs wait for the
 * page's content, never for network idle: an event stream stays open.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(180_000);

const panel = (page: Page) => page.getByRole("dialog", { name: "Data" });
const setChoice = (page: Page) => panel(page).getByRole("group", { name: "Mock set" });
const request = (page: Page, method: string, address: string) => panel(page).locator(`[data-request="${method} ${address}"]`);
const API = "https://api.orders.test/v1";

/** What Orders portal's Accounts page shows of each part that calls the orders API. */
const recentOrders = (page: Page) => application(page).getByRole("region", { name: "Recent orders" });
const liveOrders = (page: Page) => application(page).getByRole("region", { name: "Live orders" });

/** Orders portal built, with "Happy path" seeded with +rules+, and running at +route+; its default when +asDefault+. */
async function ordersWith(page: Page, db: Db, options: { rules?: readonly SeedRule[]; asDefault?: boolean; route?: string; open?: boolean } = {}) {
  ordersPortalRemote();
  const build = await buildOrdersPortal(db);
  const happy = seedMockSet(db, build.application.slug, options.rules ?? ORDERS_HAPPY_PATH, { default: options.asDefault ?? true });
  if (options.open !== false) {
    await page.goto(framedRun(build, options.route ?? "/accounts"));
    await waitForPage(page, "Accounts");
  }
  return { build, happy };
}

test.describe("choosing the set a view applies", () => {
  test("applies the default before the build's first call, and marks the pill (The first call, Opening with a default set)", async ({ page, db }) => {
    await ordersWith(page, db);
    // Recent orders are the page's first call, through XHR, to another origin.
    await expect(recentOrders(page).locator("[data-recent-orders] li").first()).toHaveText("Order 1001 · Northwind Traders · Open · $1,280");
    await expect(liveOrders(page).locator("[data-live-orders] li")).toHaveCount(3);
    // The pill shows Data at rest, marked, naming the set.
    const resting = page.locator('[data-toolbar="controls"] [data-resting][data-toolbar-item="data"]');
    await expect(resting).toHaveAccessibleName("Data · Mock set: Happy path");
    await resting.hover();
    await expect(page.locator("[data-toolbar-tooltip]")).toContainText("Data · Mock set: Happy path");
    await resting.click();
    await expect(panel(page)).toBeVisible();
    await expect(setChoice(page).getByRole("radio", { name: /^Happy path/ })).toBeChecked();
    await expect(panel(page).locator("[data-mock-source]")).toHaveText("The application's default.");
  });

  test("without a set, the pill shows no Data button, and Data offers New mock set (No set)", async ({ page, db }) => {
    await ordersWith(page, db, { asDefault: false });
    await expect(recentOrders(page)).toContainText("Recent orders unavailable");
    await expect(page.locator('[data-toolbar="controls"] [data-toolbar-item="data"]')).toHaveCount(0);
    await openTool(page, "data");
    await expect(setChoice(page).getByRole("radio", { name: "None: the application's own network" })).toBeChecked();
    await expect(panel(page).locator("[data-requests-note]")).toContainText("Calls are listed while a mock set applies.");
    await expect(panel(page).getByRole("button", { name: "New mock set" })).toBeVisible();
  });

  test("chooses a set for this visitor and view, reloading the frame at its route; another visitor keeps the default (Choosing a set, Another visitor, Choosing None)", async ({ page, db, browser, baseURL }) => {
    const { build } = await ordersWith(page, db, { asDefault: false });
    seedMockSet(db, build.application.slug, [{ pattern: "/v1/orders", responses: [{ status: 500, json: { error: "Down" } }] }], { name: "Errors" });
    setDefault(db, build.application.slug, seedMockSet(db, build.application.slug, ORDERS_HAPPY_PATH, { name: "Default orders" }).publicId);
    await page.reload();
    await waitForPage(page, "Accounts");
    await openTool(page, "data");
    await setChoice(page).getByRole("radio", { name: /^Errors/ }).check();
    await expect(recentOrders(page)).toContainText("Recent orders unavailable");
    await expect(page).toHaveURL(/\/run\/orders-portal\/accounts$/);
    await expect(panel(page).locator("[data-mock-source]")).toHaveText("Your choice for this view.");
    await page.reload();
    await waitForPage(page, "Accounts");
    await expect(recentOrders(page)).toContainText("Recent orders unavailable");

    // Another visitor applies the application's default.
    const other = await visitorContext(browser, db, baseURL!);
    const visitor = await other.newPage();
    await visitor.goto(framedRun(build, "/accounts"));
    await waitForPage(visitor, "Accounts");
    await expect(recentOrders(visitor).locator("[data-recent-orders] li").first()).toContainText("Order 1001");
    await other.close();

    // None: every call goes to its own address.
    await openTool(page, "data");
    await setChoice(page).getByRole("radio", { name: "None: the application's own network" }).check();
    await expect(recentOrders(page)).toContainText("Recent orders unavailable");
    await expect(page.locator('[data-toolbar="controls"] [data-resting]')).toHaveCount(0);
  });

  test("a saved preview's own default applies to its view, and Data says so (A saved preview's own default)", async ({ page, db }) => {
    const { build } = await ordersWith(page, db, { open: false });
    const saved = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
    const newNav = seedMockSet(db, build.application.slug, [{ pattern: "/v1/orders", responses: [{ json: { orders: [{ id: "2001", account: "New nav data", status: "open", total: 1 }] } }] }], { name: "New nav data" });
    setDefault(db, build.application.slug, newNav.publicId, { preview: saved.key });
    await page.goto(`/run/orders-portal@${saved.key}/accounts`);
    await waitForPage(page, "Accounts");
    await expect(recentOrders(page).locator("[data-recent-orders] li")).toHaveText(["Order 2001 · New nav data · Open · $1"]);
    await openTool(page, "data");
    await expect(setChoice(page).getByRole("radio", { name: /^New nav data/ })).toBeChecked();
    await expect(panel(page).locator("[data-mock-source]")).toHaveText("The saved preview's default.");
  });

  test("Slow makes mocked answers wait 2 seconds, from the next call (Slow)", async ({ page, db }) => {
    await ordersWith(page, db);
    await openTool(page, "data");
    await panel(page).getByRole("group", { name: "Latency" }).getByRole("radio", { name: /^Slow/ }).check();
    await application(page).getByRole("link", { name: "Northwind Traders" }).click();
    await expect(application(page).getByText("Loading orders…")).toBeVisible();
    const started = Date.now();
    await expect(application(page).locator("[data-account-orders] li")).toHaveCount(2, { timeout: 10_000 });
    expect(Date.now() - started).toBeGreaterThan(1500);
  });

  test("Manage mock sets opens the application's Mock sets section in a new tab (Managing sets)", async ({ page, db, context }) => {
    const { build } = await ordersWith(page, db);
    await openTool(page, "data");
    const opened = context.waitForEvent("page");
    await panel(page).getByRole("link", { name: "Manage mock sets" }).click();
    const tab = await opened;
    await expect(tab).toHaveURL(new RegExp(`/applications/${build.application.slug}#mock-sets$`));
  });
});

test.describe("the request list", () => {
  test("lists the calls on load with what answered each, filters them by outcome, and clears them (Calls on load, Filtering)", async ({ page, db }) => {
    await ordersWith(page, db);
    await expect(recentOrders(page).locator("[data-recent-orders] li")).toHaveCount(5);
    await expect(application(page).locator("[data-rates]")).toHaveText("Rates unavailable");
    await openTool(page, "data");
    const orders = panel(page).locator(`[data-request^="GET ${API}/orders?limit=5"]`).first();
    await expect(orders.locator("[data-request-summary]")).toHaveText("Mocked by rule GET /v1/orders");
    const rates = request(page, "GET", `${API}/rates`);
    await expect(rates.locator("[data-request-summary]")).toHaveText("Failed, couldn't connect or was blocked by CORS");
    await panel(page).getByRole("group", { name: "Filter requests" }).getByRole("button", { name: /^Failed/ }).click();
    const failed = panel(page).getByRole("list", { name: "Requests" }).locator("[data-request-outcome]");
    await expect(failed.first()).toBeVisible();
    expect(new Set(await failed.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-request-outcome"))))).toEqual(new Set(["failed"]));
    await expect(panel(page).locator('[data-filter="failed"]')).toContainText(String(await failed.count()));
    await panel(page).getByRole("button", { name: "Clear requests" }).click();
    await expect(panel(page).getByRole("list", { name: "Requests" })).toHaveCount(0);
  });

  test("answers a dedicated worker's call, from the worker's script request, and lists it (A worker's call)", async ({ page, db }) => {
    const { build } = await ordersWith(page, db, { rules: [...ORDERS_HAPPY_PATH, { pattern: "/v1/rates", responses: [{ json: { base: "USD", rates: { EUR: 0.92 } } }] }] });
    await expect(application(page).locator("[data-rates]")).toHaveText("Rates: 1 USD = 0.92 EUR");
    await openTool(page, "data");
    await expect(request(page, "GET", `${API}/rates`).locator("[data-request-summary]")).toHaveText("Mocked by rule GET /v1/rates");

    // With a second view of the build armed, the one-view fallback can't answer a worker; the browser's
    // resultingClientId for the worker's script does (add-mock-sets, task 8.2: the path the pinned browser takes).
    await page.evaluate(async (scope) => {
      const registration = await navigator.serviceWorker.getRegistration(scope);
      await new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = resolve;
        registration!.active!.postMessage({ type: "frontend-registry:routing", command: "arm", table: { view: "/run/orders-portal", share: "another-view", scope, routes: [], kept: [], mocks: null }, frame: null }, [channel.port2]);
      });
    }, build.base);
    await page.reload();
    await waitForPage(page, "Accounts");
    await expect(application(page).locator("[data-rates]")).toHaveText("Rates: 1 USD = 0.92 EUR");
  });

  test("lists the ticker's WebSocket as failed, never mocked (A live ticker)", async ({ page, db }) => {
    await ordersWith(page, db);
    await expect(application(page).locator("[data-ticker]")).toHaveText("Ticker unavailable");
    await openTool(page, "data");
    await expect(request(page, "WebSocket", "wss://api.orders.test/v1/ticker").locator("[data-request-summary]")).toHaveText("Failed. WebSockets aren't mocked yet.");
  });

  test("leaves the repository's preview page of the same build alone (The repository's preview page)", async ({ page, db }) => {
    const { build } = await ordersWith(page, db);
    await expect(recentOrders(page).locator("[data-recent-orders] li")).toHaveCount(5);
    await page.goto(`${build.base}accounts`);
    await expect(page.getByRole("region", { name: "Recent orders" })).toContainText("Recent orders unavailable");
  });
});

test.describe("changes to the set", () => {
  test("keeps the rule another visitor changed until the frame loads again (Someone else's change)", async ({ page, db }) => {
    const { build, happy } = await ordersWith(page, db);
    await application(page).getByRole("link", { name: "Northwind Traders" }).click();
    await expect(application(page).locator("[data-account-orders] li")).toHaveCount(2);
    const account = allRules(db, happy.id).find((rule) => rule.pattern === "/v1/accounts/:id")!;
    const changed = { id: "42", orders: [{ id: "3001", status: "open", total: 5 }] };
    editRule(db, mockApplicationId(db, build.application.slug), happy.publicId, account.publicId, account.lockVersion, { method: "GET", pattern: "/v1/accounts/:id", queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "ignore", body: null, responses: [{ status: 200, headers: [], contentType: "application/json", body: new TextEncoder().encode(JSON.stringify(changed)), latencyMs: 0 }] }, "Visitor", serverConfig());
    // This view keeps the rule as it was.
    await application(page).getByRole("link", { name: "Contoso Pharmaceuticals" }).click();
    await expect(application(page).getByRole("heading", { name: "Contoso Pharmaceuticals" })).toBeVisible();
    await expect(application(page).locator("[data-account-orders] li")).toHaveCount(2);
    // A new load applies the change.
    await page.reload();
    await waitForPage(page, "Accounts");
    await application(page).getByRole("link", { name: "Northwind Traders" }).click();
    await expect(application(page).locator("[data-account-orders] li")).toHaveText(["Order 3001 · Open · $5"]);
  });
});

test.describe("where a set can't apply", () => {
  const DESK_NAME: readonly SeedRule[] = [{ pattern: "/v1/desk", responses: [{ json: { name: "FX desk" } }] }];

  test("says a set can't apply beside the build's own service worker, offering no choice, and that screenshots still use the default (The build's own service worker)", async ({ page, db }) => {
    const { desk } = await buildQuotes(db, { saved: false });
    seedMockSet(db, desk.application.slug, DESK_NAME, { default: true });
    await page.goto(framedRun(desk));
    await waitForPage(page, "Quotes desk");
    await expect(application(page).locator("[data-desk-name]")).toHaveText("Desk: FX desk");
    // The application registers a service worker for its own path.
    await application(page)
      .locator(":root")
      .evaluate(async () => {
        await navigator.serviceWorker.register("sw.js");
        await navigator.serviceWorker.ready;
      });
    await page.reload();
    await waitForPage(page, "Quotes desk");
    await expect(application(page).locator("[data-desk-name]")).toHaveText("Desk name unavailable");
    await openTool(page, "data");
    await expect(panel(page).locator("[data-mock-refusal]")).toHaveText("Mock sets can't apply beside the application's own service worker for its build's path. Screenshots of the build still apply its default mock set.");
    await expect(panel(page).getByRole("radio")).toHaveCount(0);
    await expect(page.locator('[data-toolbar="controls"] [data-resting]')).toHaveCount(0);
  });

  test("says when the build registers its own service worker while a set applies (Registered while viewing)", async ({ page, db }) => {
    const { desk } = await buildQuotes(db, { saved: false });
    seedMockSet(db, desk.application.slug, DESK_NAME, { default: true });
    await page.goto(framedRun(desk));
    await waitForPage(page, "Quotes desk");
    await expect(application(page).locator("[data-desk-name]")).toHaveText("Desk: FX desk");
    await application(page)
      .locator(":root")
      .evaluate(async () => void (await navigator.serviceWorker.register("sw.js")));
    await openTool(page, "data");
    await expect(panel(page).locator("[data-mock-registered]")).toHaveText("The application registered its own service worker, so mock sets stop applying at the next load. Screenshots of the build still apply its default mock set.");
  });
});

test.describe("routing and a mock set together", () => {
  test("loads the routed panel from feature/blue-quotes, and the desk's name from the rule imported from quotes-desk.har (Quotes desk routed and mocked)", async ({ page, db, context }) => {
    const { desk } = await buildQuotes(db);
    // Imported as Upload HAR and Review HAR do: the first set of an application becomes its default.
    const workspace = await workspaceOf(context, db);
    const draft = createDraft(db, { applicationId: mockApplicationId(db, desk.application.slug), workspaceId: workspace.id, fileName: "quotes-desk.har", target: null, setName: "Happy path", fromOnboarding: false }, fs.readFileSync("test/fixtures/har/quotes-desk.har", "utf8"), serverConfig());
    saveDraft(db, draft, null, serverConfig());
    await page.goto(framedRun(desk));
    await waitForPage(page, "Quotes desk");
    await routeQuotesPanelToBlue(page);
    await expect(application(page).locator("[data-desk-name]")).toHaveText("Desk: FX desk");
    await expect(page.locator('[data-toolbar="controls"] [data-resting][data-toolbar-item="data"]')).toHaveAccessibleName("Data · Mock set: Happy path");
  });
});

test.describe("creating a rule from a call", () => {
  test("answers the failed rates call from the next one, without reloading (Answering a failed call)", async ({ page, db }) => {
    await ordersWith(page, db);
    await openTool(page, "data");
    await request(page, "GET", `${API}/rates`).getByRole("button").click();
    await panel(page).getByRole("button", { name: "Create rule" }).click();
    const form = panel(page).getByRole("form", { name: "Create rule" });
    await expect(form.getByLabel("Path")).toHaveValue("/v1/rates");
    await form.getByLabel("Status").fill("200");
    await form.getByLabel("Body").fill('{"base":"USD","rates":{"EUR":0.92}}');
    await form.getByRole("button", { name: "Create rule" }).click();
    await expect(panel(page).getByRole("status").filter({ hasText: "Added GET /v1/rates to Happy path. The next call uses it." })).toBeVisible();
    // The page's next call, made without reloading, is answered by the new rule.
    const answer = await application(page)
      .locator(":root")
      .evaluate(async (_root, address) => (await (await fetch(address)).json()) as unknown, `${API}/rates`);
    expect(answer).toEqual({ base: "USD", rates: { EUR: 0.92 } });
    await expect(panel(page).locator(`[data-request="GET ${API}/rates"]`).first().locator("[data-request-summary]")).toHaveText("Mocked by rule GET /v1/rates");
  });

  test("adds a rule saved without a response as needing one, which answers nothing (Leaving the response empty)", async ({ page, db }) => {
    await ordersWith(page, db);
    await openTool(page, "data");
    await request(page, "GET", `${API}/rates`).getByRole("button").click();
    await panel(page).getByRole("button", { name: "Create rule" }).click();
    await panel(page).getByRole("form", { name: "Create rule" }).getByRole("button", { name: "Create rule" }).click();
    await expect(panel(page).getByRole("status").filter({ hasText: "needing a response" })).toBeVisible();
    const answer = await application(page)
      .locator(":root")
      .evaluate(async (_root, address) => fetch(address).then(() => "answered", () => "failed"), `${API}/rates`);
    expect(answer).toBe("failed");
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`has no accessibility violations with Data's requests, a call's detail, and Create rule, in the ${theme} operator theme`, async ({ page, db, context, baseURL }) => {
    await useTheme(context, theme, baseURL!);
    await ordersWith(page, db);
    await expect(application(page).locator("[data-rates]")).toHaveText("Rates unavailable");
    expect(await auditToolbar(page)).toEqual([]);
    await openTool(page, "data");
    await expect(request(page, "GET", `${API}/rates`)).toBeVisible();
    expect(await auditToolbar(page)).toEqual([]);
    await request(page, "GET", `${API}/rates`).getByRole("button").click();
    await panel(page).getByRole("button", { name: "Create rule" }).click();
    await expect(panel(page).getByRole("form", { name: "Create rule" })).toBeVisible();
    expect(await auditToolbar(page)).toEqual([]);
  });
}
