import type { Frame, Page } from "@playwright/test";
import { templateBySlug } from "../src/lib/demo/catalog";
import { waitForRegions } from "./support/demo";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { expectCurrentItem } from "./support/shell";

/** Preview mode (template-preview spec). */

const frameElement = (page: Page) => page.locator("[data-preview-frame]");
const pressed = (page: Page, group: string) => page.getByRole("group", { name: group }).locator('[aria-pressed="true"]');

/** The running reference deployment inside the device frame, once its regions have loaded. */
async function framed(page: Page): Promise<Frame> {
  await expect(frameElement(page)).toBeVisible();
  const frame = (await frameElement(page).elementHandle())!;
  const content = (await frame.contentFrame())!;
  await content.waitForSelector("[data-demo-mfe]");
  await content.waitForFunction(() => !document.querySelector('[data-demo-mfe]:not([data-demo-state="ready"])'), null, { timeout: 10_000 });
  return content;
}

async function choose(page: Page, group: string, name: string) {
  await page.getByRole("group", { name: group }).getByRole("button", { name }).click();
  await expect(pressed(page, group)).toHaveText(name);
}

test("Section in preview mode: the Salt Patterns sub-menu marks All Salt Patterns, and the first breadcrumb is Salt Patterns", async ({ page, db: _db }) => {
  await page.goto("/templates/market-watch/preview");
  await expectCurrentItem(page, "Salt Patterns", "All Salt Patterns");
  const crumbs = page.locator("[data-page-header]").getByRole("navigation", { name: "Breadcrumb" }).getByRole("link");
  await expect(crumbs.first()).toHaveText("Salt Patterns");
  await expect(crumbs.first()).toHaveAttribute("href", "/templates");
});

