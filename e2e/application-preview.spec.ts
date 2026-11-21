import fs from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { getApplication, getApplicationRow } from "../src/lib/applications/records";
import { findSavedPreview, savedPreviewsOf } from "../src/lib/applications/saved-previews";
import { BUILD_PREVIEW } from "../src/lib/previews/records";
import type { Db } from "../src/lib/db/client";
import { git } from "../test/support/git-fixture";
import { SCALA_SERVICE, offlineViteApp } from "../test/support/preview-trees";
import { onboarded, registered } from "./support/applications";
import { E2E_PREVIEWS } from "./support/env";
import { buildOrdersPortal, ordersPortalRemote, settle } from "./support/fixture-app";
import { ORDERS_HAPPY_PATH, seedMockSet } from "./support/mock-sets";
import { buildQuotes } from "./support/quotes-fixtures";
import { expect as baseExpect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { runJobs } from "./support/results";
import { pageHeader } from "./support/shell";

/*
 * Preview mode for applications (add-applications tasks 7.1 to 7.3;
 * template-preview spec), ported from the template preview's tests to an
 * application built from an offline fixture through the real pipeline: the
 * focused page and its back button, the device frame and its controls, the
 * branch or tag choice, which never changes the tracked branch, and the Code
 * tab's committed files.
 */

test.skip(!E2E_PREVIEWS, "Applications exist only while previews are on (E2E_PREVIEWS=0)");
const expect = baseExpect.configure({ timeout: 15_000 });
test.setTimeout(120_000);

const frameElement = (page: Page) => page.locator("[data-preview-frame]");
const pressed = (page: Page, group: string) => page.getByRole("group", { name: group }).locator('[aria-pressed="true"]');
const sidebar = (page: Page) => page.locator("#sidebar");
const backButton = (page: Page) => page.locator("[data-shell-header]").getByRole("link", { name: "Back to Orders portal" });
const landscape = (page: Page) => page.getByRole("button", { name: "Landscape" });
const preview = paths.applicationPreview("orders-portal");

/** The Orders portal: an offline Vite app on main, with a sensitive .npmrc, a feature branch, and a tag at a commit that can't be previewed; built. */
async function ordersPortal(db: Db, sourcesDir: string): Promise<string> {
  const remote = path.join(sourcesDir, "orders-web");
  const repository = registered(db, remote, { ...offlineViteApp(), ".npmrc": "//registry.example.com/:_authToken=secret\n" });
  git(remote, ["checkout", "--quiet", "-b", "feature/new-nav"]);
  git(remote, ["commit", "--quiet", "--allow-empty", "-m", "New nav"]);
  git(remote, ["checkout", "--quiet", "--orphan", "ledger"]);
  git(remote, ["rm", "-rqf", "."]);
  for (const [file, content] of Object.entries(SCALA_SERVICE)) {
    fs.mkdirSync(path.dirname(path.join(remote, file)), { recursive: true });
    fs.writeFileSync(path.join(remote, file), content);
  }
  git(remote, ["add", "--all"]);
  git(remote, ["commit", "--quiet", "-m", "A Scala service"]);
  git(remote, ["tag", "v0-scala"]);
  git(remote, ["checkout", "--quiet", "main"]);
  git(remote, ["branch", "-D", "ledger"]);
  const [created] = await onboarded(db, [repository, "Orders portal"]);
  await runJobs(db);
  return created!.publicId;
}

/** The running build inside the device frame, once its page rendered. */
async function framed(page: Page): Promise<Frame> {
  await expect(frameElement(page)).toBeVisible();
  const content = (await (await frameElement(page).elementHandle())!.contentFrame())!;
  await content.waitForSelector("h1");
  return content;
}

test.describe("the focused page", () => {
  test("hides a stored, shown sidebar from the first paint, with one heading hidden on screen, and goes back to the application", async ({ page, db, sourcesDir, baseURL }) => {
    await ordersPortal(db, sourcesDir);
    await page.context().addCookies([{ name: "frontend-registry-sidebar-width", value: "320", url: baseURL! }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    const html = await (await page.request.get(preview)).text();
    expect(html).toContain('data-shell-header="focused"');
    await page.goto(preview);
    await expect(sidebar(page)).toBeHidden();
    await expect(backButton(page)).toHaveAttribute("title", "Back to Orders portal");
    const headings = page.getByRole("heading", { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText("Preview Orders portal");
    await expect(pageHeader(page)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
    await backButton(page).click();
    await expect(page).toHaveURL(/\/applications\/orders-portal$/);
    await expect(sidebar(page)).toBeVisible();
  });

  test("offers the back button in place of Open navigation on a narrow viewport", async ({ page, db, sourcesDir }) => {
    await ordersPortal(db, sourcesDir);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(preview);
    await expect(backButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("goes back to the application, and turns the device to landscape", async ({ page, db, sourcesDir }) => {
      await ordersPortal(db, sourcesDir);
      await page.goto(paths.applicationPreview("orders-portal", { device: "tablet" }));
      await landscape(page).click();
      await expect(page).toHaveURL(/device=tablet&orientation=landscape/);
      await backButton(page).click();
      await expect(page).toHaveURL(/\/applications\/orders-portal$/);
    });
  });
});

test("Opening preview mode: from Preview application, on the Preview tab with main, Desktop, and Landscape, the current build running in a browser window", async ({ page, db, sourcesDir }) => {
  await ordersPortal(db, sourcesDir);
  await page.goto(paths.application("orders-portal"));
  await pageHeader(page).getByRole("link", { name: "Preview application" }).click();
  await expect(page).toHaveURL(/\/applications\/orders-portal\/preview$/);
  await expect(page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Preview" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("combobox", { name: "Branch or tag" })).toHaveValue("refs/heads/main");
  await expect(pressed(page, "Device")).toHaveAccessibleName("Desktop");
  await expect(landscape(page)).toHaveAttribute("aria-pressed", "true");
  const content = await framed(page);
  await expect(content.locator("h1")).toHaveText("Orders");
  const current = getApplication(db, "orders-portal").current!;
  await expect(page.locator("[data-title-bar]")).toContainText(`/previews/${current.preview}/`);
  await expect(page.getByRole("link", { name: /Open full screen/ })).toHaveAttribute("href", "/run/orders-portal");
});

test("Tablet in landscape: the frame lays out at 1180 by 820, its title names the application, Tablet, and Landscape, and a reload keeps the choices", async ({ page, db, sourcesDir }) => {
  await ordersPortal(db, sourcesDir);
  await page.goto(preview);
  await page.getByRole("group", { name: "Device" }).getByRole("button", { name: "Tablet" }).click();
  await expect(pressed(page, "Device")).toHaveAccessibleName("Tablet");
  await landscape(page).click();
  await expect(page).toHaveURL(/device=tablet&orientation=landscape/);
  await expect(page.getByText("1180 × 820")).toBeVisible();
  await expect(frameElement(page)).toHaveAttribute("title", /Orders portal, main, on Tablet, Landscape/);
  const content = await framed(page);
  expect(await content.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1180, 820]);
  await page.reload();
  await expect(pressed(page, "Device")).toHaveAccessibleName("Tablet");
  await expect(landscape(page)).toHaveAttribute("aria-pressed", "true");
});

test("The Code tab: the package's committed files, package.json by default, and a sensitive .npmrc listed as not shown, with the device controls off", async ({ page, db, sourcesDir }) => {
  await ordersPortal(db, sourcesDir);
  await page.goto(preview);
  await page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Code" }).click();
  await expect(page).toHaveURL(/view=code/);
  const files = page.getByRole("navigation", { name: "Files" });
  await expect(files.getByRole("link", { name: "package.json", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.locator("pre")).toContainText('"name": "orders-web"');
  await expect(files.getByRole("link", { name: /^\.npmrc, / })).toBeVisible();
  await files.getByRole("link", { name: /^\.npmrc, / }).click();
  await expect(page.getByText(/\.npmrc isn't shown/)).toBeVisible();
  await expect(page.getByText("secret")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Device" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Branch or tag" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open full screen/ })).toHaveCount(0);
});

test("Previewing a feature branch: the frame shows its build once ready, the address keeps the ref, and the application still tracks main", async ({ page, db, sourcesDir }) => {
  const id = await ordersPortal(db, sourcesDir);
  await page.goto(preview);
  await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/heads/feature/new-nav");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/ref=refs%2Fheads%2Ffeature%2Fnew-nav/);
  await expect(page.locator("[data-ref-state]")).toBeVisible();
  await expect(page.locator("[data-ref-state] [data-placeholder]")).toHaveCount(1);
  await runJobs(db);
  const content = await framed(page);
  await expect(content.locator("h1")).toHaveText("Orders");
  await expect(frameElement(page)).toHaveAttribute("title", /feature\/new-nav/);
  expect(getApplication(db, "orders-portal")).toMatchObject({ publicId: id, trackedBranch: "main" });
  // Choosing the tracked branch leaves the ref out of the address.
  await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/heads/main");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/\/applications\/orders-portal\/preview$/);
});

test.describe("Show and Save as preview", () => {
  const buildJobs = (db: Db) => (db.$client.prepare("select count(*) as n from jobs where kind = ?").get(BUILD_PREVIEW) as { n: number }).n;

  test("Show still builds without saving: the branch shown isn't added to the saved previews, and its full screen opens without the toolbar (Showing an unsaved branch)", async ({ page, db, sourcesDir }) => {
    const id = await ordersPortal(db, sourcesDir);
    await page.goto(preview);
    await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/heads/feature/new-nav");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/ref=refs%2Fheads%2Ffeature%2Fnew-nav/);
    await runJobs(db);
    await framed(page);
    expect(savedPreviewsOf(db, id)).toEqual([]);
    const fullScreen = page.getByRole("link", { name: /Open full screen/ });
    await expect(fullScreen).toHaveAttribute("href", /^\/previews\/pvw_[a-z0-9]{16}\/$/);
    await fullScreen.focus();
    await expect(page.getByRole("tooltip")).toHaveText("Open full screen without the toolbar. Save as preview runs it with the toolbar.");
    await expect(page.getByRole("button", { name: "Save as preview" })).toBeVisible();
  });

  test("Save as preview reuses the shown build: no second build starts, and the address names it by its key (Saving the branch shown)", async ({ page, db, sourcesDir }) => {
    const id = await ordersPortal(db, sourcesDir);
    await page.goto(paths.applicationPreview("orders-portal", { ref: "refs/heads/feature/new-nav", device: "tablet" }));
    await expect(page.locator('[data-ref-state="unbuilt"]')).toBeVisible();
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.locator('[data-ref-state="checking"]')).toBeVisible();
    await runJobs(db);
    await framed(page);
    const builds = buildJobs(db);

    await page.getByRole("button", { name: "Save as preview" }).click();
    await expect(page).toHaveURL(/\?preview=feature-new-nav&device=tablet$/);
    expect(findSavedPreview(db, id, "feature-new-nav")).toMatchObject({ status: "ready", ref: "refs/heads/feature/new-nav" });
    expect(buildJobs(db)).toBe(builds);
    await framed(page);
    await expect(page.getByRole("button", { name: "Save as preview" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Open full screen/ })).toHaveAttribute("href", "/run/orders-portal@feature-new-nav");
    // The choice lists it as a saved preview, after the tracked branch.
    const choice = page.getByRole("combobox", { name: "Branch or tag" });
    await expect(choice.locator("option").first()).toHaveText("main (tracked)");
    await expect(choice.locator("optgroup[label='Saved previews'] option")).toHaveText(["feature/new-nav"]);
    await expect(choice.locator("optgroup[label='Branches'] option")).toHaveCount(0);
  });

  test("Save as preview refuses the 21st preview, saving nothing (At the limit)", async ({ page, db, sourcesDir }) => {
    const id = await ordersPortal(db, sourcesDir);
    const applicationId = getApplicationRow(db, id).id;
    for (let index = 0; index < 20; index++) {
      db.$client
        .prepare("insert into application_previews (public_id, application_id, key, ref, latest_commit_sha, latest_outcome, latest_reasons, latest_requested_at, created_at, updated_at) values (?, ?, ?, ?, ?, 'failed', '[{\"text\":\"no\"}]', 0, 0, 0)")
        .run(`apv_${String(index).padStart(16, "0")}`, applicationId, `old-${index}`, `refs/heads/old/${index}`, "e".repeat(40));
    }
    await page.goto(paths.applicationPreview("orders-portal", { ref: "refs/heads/feature/new-nav" }));
    await expect(page.locator("[data-remaining-previews]")).toHaveText("This application keeps 20 previews, the most it can. Remove a preview to save another.");
    await page.getByRole("button", { name: "Save as preview" }).click();
    await expect(page.getByText("An application can keep 20 previews", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/ref=refs%2Fheads%2Ffeature%2Fnew-nav/);
    expect(findSavedPreview(db, id, "feature-new-nav")).toBeUndefined();
  });

  test("A ref that has since been saved opens that saved preview by its key", async ({ page, db, sourcesDir }) => {
    const id = await ordersPortal(db, sourcesDir);
    await page.goto(paths.applicationPreview("orders-portal", { ref: "refs/heads/feature/new-nav" }));
    await page.getByRole("button", { name: "Save as preview" }).click();
    await expect(page).toHaveURL(/\?preview=feature-new-nav$/);
    const response = await page.request.get(paths.applicationPreview("orders-portal", { ref: "refs/heads/feature/new-nav", device: "mobile" }), { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("/applications/orders-portal/preview?device=mobile&preview=feature-new-nav");
    expect(savedPreviewsOf(db, id)).toHaveLength(1);
  });
});

test("A tag that can't be previewed: the frame area shows the failure indicator naming the condition", async ({ page, db, sourcesDir }) => {
  await ordersPortal(db, sourcesDir);
  await page.goto(preview);
  await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/tags/v0-scala");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.locator('[data-ref-state="checking"]')).toBeVisible();
  await runJobs(db);
  await expect(page.locator('[data-ref-state="refused"]')).toBeVisible();
  await expect(page.locator('[data-ref-state="refused"] [data-image-state="failure"], [data-ref-state="refused"] [data-tone="error"]')).toHaveCount(1);
  await expect(page.locator('[data-ref-state="refused"]')).toContainText(/browser framework|no such package/);
});

test.describe("a remote with many tags, without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("lists branches and the highest-numbered tags, finds the rest by name, and shows the one chosen", async ({ page, db, sourcesDir }) => {
    await ordersPortal(db, sourcesDir);
    const remote = path.join(sourcesDir, "orders-web");
    for (let index = 0; index < 30; index += 1) git(remote, ["tag", `v1.0.${index}`]);
    await page.goto(preview);
    const choice = page.getByRole("combobox", { name: "Branch or tag" });
    await expect(choice.locator("option")).toHaveCount(1 + 1 + 20);
    await expect(choice.locator("optgroup[label='Tags'] option").first()).toHaveText("v1.0.29");
    await expect(page.getByRole("status").filter({ hasText: "The list has every branch and the highest-numbered 20 of 31 tags." })).toBeVisible();

    const finder = page.getByRole("search", { name: "Find a branch or tag" });
    await finder.getByRole("searchbox", { name: "Find a branch or tag" }).fill("v1.0.3");
    await finder.getByRole("button", { name: "Find" }).click();
    await expect(page).toHaveURL(/find=v1\.0\.3/);
    await expect(page.getByRole("status").filter({ hasText: "1 branch or tag matches “v1.0.3”." })).toBeVisible();
    await expect(choice.locator("optgroup[label='Tags'] option")).toHaveText(["v1.0.3"]);
    // The ref shown stays choosable once the search is cleared.
    await choice.selectOption("refs/tags/v1.0.3");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/ref=refs%2Ftags%2Fv1\.0\.3/);
    await expect(choice).toHaveValue("refs/tags/v1.0.3");
  });
});

test.describe("the controls and the browser window", () => {
  test("names each icon control with a tooltip on focus, and frames the build in a centered window with equal padding", async ({ page, db, sourcesDir }) => {
    await ordersPortal(db, sourcesDir);
    await page.goto(preview);
    await framed(page);
    const tablet = page.getByRole("group", { name: "Device" }).getByRole("button", { name: "Tablet" });
    await tablet.focus();
    await expect(page.getByRole("tooltip", { name: "Tablet" })).toBeVisible();
    await expect(tablet).toHaveAttribute("aria-pressed", "false");
    const bar = page.locator("[data-title-bar]");
    await expect(bar).toHaveAttribute("aria-hidden", "true");
    const container = page.locator("[data-preview-container]");
    const [top, right, bottom, left] = await container.evaluate((element) => ["top", "right", "bottom", "left"].map((side) => getComputedStyle(element).getPropertyValue(`padding-${side}`)));
    expect([right, bottom, left]).toEqual([top, top, top]);
  });

  test("keeps preview mode inside a 375px viewport, with every control reachable", async ({ page, db, sourcesDir }) => {
    await ordersPortal(db, sourcesDir);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(preview);
    await framed(page);
    await expectNoHorizontalOverflow(page);
    for (const control of [backButton(page), page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Code" }), page.getByRole("combobox", { name: "Branch or tag" }), landscape(page), page.getByRole("link", { name: /Open full screen/ })]) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
  });
});

test.describe("mock sets in preview mode (add-mock-sets, task 11.1)", () => {
  const line = (page: Page) => page.locator("[data-mock-line]");
  const shown = (page: Page) => page.frameLocator("[data-preview-frame]");
  const recentOrders = (page: Page) => shown(page).getByRole("region", { name: "Recent orders" });

  test("applies the application's default before the frame loads, naming it above the window (The default set in preview mode)", async ({ page, db }) => {
    ordersPortalRemote();
    const { application } = await buildOrdersPortal(db);
    seedMockSet(db, application.slug, ORDERS_HAPPY_PATH, { default: true });
    await page.goto(paths.applicationPreview(application.slug));
    await expect(recentOrders(page).locator("[data-recent-orders] li").first()).toHaveText("Order 1001 · Northwind Traders · Open · $1,280");
    await expect(line(page)).toHaveText("Mock set: Happy path. Change it with Data in full screen.");
    // The line is text above the browser window, outside the control row.
    expect(await line(page).evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector("[data-browser-window]")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  });

  test("shows no line, and every call goes to its own address, with no set (No set)", async ({ page, db }) => {
    ordersPortalRemote();
    const { application } = await buildOrdersPortal(db);
    await page.goto(paths.applicationPreview(application.slug));
    await expect(recentOrders(page)).toContainText("Recent orders unavailable");
    await expect(line(page)).toHaveCount(0);
  });

  test("an unsaved branch applies the tracked branch's set", async ({ page, db }) => {
    ordersPortalRemote();
    const { application } = await buildOrdersPortal(db);
    seedMockSet(db, application.slug, ORDERS_HAPPY_PATH, { default: true });
    await page.goto(paths.applicationPreview(application.slug));
    await expect(recentOrders(page).locator("[data-recent-orders] li")).toHaveCount(5);
    await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/heads/feature/new-nav");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/ref=refs%2Fheads%2Ffeature%2Fnew-nav/);
    await settle(db);
    await expect(shown(page).getByText("Orders portal · New navigation")).toBeVisible({ timeout: 30_000 });
    await expect(recentOrders(page).locator("[data-recent-orders] li")).toHaveCount(5);
    await expect(line(page)).toHaveText("Mock set: Happy path. Change it with Data in full screen.");
  });

  test("says the set can't apply beside the build's own service worker (The build's own service worker)", async ({ page, db }) => {
    const { desk } = await buildQuotes(db, { saved: false });
    seedMockSet(db, desk.application.slug, [{ pattern: "/v1/desk", responses: [{ json: { name: "FX desk" } }] }], { default: true });
    await page.goto(paths.applicationPreview(desk.application.slug));
    await expect(shown(page).locator("[data-desk-name]")).toHaveText("Desk: FX desk");
    await shown(page)
      .locator(":root")
      .evaluate(async () => {
        await navigator.serviceWorker.register("sw.js");
        await navigator.serviceWorker.ready;
      });
    await page.reload();
    await expect(line(page)).toHaveText("Mock set: Happy path. Mock sets can't apply beside the application's own service worker for its build's path.");
    await expect(shown(page).locator("[data-desk-name]")).toHaveText("Desk name unavailable");
  });
});
