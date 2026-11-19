import fs from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { getApplication } from "../src/lib/applications/records";
import type { Db } from "../src/lib/db/client";
import { git } from "../test/support/git-fixture";
import { SCALA_SERVICE, offlineViteApp } from "../test/support/preview-trees";
import { onboarded, registered } from "./support/applications";
import { E2E_PREVIEWS } from "./support/env";
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
