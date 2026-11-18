import type { Frame, Page } from "@playwright/test";
import { templateBySlug } from "../src/lib/demo/catalog";
import { startComment, waitForRegions } from "./support/demo";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";

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
  await expect(pressed(page, group)).toHaveAccessibleName(name);
}

const sidebar = (page: Page) => page.locator("#sidebar");
const backButton = (page: Page) => page.locator("[data-shell-header]").getByRole("link", { name: "Back to Payments workspace" });
const landscape = (page: Page) => page.getByRole("button", { name: "Landscape" });

test.describe("the focused page", () => {
  test("hides a stored, shown sidebar from the first paint, with one heading hidden on screen", async ({ page, db: _db, baseURL }) => {
    await page.context().addCookies([{ name: "fabricate-sidebar-width", value: "320", url: baseURL! }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    // The server's first response already hides the sidebar.
    const html = await (await page.request.get("/templates/payments-workspace/preview")).text();
    expect(html).toContain('data-shell-header="focused"');
    await page.goto("/templates/payments-workspace/preview");
    await expect(sidebar(page)).toBeHidden();
    await expect(backButton(page)).toBeVisible();
    await expect(backButton(page)).toHaveAttribute("title", "Back to Payments workspace");
    await expect(page.locator("[data-shell-header]").getByRole("button", { name: "Show sidebar" })).toHaveCount(0);
    const headings = page.getByRole("heading", { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText("Preview Payments workspace");
    expect((await headings.boundingBox())!.width).toBeLessThanOrEqual(1);
    await expect(page.locator("[data-page-header]")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
    // The content takes the whole width.
    await expect.poll(async () => (await page.locator("main").boundingBox())!.x).toBe(0);
  });

  test("keeps the stored sidebar state, which the template page shows again", async ({ page, db: _db, baseURL }) => {
    await page.context().addCookies([{ name: "fabricate-sidebar-width", value: "320", url: baseURL! }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/templates/payments-workspace/preview");
    await expect(sidebar(page)).toBeHidden();
    await backButton(page).click();
    await expect(page).toHaveURL(/\/templates\/payments-workspace$/);
    await expect(sidebar(page)).toBeVisible();
    await expect.poll(async () => (await sidebar(page).boundingBox())!.width).toBe(320);
    await expect(page.locator("[data-shell-header]").getByRole("button", { name: "Show sidebar" })).toBeHidden();
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === "fabricate-sidebar")).toBeUndefined();
    expect(cookies.find((cookie) => cookie.name === "fabricate-sidebar-width")?.value).toBe("320");
  });

  test("offers the back button in place of Open navigation on a narrow viewport", async ({ page, db: _db }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/templates/payments-workspace/preview");
    await expect(backButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(sidebar(page)).toBeHidden();
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("goes back to the template, and turns the device to landscape", async ({ page, db: _db }) => {
      await page.goto("/templates/payments-workspace/preview?device=tablet");
      await expect(sidebar(page)).toBeHidden();
      await expect(landscape(page)).toHaveAttribute("aria-pressed", "false");
      await landscape(page).click();
      await expect(page).toHaveURL(/device=tablet&orientation=landscape/);
      await expect(landscape(page)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-frame-size]")).toHaveText("1180 × 820");
      await backButton(page).click();
      await expect(page).toHaveURL(/\/templates\/payments-workspace$/);
      await expect(page.getByRole("heading", { level: 1, name: "Payments workspace" })).toBeVisible();
    });
  });
});

test("goes back to the template from preview mode", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview");
  await backButton(page).click();
  await expect(page).toHaveURL(/\/templates\/payments-workspace$/);
});

test("opens from Preview template in the same tab, on the Preview tab with the Desktop device in landscape", async ({ page, db: _db }) => {
  await page.goto("/templates/market-watch");
  await page.getByRole("link", { name: "Preview template" }).click();
  await expect(page).toHaveURL(/\/templates\/market-watch\/preview$/);
  await expect(page).toHaveTitle("Preview Market watch · DE FabLab");
  // A focused page: no breadcrumbs, description, or visible title.
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expect(page.locator("[data-page-header]")).toHaveCount(0);
  await expect(page.locator("[data-shell-header]").getByRole("link", { name: "Back to Market watch" })).toHaveAttribute("href", "/templates/market-watch");

  await expect(page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Preview" })).toHaveAttribute("aria-current", "page");
  await expect(pressed(page, "Device")).toHaveAccessibleName("Desktop");
  await expect(landscape(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-scaffold-command]")).toContainText("npx @deweb/create-app@latest my-app --template market-watch");
  await expect(page.getByRole("link", { name: "Deploy template" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open full screen/ })).toBeVisible();
  // The command sits above the tabs.
  const [command, tabs] = [(await page.locator("[data-scaffold-command]").boundingBox())!, (await page.getByRole("navigation", { name: "Preview mode" }).boundingBox())!];
  expect(command.y + command.height).toBeLessThanOrEqual(tabs.y);

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
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/templates/market-watch/preview");
  await choose(page, "Device", "Tablet");
  await expect(landscape(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-frame-size]")).toHaveText("820 × 1180");
  await landscape(page).click();
  await expect(landscape(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/device=tablet&orientation=landscape/);
  await expect(page.locator("[data-frame-size]")).toHaveText("1180 × 820");
  await expect(frameElement(page)).toHaveAttribute("title", "Market watch on Tablet, Landscape");
  const frame = await framed(page);
  expect(await frame.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1180, 820]);
  // The page's content is at most 1200px wide, so inside the container's padding the tablet is scaled down a little, still laid out at 1180px.
  const shown = (await frameElement(page).boundingBox())!.width;
  expect(shown).toBeLessThanOrEqual(1180);
  expect(shown).toBeGreaterThan(1100);
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
  await expect(page.getByRole("navigation", { name: "Files" })).toBeVisible();
  await expect(frameElement(page)).toHaveCount(0);
  // The Preview tab brings back the device kept in the address.
  await page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Preview" }).click();
  await expect(pressed(page, "Device")).toHaveAccessibleName("Mobile");
  await expect(landscape(page)).toHaveAttribute("aria-pressed", "false");
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

  // A hero's source is its reference deployment's real Salt, at each microfrontend's default version.
  await files.getByRole("link", { name: "src/payee-list.tsx" }).click();
  await expect(page.getByRole("figure", { name: "src/payee-list.tsx" })).toContainText('from "@salt-ds/core"');
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
  await expect(full.getByRole("complementary", { name: "Toolbar", exact: true })).toBeVisible();
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
  await startComment(full);
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
  await expect(theirs.getByRole("complementary", { name: "Toolbar", exact: true })).toBeVisible();
  await expect(theirs.locator("[data-comment-pin]")).toHaveCount(0);
  await expect(theirs.getByRole("button", { name: /^Open toolbar menu/ })).toHaveAccessibleName("Open toolbar menu");
  await other.close();
});

test.describe("the icon controls", () => {
  test("names each control, reports its state, and shows its name as a tooltip on keyboard focus", async ({ page, db: _db }) => {
    await page.goto("/templates/payments-workspace/preview");
    const devices = page.getByRole("group", { name: "Device" }).getByRole("button");
    expect(await devices.evaluateAll((buttons) => buttons.map((button) => [button.getAttribute("aria-label"), button.getAttribute("aria-pressed"), button.textContent?.trim()]))).toEqual([
      ["Mobile", "false", ""],
      ["Tablet", "false", ""],
      ["Desktop", "true", ""],
    ]);
    const tablet = page.getByRole("group", { name: "Device" }).getByRole("button", { name: "Tablet" });
    await page.getByRole("button", { name: "Mobile" }).focus();
    await page.keyboard.press("Tab");
    await expect(tablet).toBeFocused();
    await expect(tablet).toHaveAccessibleName("Tablet");
    await expect(tablet).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("tooltip", { name: "Tablet" }).or(page.getByRole("tooltip").filter({ hasText: /^Tablet$/ }))).toBeVisible();
    for (const [name, tip] of [
      ["Landscape", "Landscape"],
      [/Open full screen/, "Open full screen"],
    ] as const) {
      const control = page.getByRole(name === "Landscape" ? "button" : "link", { name });
      await control.hover();
      await expect(page.getByRole("tooltip").filter({ hasText: new RegExp(`^${tip}$`) })).toBeVisible();
    }
  });

  test("leaves the device, Landscape, and full-screen controls off the Code tab", async ({ page, db: _db }) => {
    await page.goto("/templates/payments-workspace/preview");
    await page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Code" }).click();
    await expect(page.getByRole("navigation", { name: "Files" })).toBeVisible();
    await expect(page.locator("[data-scaffold-command]")).toBeVisible();
    const [command, tabs] = [(await page.locator("[data-scaffold-command]").boundingBox())!, (await page.getByRole("navigation", { name: "Preview mode" }).boundingBox())!];
    expect(command.y + command.height).toBeLessThanOrEqual(tabs.y);
    await expect(page.getByRole("group", { name: "Device" })).toHaveCount(0);
    await expect(landscape(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Open full screen/ })).toHaveCount(0);
  });
});

test.describe("the browser window", () => {
  const container = (page: Page) => page.locator("[data-preview-container]");
  const paddings = (page: Page) => container(page).evaluate((element) => ["top", "right", "bottom", "left"].map((side) => getComputedStyle(element).getPropertyValue(`padding-${side}`)));

  test("frames the application with the reference address, centered in a gray container with equal padding", async ({ page, db: _db }) => {
    await page.goto("/templates/payments-workspace/preview");
    await framed(page);
    const bar = page.locator("[data-title-bar]");
    await expect(bar).toHaveAttribute("aria-hidden", "true");
    await expect(bar).toContainText("https://payments-workspace-preview.deweb.example");
    expect(await bar.evaluate((element) => element.querySelectorAll("span > span:empty").length)).toBe(3);
    expect(await bar.evaluate((element) => element.querySelectorAll("a, button, input, [tabindex]").length)).toBe(0);
    expect(await bar.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
    const [top, right, bottom, left] = await paddings(page);
    expect([right, bottom, left]).toEqual([top, top, top]);
    expect(top).toBe("24px");
    // Centered: equal space on either side of the window.
    const [outer, window] = [(await container(page).boundingBox())!, (await page.locator("[data-browser-window]").boundingBox())!];
    expect(Math.abs(window.x - outer.x - (outer.x + outer.width - window.x - window.width))).toBeLessThan(2);
  });

  test("scales the window and the frame together inside the container's padding", async ({ page, db: _db }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/templates/payments-workspace/preview");
    await framed(page);
    await expect(page.getByText(/^Shown at \d+%$/)).toBeVisible();
    const [outer, window, frame] = [(await container(page).boundingBox())!, (await page.locator("[data-browser-window]").boundingBox())!, (await frameElement(page).boundingBox())!];
    expect(window.x).toBeGreaterThanOrEqual(outer.x + 24 - 1);
    expect(window.x + window.width).toBeLessThanOrEqual(outer.x + outer.width - 24 + 1);
    expect(Math.abs(frame.width - (window.width - 2))).toBeLessThan(2);
    const [top, right, bottom, left] = await paddings(page);
    expect([right, bottom, left]).toEqual([top, top, top]);
  });

  test("keeps preview mode inside a 375px viewport, wrapping its rows, with every control reachable", async ({ page, db: _db }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/templates/payments-workspace/preview");
    await framed(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    for (const control of [
      page.locator("[data-shell-header]").getByRole("link", { name: "Back to Payments workspace" }),
      page.getByRole("button", { name: "Copy command" }),
      page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Code" }),
      page.getByRole("group", { name: "Device" }).getByRole("button", { name: "Mobile" }),
      landscape(page),
      page.getByRole("link", { name: /Open full screen/ }),
    ]) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
    const [top, right, bottom, left] = await paddings(page);
    expect([right, bottom, left]).toEqual([top, top, top]);
    expect(top).toBe("12px");
  });
});
