import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { buildApplication } from "../src/lib/applications/pipeline";
import { getApplication } from "../src/lib/applications/records";
import { git } from "../test/support/git-fixture";
import { offlineViteApp } from "../test/support/preview-trees";
import { onboarded, registered, seeded } from "./support/applications";
import { E2E_PREVIEWS } from "./support/env";
import { expect as baseExpect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { runJobs, serverConfig } from "./support/results";
import { expectCurrentItem, pageHeader, pageTitle } from "./support/shell";
import { paths } from "./support/paths";

/*
 * The Applications page and an application's page (add-applications tasks
 * 6.1 to 6.5; applications/catalog spec): the gallery's search, filters,
 * count, cards, and pages; each card state; live updates while a build runs,
 * through the real pipeline, offline; the application page before and after
 * its first build and after a failed later one; and its settings.
 */

test.skip(!E2E_PREVIEWS, "Applications exist only while previews are on (E2E_PREVIEWS=0)");
// A build's states arrive through polling, every 3 seconds.
const expect = baseExpect.configure({ timeout: 15_000 });
test.setTimeout(120_000);

const cards = (page: Page) => page.getByRole("article");
const card = (page: Page, name: string) => cards(page).filter({ has: page.getByRole("heading", { name, exact: true }) });
const cardTitles = (page: Page) => cards(page).getByRole("heading").allTextContents();
const rail = (page: Page) => page.getByRole("form", { name: "Filter applications" });

test.describe("the Applications page", () => {
  test("Opening Applications: the search, the filter rail, the count, the cards, and New application", async ({ page, db }) => {
    seeded(db, "Payments hub", { description: "Send and track payments" });
    seeded(db, "Orders portal", { description: "Order tracking for partners" });
    seeded(db, "admin console", { state: "failed" });
    await page.goto(paths.applications);
    await expect(page).toHaveTitle("Applications · Frontend Registry");
    await expect(pageTitle(page)).toHaveText("Applications");
    await expectCurrentItem(page, "Applications");
    await expect(pageHeader(page).getByRole("link", { name: "New application" })).toHaveAttribute("href", "/applications/new");
    await expect(page.getByRole("searchbox", { name: "Search applications" })).toBeVisible();
    await expect(rail(page).getByRole("heading", { name: "Filter applications" })).toBeVisible();
    await expect(rail(page).getByRole("group", { name: "Framework" })).toBeVisible();
    await expect(rail(page).getByRole("group", { name: "Status" })).toBeVisible();
    await expect(page.getByText("Showing 3 of 3 applications")).toBeVisible();
    expect(await cardTitles(page)).toEqual(["admin console", "Orders portal", "Payments hub"]);
    // Every card in a row is the same height.
    const heights = await cards(page).evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
    await expectNoHorizontalOverflow(page);
  });

  test("No applications yet: an empty state that says applications are built from repositories, with New application", async ({ page, db: _db }) => {
    await page.goto(paths.applications);
    const main = page.getByRole("main");
    await expect(main.getByText("No applications yet")).toBeVisible();
    await expect(main.getByText(/Applications are built from repositories/)).toBeVisible();
    await expect(main.getByRole("link", { name: "New application" })).toHaveCount(1);
    await expect(pageHeader(page).getByRole("link", { name: "New application" })).toHaveCount(0);
  });

  test("A ready application's card: its name, two-line description, React · Vite, main, Ready, and its screenshot", async ({ page, db }) => {
    seeded(db, "Orders portal", { description: "Order tracking for partners, with a description long enough that it needs more than two lines to show in full, which the card clamps." });
    await page.goto(paths.applications);
    const orders = card(page, "Orders portal");
    await expect(orders).toContainText("React · Vite");
    await expect(orders).toContainText("main");
    await expect(orders).toContainText("Ready");
    const commit = getApplication(db, "orders-portal").current!.commitSha.slice(0, 7);
    await expect(orders.getByRole("img", { name: `Screenshot of Orders portal at commit ${commit}` })).toBeVisible();
    // Keyboard access: Tab to the card's link and press Enter.
    await orders.getByRole("link", { name: "Orders portal" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/applications\/orders-portal$/);
  });

  test("Card states: the building placeholder, the failure state, and the neutral screenshot-unavailable image, each with its status in text", async ({ page, db }) => {
    seeded(db, "Building app", { state: "building" });
    seeded(db, "Failed app", { state: "failed" });
    seeded(db, "Unavailable app", { state: "unavailable" });
    seeded(db, "Capturing app", { state: "capturing" });
    await page.goto(paths.applications);
    const building = card(page, "Building app");
    await expect(building).toContainText("Building");
    await expect(building.locator("[data-placeholder]")).toHaveAttribute("aria-hidden", "true");
    await expect(building.getByRole("img")).toHaveCount(0);
    await expect(card(page, "Capturing app").locator("[data-placeholder]")).toHaveCount(1);
    await expect(card(page, "Capturing app")).toContainText("Ready");
    const failed = card(page, "Failed app");
    await expect(failed).toContainText("Build failed");
    await expect(failed.locator('[data-image-state="failure"]')).toBeVisible();
    await expect(card(page, "Unavailable app").getByRole("img", { name: "Screenshot unavailable" })).toBeVisible();
  });

  test("The image straightens on hover and focus, and the card keeps its size (Hovering over a card)", async ({ page, db }) => {
    seeded(db, "Orders portal");
    await page.goto(paths.applications);
    const orders = card(page, "Orders portal");
    const frame = orders.locator("[data-image-state]");
    const before = await orders.boundingBox();
    expect(await frame.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
    await orders.hover();
    await expect.poll(() => frame.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
    expect(await orders.boundingBox()).toEqual(before);
    await page.mouse.move(0, 0);
    await expect.poll(() => frame.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
    await orders.getByRole("link", { name: "Orders portal" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect.poll(() => frame.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
  });

  test("Searching: name, description, repository, and branch, in the address; and no matches offers Clear filters", async ({ page, db }) => {
    seeded(db, "Orders portal");
    seeded(db, "Payments hub", { description: "Pays ORDERS out" });
    seeded(db, "Admin", { branch: "feature/orders-export" });
    seeded(db, "Ledger");
    await page.goto(paths.applications);
    const search = page.getByRole("searchbox", { name: "Search applications" });
    await search.fill("orders");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/applications\?q=orders$/);
    await expect(page.getByText("Showing 3 of 4 applications")).toBeVisible();
    expect(await cardTitles(page)).toEqual(["Admin", "Orders portal", "Payments hub"]);

    await search.fill("quantum teleporter");
    await search.press("Enter");
    await expect(page.getByText("No applications match")).toBeVisible();
    await expect(page.getByText("No application matches “quantum teleporter” with the chosen filters.")).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/applications$/);
    await expect(cards(page)).toHaveCount(4);
  });

  test("React applications that failed: filters combine, count, keep the address, collapse, and clear", async ({ page, db }) => {
    seeded(db, "Orders portal", { framework: "react", state: "failed" });
    seeded(db, "Payments hub", { framework: "react" });
    seeded(db, "Admin", { framework: "vue", state: "failed" });
    seeded(db, "Ledger", { framework: "svelte", state: "building" });
    await page.goto(paths.applications);
    await rail(page).getByRole("checkbox", { name: /React/ }).check();
    await expect(page).toHaveURL(/framework=React/);
    await rail(page).getByRole("checkbox", { name: /Failed/ }).check();
    await expect(page).toHaveURL(/framework=React&status=failed/);
    await expect(page.getByText("Showing 1 of 4 applications")).toBeVisible();
    expect(await cardTitles(page)).toEqual(["Orders portal"]);
    await expect(rail(page).getByRole("group", { name: "Status" })).toContainText("Ready1Building0Failed1");

    // Collapsing a group hides its options and keeps its count of selected ones.
    const status = rail(page).locator("summary").filter({ hasText: "Status" });
    await status.click();
    await expect(rail(page).getByRole("checkbox", { name: /Failed/ })).toBeHidden();
    await expect(status).toContainText("1 selected");

    await rail(page).getByRole("link", { name: "Clear" }).click();
    await expect(page).toHaveURL(/\/applications$/);
    await expect(page.getByText("Showing 4 of 4 applications")).toBeVisible();
  });

  test("Many applications: 24 a page, the page in the address, and a new search back to the first page", async ({ page, db }) => {
    test.setTimeout(240_000);
    for (let index = 1; index <= 30; index++) seeded(db, `App ${String(index).padStart(2, "0")}`, { state: "building" });
    await page.goto(paths.applications);
    await expect(page.getByText("Showing 1–24 of 30 applications")).toBeVisible();
    await expect(cards(page)).toHaveCount(24);
    await page.getByRole("navigation", { name: "Applications pages" }).getByRole("link", { name: "Page 2" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("Showing 25–30 of 30 applications")).toBeVisible();
    expect((await cardTitles(page))[0]).toBe("App 25");
    const search = page.getByRole("searchbox", { name: "Search applications" });
    await search.fill("App 1");
    await search.press("Enter");
    await expect(page).toHaveURL(/\?q=App\+1$/);
    await expect(page.getByText("Showing 10 of 30 applications")).toBeVisible();
  });
});

test.describe("live updates", () => {
  test("follows a fixture build from the placeholder to its screenshot, and a broken one to the failure state, without a reload (New application)", async ({ page, db, sourcesDir }) => {
    await onboarded(db, [registered(db, path.join(sourcesDir, "orders-web"), offlineViteApp()), "Orders portal"], [registered(db, path.join(sourcesDir, "broken-web"), offlineViteApp({ broken: true })), "Broken portal"]);
    await page.goto(paths.applications);
    await expect(card(page, "Orders portal")).toContainText("Building");
    await expect(card(page, "Orders portal").locator("[data-placeholder]")).toHaveCount(1);
    await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));

    // The builds, and the ready one's screenshot, run in this process as the worker would run them.
    await runJobs(db);
    await expect(card(page, "Orders portal")).toContainText("Ready");
    await expect(card(page, "Orders portal").getByRole("img", { name: /^Screenshot of Orders portal at commit [0-9a-f]{7}$/ })).toBeVisible();
    await expect(card(page, "Broken portal")).toContainText("Build failed");
    await expect(card(page, "Broken portal").locator('[data-image-state="failure"]')).toBeVisible();
    // Each finished build is announced once, politely.
    await expect(page.locator("[data-build-announcements]")).toHaveText(/Broken portal: Build failed\.|Orders portal: Ready\./);
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  });
});

test.describe("an application's page", () => {
  test("Before the first build succeeds: the placeholder and Building, with Preview application and Open full screen unavailable", async ({ page, db }) => {
    seeded(db, "Orders portal", { state: "building", description: "Order tracking for partners" });
    await page.goto(paths.application("orders-portal"));
    await expect(page).toHaveTitle("Orders portal · Applications · Frontend Registry");
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link");
    await expect(crumbs).toHaveText(["Applications"]);
    await expect(crumbs.first()).toHaveAttribute("href", "/applications");
    await expectCurrentItem(page, "Applications", "true");
    const header = pageHeader(page);
    await expect(header).toContainText("Building");
    await expect(header.getByRole("button", { name: "Preview application" })).toBeDisabled();
    await expect(header.getByRole("button", { name: "Open full screen" })).toBeDisabled();
    await expect(header.getByRole("button", { name: "Rebuild" })).toBeDisabled();
    await expect(page.locator("figure [data-placeholder]")).toHaveCount(1);
    await expect(page.getByRole("table", { name: "Builds of Orders portal" }).getByRole("row")).toHaveCount(2);
  });

  test("Ready application page: its screenshot, linked Repository, branch, built commit and time, what it's built with, and Ready", async ({ page, db }) => {
    seeded(db, "Orders portal");
    const current = getApplication(db, "orders-portal").current!;
    const preview = { publicId: current.preview, commitSha: current.commitSha };
    await page.goto(paths.application("orders-portal"));
    const header = pageHeader(page);
    await expect(header.getByRole("link", { name: "Preview application" })).toHaveAttribute("href", "/applications/orders-portal/preview");
    await expect(header.getByRole("link", { name: "Open full screen" })).toHaveAttribute("href", "/run/orders-portal");
    await expect(header.getByRole("button", { name: "Rebuild" })).toBeEnabled();
    const overview = page.locator("dl");
    await expect(overview.getByRole("link", { name: "spa-orders-portal" })).toHaveAttribute("href", `/repositories/${db.$client.prepare("select public_id from repository_sources where name = 'spa-orders-portal'").pluck().get()}`);
    await expect(overview).toContainText("main");
    await expect(overview).toContainText(preview.commitSha.slice(0, 7));
    await expect(overview).toContainText("React · Vite · pnpm");
    await expect(overview).toContainText("Ready");
    await expect(page.getByRole("figure").getByRole("img", { name: `Screenshot of Orders portal at commit ${preview.commitSha.slice(0, 7)}` })).toBeVisible();
  });

  test("Later build fails: the page keeps the screenshot, says Latest build failed with the reason and its log, and lists the builds newest first", async ({ page, db, sourcesDir }) => {
    const remote = path.join(sourcesDir, "orders-web");
    const [created] = await onboarded(db, [registered(db, remote, offlineViteApp()), "Orders portal"]);
    await runJobs(db);
    await page.goto(paths.application("orders-portal"));
    await expect(pageHeader(page)).toContainText("Ready");

    // Rebuild is queued, and builds the same commit again.
    await pageHeader(page).getByRole("button", { name: "Rebuild" }).click();
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("A build of Orders portal is queued.")).toBeVisible();
    await expect(pageHeader(page).getByRole("button", { name: "Rebuild" })).toBeDisabled();
    await runJobs(db);
    await expect(pageHeader(page)).toContainText("Ready");

    // A new commit on main that doesn't build, as the automatic check finds it.
    fs.writeFileSync(path.join(remote, "src/main.js"), "SYNTAX ERROR\n");
    git(remote, ["commit", "--quiet", "-am", "Break the build"]);
    await buildApplication(db, created!.publicId, { config: serverConfig() });
    await runJobs(db);
    // The page wasn't polling, since nothing was building when it last showed.
    await page.reload();
    await expect(pageHeader(page)).toContainText("Latest build failed");
    await expect(page.locator("#page-alerts")).toContainText("The build failed");
    await expect(page.locator("#page-alerts").getByRole("link", { name: "View the build log" })).toHaveAttribute("href", /\/repositories\/src_[a-z0-9]+\/previews\/pvw_[a-z0-9]+#log$/);
    await expect(page.getByRole("figure").getByRole("img", { name: /^Screenshot of Orders portal/ })).toBeVisible();
    const rows = page.getByRole("table", { name: "Builds of Orders portal" }).getByRole("row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toContainText("New commit · main");
    await expect(rows.nth(1)).toContainText("Failed");
    await expect(rows.nth(1).getByRole("link", { name: /^Log of [0-9a-f]{7}$/ })).toBeVisible();
    await expect(rows.nth(2)).toContainText("Rebuild · main");
    await expect(rows.nth(2)).toContainText("Ready");
    await expect(rows.nth(3)).toContainText("First build · main");
    await expect(rows.nth(3)).toContainText("No longer kept");
  });

  test("Renaming keeps the address; switching branch queues a build that keeps the current one in use; Delete removes the card", async ({ page, db, sourcesDir }) => {
    const remote = path.join(sourcesDir, "orders-web");
    const repository = registered(db, remote, offlineViteApp());
    git(remote, ["checkout", "--quiet", "-b", "release/2.0"]);
    git(remote, ["commit", "--quiet", "--allow-empty", "-m", "release"]);
    git(remote, ["checkout", "--quiet", "main"]);
    await onboarded(db, [repository, "Orders portal"]);
    await runJobs(db);

    await page.goto(paths.applicationSettings("orders-portal"));
    await expect(pageTitle(page)).toHaveText("Settings for Orders portal");
    await page.getByRole("textbox", { name: "Name" }).fill("Partner orders");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/applications\/orders-portal\?notice=updated|\/applications\/orders-portal$/);
    await expect(pageTitle(page)).toHaveText("Partner orders");

    await page.goto(paths.applicationSettings("orders-portal"));
    await page.getByRole("combobox", { name: "Tracked branch" }).selectOption("release/2.0");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("Partner orders now tracks release/2.0.")).toBeVisible();
    await expect(pageHeader(page)).toContainText("Building");
    // The current build, of main, stays in use until release/2.0's succeeds.
    await expect(pageHeader(page).getByRole("link", { name: "Preview application" })).toBeVisible();
    expect(getApplication(db, "orders-portal").current?.commitSha).not.toBe(getApplication(db, "orders-portal").latest.commitSha);

    await page.goto(paths.applicationSettings("orders-portal"));
    await page.getByRole("button", { name: "Delete application" }).click();
    await page.getByRole("dialog", { name: "Delete Partner orders?" }).getByRole("button", { name: "Delete application" }).click();
    await expect(page).toHaveURL(/\/applications$/);
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("The application was deleted.")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
  });

  test("An unknown application's page says so and links to Applications", async ({ page, db: _db }) => {
    await page.goto(paths.application("nowhere"));
    await expect(pageTitle(page)).toHaveText("Application not found");
    await expect(page.getByRole("link", { name: "Go to Applications" })).toHaveAttribute("href", "/applications");
  });
});