test("opens from Preview template in the same tab, on the Preview tab with the Desktop device in landscape", async ({ page, db: _db }) => {
  await page.goto("/templates/market-watch");
  await page.getByRole("link", { name: "Preview template" }).click();
  await expect(page).toHaveURL(/\/templates\/market-watch\/preview$/);
  await expect(page).toHaveTitle("Preview Market watch · DE FabLab");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Market watch" })).toHaveAttribute("href", "/templates/market-watch");

  await expect(page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Preview" })).toHaveAttribute("aria-current", "page");
  await expect(pressed(page, "Device")).toHaveText("Desktop");
  await expect(pressed(page, "Orientation")).toHaveText("Landscape");
  await expect(page.locator("[data-scaffold-command]")).toContainText("npx @deweb/create-app@latest my-app --template market-watch");
  await expect(page.getByRole("link", { name: "Deploy template" })).toHaveAttribute("href", "/templates/market-watch/deploy");
  await expect(page.getByRole("link", { name: /Open full screen/ })).toBeVisible();

  await expect(frameElement(page)).toHaveAttribute("title", "Market watch on Desktop, Landscape");
  await expect(page.locator("[data-frame-size]")).toHaveText("1440 × 900");
  const frame = await framed(page);
  await expect(frame.locator("[data-demo-portal]")).toHaveAttribute("data-brand", "markets");
  // The 1440px desktop is wider than the space here, so it is scaled down to fit, still laid out at 1440px.
  expect(await frame.evaluate(() => window.innerWidth)).toBe(1440);
  expect((await frameElement(page).boundingBox())!.width).toBeLessThan(1440);
  await expect(page.getByText(/^Shown at \d+%$/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("lays the application out at the tablet's size in landscape", async ({ page, db: _db }) => {
  // Wide enough for the 1180px tablet beside the sidebar, so it is shown at full size.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/templates/market-watch/preview");
  await choose(page, "Device", "Tablet");
  await expect(pressed(page, "Orientation")).toHaveText("Portrait");
  await expect(page.locator("[data-frame-size]")).toHaveText("820 × 1180");
  await choose(page, "Orientation", "Landscape");
  await expect(page).toHaveURL(/device=tablet&orientation=landscape/);
  await expect(page.locator("[data-frame-size]")).toHaveText("1180 × 820");
  await expect(frameElement(page)).toHaveAttribute("title", "Market watch on Tablet, Landscape");
  const frame = await framed(page);
  expect(await frame.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1180, 820]);
  // The tablet fits the space here, so it is shown at full size.
  expect(Math.round((await frameElement(page).boundingBox())!.width)).toBe(1180);
  await expect(page.getByText(/^Shown at \d+%$/)).toHaveCount(0);
});

test("uses the application's narrow layout on Mobile without the page overflowing", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview");
  await choose(page, "Device", "Mobile");
  await expect(page.locator("[data-frame-size]")).toHaveText("390 × 844");
  const frame = await framed(page);
  expect(await frame.evaluate(() => [window.innerWidth, window.matchMedia("(max-width: 767px)").matches])).toEqual([390, true]);
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
});

test("shows the application in the frame without the toolbar, even after navigating inside it", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview");
  const frame = await framed(page);
  await expect(frame.locator("[data-demo-portal]")).toHaveAttribute("data-demo-embedded", "true");
  await expect(frame.locator("[data-demo-toolbar]")).toHaveCount(0);
  await frame.locator('[data-demo-anchor="nav-activity"]').click();
  await frame.waitForURL(/\/run\/ref-payments-workspace\/activity\?embed=1$/);
  await expect(frame.locator('[data-demo-mfe="payment-activity"]')).toBeVisible();
  await expect(frame.locator("[data-demo-toolbar]")).toHaveCount(0);
});

test("keeps the tab, device, and orientation across a reload", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview?view=code&device=mobile");
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Code" })).toHaveAttribute("aria-current", "page");
  await expect(pressed(page, "Device")).toHaveText("Mobile");
  await expect(pressed(page, "Orientation")).toHaveText("Portrait");
  await expect(page.getByRole("navigation", { name: "Files" })).toBeVisible();
  await expect(frameElement(page)).toHaveCount(0);
});

test("reads the template's files, with microfrontends.json listing the group", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview");
  await page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Code" }).click();
  const files = page.getByRole("navigation", { name: "Files" });
  await expect(files.getByRole("link", { name: "package.json" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("figure", { name: "package.json" })).toContainText('"name": "payments-workspace"');

  await files.getByRole("link", { name: "microfrontends.json" }).click();
  await expect(page).toHaveURL(/view=code&file=microfrontends.json/);
  const source = page.getByRole("figure", { name: "microfrontends.json" });
  await expect(source).toContainText('"payments-shell": {');
  await expect(source).toContainText('"default": true');
  for (const text of ['"payee-list"', '"/payees"', '"transfer-form"', '"slot": "Sidebar"', '"payment-activity"', '"/activity"']) await expect(source).toContainText(text);
  // Line numbers, and a copy control for the file.
  await expect(source.getByRole("button", { name: "Copy lines" })).toBeVisible();

  await files.getByRole("link", { name: "apps/payee-list/src/index.tsx" }).click();
  await expect(page.getByRole("figure", { name: "apps/payee-list/src/index.tsx" })).toContainText("Payee list 1.4.2");
});

test("copies the exact scaffold command", async ({ page, context, db: _db }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/templates/payments-workspace/preview");
  await page.locator("[data-scaffold-command]").getByRole("button", { name: "Copy command" }).click();
  await expect(page.locator("[data-scaffold-command]").getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npx @deweb/create-app@latest my-app --template payments-workspace");
});

test("opens full screen in a new tab with the toolbar, at the route shown in the frame", async ({ page, context, db: _db }) => {
  const template = templateBySlug("client-onboarding")!;
  await page.goto("/templates/client-onboarding/preview");
  await framed(page);
  const [full] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: /Open full screen/ }).click()]);
  await full.waitForLoadState("domcontentloaded");
  expect(new URL(full.url()).pathname).toBe(`/run/ref-client-onboarding/${template.app.routes[0]!.path}`);
  await waitForRegions(full);
  await expect(full.getByRole("complementary", { name: "Demo toolbar" })).toBeVisible();
  await full.close();

  // After navigating inside the frame, full screen opens that route.
  const frame = await framed(page);
  const second = template.app.routes[1]!;
  await frame.locator(`[data-demo-anchor="nav-${second.path}"]`).click();
  await frame.waitForURL(new RegExp(`/${second.path}\\?embed=1$`));
  const [again] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: /Open full screen/ }).click()]);
  await again.waitForLoadState("domcontentloaded");
  expect(new URL(again.url()).pathname).toBe(`/run/ref-client-onboarding/${second.path}`);
  await again.close();
});

test("keeps a visitor's comments on a reference deployment private to their workspace", async ({ page, context, browser, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview");
  const [full] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: /Open full screen/ }).click()]);
  await waitForRegions(full);
  await full.keyboard.press("c");
  await full.locator('[data-demo-anchor="send-payment"]').click();
  const composer = full.getByRole("dialog", { name: "New comment" });
  await composer.getByLabel("Your name").fill("Sam Rivera");
  await composer.getByLabel("Comment", { exact: true }).fill("Only my workspace sees this");
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(full.locator('[data-comment-pin="1"]')).toBeVisible();

  // A second visitor, in another browser, opens the same template full screen.
  const other = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const visitor = await other.newPage();
  await visitor.goto("/templates/payments-workspace/preview");
  const [theirs] = await Promise.all([other.waitForEvent("page"), visitor.getByRole("link", { name: /Open full screen/ }).click()]);
  await waitForRegions(theirs);
  await expect(theirs.getByRole("complementary", { name: "Demo toolbar" })).toBeVisible();
  await expect(theirs.locator("[data-comment-pin]")).toHaveCount(0);
  await expect(theirs.getByRole("button", { name: "Open comments" })).not.toContainText("1");
  await other.close();
});
