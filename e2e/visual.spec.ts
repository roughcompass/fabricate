import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalOverflow, expectNoNestedBorders, expectNoOverlappingContent, test } from "./support/fixtures";
import { openTool } from "./support/toolbar";
import { buildOrdersPortal, framedRun, ordersPortalRemote } from "./support/fixture-app";
import { ORDERS_HAPPY_PATH, seedMockSet } from "./support/mock-sets";
import { application, runOrdersPortal, waitForPage } from "./support/running-app";
import { applicationSurfaces, importReviewSurface, seedOperatorSurfaces } from "./support/surfaces";
import { paths } from "./support/paths";
import { useTheme } from "./support/shell";
import { storeEntry } from "../src/lib/catalog/entries";
import { createPreset } from "../src/lib/workspaces/presets";
import { setDisplayName } from "../src/lib/workspaces/workspaces";
import { buildQuotes } from "./support/quotes-fixtures";
import { workspaceOf } from "./support/running-app";
import { buildRepository } from "../test/support/builders";
import { saltEntry } from "../test/support/catalog";
import { manifest } from "../test/support/profiles";
import { seedSurvey } from "../test/support/scenarios";

/**
 * Captures every product surface at desktop and mobile width, in the light and
 * dark themes, after checking each for overflow, overlapping content, and
 * nested bordered containers. Run with `npm run test:visual`; screenshots are
 * written to verification/screenshots.
 */

const OUTPUT = path.resolve("verification/screenshots");
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];
const THEMES = ["light", "dark"] as const;

test.skip(!process.env.CAPTURE_SCREENSHOTS, "Set CAPTURE_SCREENSHOTS=1 (npm run test:visual) to capture screenshots.");
// Tracing dispatches an event of its own on each page, which Settings' event bus would log in its captures.
test.use({ trace: "off" });

/**
 * Waits until React has hydrated the page's title. A screenshot hides the
 * caret with an inline style on the focused field, such as an autofocused
 * one, and a capture taken before hydration would make React report it as a
 * hydration mismatch.
 */
const hydrated = (page: Page) => page.waitForFunction(() => Object.keys(document.querySelector("h1") ?? {}).some((key) => key.startsWith("__reactFiber$")));

/**
 * Waits for every running transition and animation to finish. Reduced motion
 * shortens them to almost nothing, but a capture taken in the same frame as a
 * state change can still show a control between two states, such as a pill
 * button already filled and its icon not yet recolored.
 */
const settled = (page: Page) =>
  page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    // An icon drawn in currentColor repaints a frame or two after its button's color settles.
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
  });

/**
 * Loads every image now, the lazy ones below the fold too, which a full-page
 * capture never scrolls to. It waits until React has hydrated every image
 * first: the title can hydrate before a later part of the page, and an
 * image's loading attribute changed before its part hydrates no longer
 * matches the server's HTML.
 */
const loadImages = async (page: Page) => {
  await page.waitForFunction(() => [...document.images].every((image) => Object.keys(image).some((key) => key.startsWith("__reactFiber$"))));
  await page.evaluate(async () => {
    const images = [...document.images];
    for (const image of images) image.loading = "eager";
    const settled = (image: HTMLImageElement) =>
      new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    await Promise.all(images.map((image) => (image.complete ? null : settled(image))));
  });
};

/** The tallest image the JPEG encoder takes, in pixels; a taller page is captured in parts of PART pixels. */
const JPEG_MAX_HEIGHT = 65_535;
const PART = 32_000;

/** Captures the whole page to +file+, or, when it's too tall for one JPEG, to +file+-part1.jpg, -part2.jpg, and so on. Returns the files written. */
async function captureFullPage(page: Page, file: string): Promise<string[]> {
  await settled(page);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  if (height <= JPEG_MAX_HEIGHT) {
    await page.screenshot({ path: file, fullPage: true, type: "jpeg", quality: 75 });
    return [file];
  }
  const { width } = page.viewportSize()!;
  const files: string[] = [];
  for (let top = 0; top < height; top += PART) {
    const part = file.replace(/\.jpg$/, `-part${files.length + 1}.jpg`);
    await page.screenshot({ path: part, fullPage: true, clip: { x: 0, y: top, width, height: Math.min(PART, height - top) }, type: "jpeg", quality: 75 });
    files.push(part);
  }
  return files;
}

test.setTimeout(600_000);

test("captures every product surface at desktop and mobile width, in both themes", async ({ page, db, sourcesDir, baseURL }) => {
  // The surfaces, then the System status and Adoption pages, which read the Reference Catalog's Salt entry and the surfaces' Profiles, and Bitbucket tokens.
  storeEntry(db, saltEntry());
  const surfaces = [
    ...(await seedOperatorSurfaces(db, sourcesDir)),
    ...(await applicationSurfaces(db, sourcesDir)),
    importReviewSurface(db, (await workspaceOf(page.context(), db)).id),
    ["10-system", "/admin/system"],
    ["10-bitbucket-tokens", "/admin/bitbucket-tokens"],
    ["10-adoption", "/adoption"],
    ["10-adoption-salt", "/adoption/design-systems/salt"],
    ["10-adoption-button", "/adoption/design-systems/salt/components/Button"],
    ["10-adoption-package", "/adoption/packages/@salt-ds/core"],
  ] as const;

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  const written: string[] = [];
  let captured = 0;
  for (const theme of THEMES) {
    await useTheme(page.context(), theme, baseURL!);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(url);
        // The development server's floating indicator is not part of the product.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await hydrated(page);
        // Applications' cards and pages show screenshots, lazily below the fold.
        await loadImages(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await expectNoNestedBorders(page);
        written.push(...(await captureFullPage(page, path.join(OUTPUT, `${name}-${viewport.name}-${theme}.jpg`))));
        captured += 1;
      }
    }
  }
  expect(captured).toBe(surfaces.length * VIEWPORTS.length * THEMES.length);
  expect(fs.readdirSync(OUTPUT).sort()).toEqual(written.map((file) => path.basename(file)).sort());
});

/**
 * Captures the shell's own states in both themes: the sidebar hidden and the
 * primary menu on a desktop, and the drawer open on a phone.
 */
test("captures the shell's sidebar states in both themes", async ({ page, db: _db, baseURL }) => {
  const output = path.join(OUTPUT, "shell");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const capture = async (name: string, theme: string) => {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expectNoHorizontalOverflow(page);
    await settled(page);
    await page.screenshot({ path: path.join(output, `${name}-${theme}.jpg`), type: "jpeg", quality: 75 });
  };
  for (const theme of THEMES) {
    await useTheme(page.context(), theme, baseURL!);

    await page.setViewportSize(VIEWPORTS[0]!);
    await page.context().addCookies([{ name: "frontend-registry-sidebar", value: "hidden", url: baseURL! }]);
    await page.goto(paths.assessments);
    await expect(page.locator("#sidebar")).toBeHidden();
    await capture("sidebar-hidden-desktop", theme);
    await page.context().clearCookies({ name: "frontend-registry-sidebar" });

    await page.goto(paths.home);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Applications", exact: true })).toBeVisible();
    await capture("menu-desktop", theme);

    await page.setViewportSize(VIEWPORTS[1]!);
    await page.goto(paths.repositories);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await capture("drawer-open-mobile", theme);
  }
  expect(fs.readdirSync(output)).toHaveLength(3 * THEMES.length);
});

/**
 * Captures the marketing page's hero picture (product-site spec, "Hero"): a
 * real Profile, surveyed from seeded data against the Salt entry, open at its
 * Design system view, with one fact's evidence shown, in both themes. The
 * page serves the captures from public/site/, so they always show the
 * current release. Run alone with
 * `CAPTURE_SCREENSHOTS=1 npx playwright test e2e/visual.spec.ts -g "marketing page"`.
 */
test("captures the marketing page's Profile picture in both themes", async ({ page, db, baseURL }) => {
  storeEntry(db, saltEntry());
  const repository = buildRepository(db, { name: "payments-ui" });
  await seedSurvey(db, repository, { files: HERO_APP });
  const output = path.resolve("public/site");
  fs.mkdirSync(output, { recursive: true });
  for (const theme of THEMES) {
    await useTheme(page.context(), theme, baseURL!);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.context().addCookies([{ name: "frontend-registry-sidebar", value: "hidden", url: baseURL! }]);
    await page.goto(`/repositories/${repository.publicId}?tab=design-system`);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    const components = page.getByRole("row").filter({ hasText: "Salt component" }).filter({ hasText: "Button" }).first();
    await components.getByRole("button", { name: /^Show \d+ locations?$/ }).click();
    await expect(page.getByRole("link", { name: "src/Payments.tsx:5" })).toBeVisible();
    // The page's header and the design systems it uses, beside the evidence.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await settled(page);
    await page.screenshot({ path: path.join(output, `profile-${theme}.jpg`), type: "jpeg", quality: 80 });
    await page.context().clearCookies({ name: "frontend-registry-sidebar" });
  }
  expect(fs.readdirSync(output).sort()).toEqual(["profile-dark.jpg", "profile-light.jpg"]);
});

/** A Salt application for the hero's Profile: its theme and provider, components with props, a raw element, and a story. */
const HERO_APP = {
  "package.json": manifest({ name: "payments-ui", version: "2.4.0", dependencies: { "@salt-ds/core": "1.75.0", "@salt-ds/theme": "1.48.0", react: "19.3.1", "react-dom": "19.3.1" } }),
  "src/main.tsx": 'import "@salt-ds/theme/index.css";\nimport { SaltProvider } from "@salt-ds/core";\nimport { Payments } from "./Payments";\nexport const Root = () => <SaltProvider mode="light"><Payments /></SaltProvider>;\n',
  "src/Payments.tsx":
    'import { Button, StackLayout, Text } from "@salt-ds/core";\nexport const Payments = () => (\n  <StackLayout gap={2}>\n    <Text>Pending payments</Text>\n    <Button appearance="solid" sentiment="accented">Approve</Button>\n    <Button appearance="bordered">Hold</Button>\n    <button className="link">Export</button>\n  </StackLayout>\n);\n',
  "src/payments.css": ".link { padding: var(--salt-spacing-100); color: #0a6; }\n",
  "src/Payments.stories.tsx": 'import { Button } from "@salt-ds/core";\nexport const Approve = () => <Button appearance="solid">Approve</Button>;\n',
};

/**
 * Captures the fixture application running with each toolbar tool open, with
 * the toolbar in each operator theme.
 */
test("captures each toolbar tool over a running application, in both operator themes", async ({ page, context, db, baseURL }) => {
  test.setTimeout(240_000);
  const output = path.join(OUTPUT, "toolbar");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const tools: [id: string, dialog: string][] = [
    ["accessibility", "Accessibility"],
    ["timing", "Timing"],
    ["share", "Share"],
    ["comments", "Comments"],
    ["microfrontends", "Microfrontends"],
    ["session", "Session"],
    ["settings", "Settings"],
  ];
  await page.setViewportSize({ width: 1280, height: 900 });
  const running = await runOrdersPortal(page, db);
  // One comment, so the comments list and a pin show.
  await page.keyboard.press("c");
  await application(page).getByRole("button", { name: "Export orders" }).click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  await composer.getByLabel("Your name").fill("Sam Rivera");
  await composer.getByLabel("Comment", { exact: true }).fill("Can this use the shared component?");
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(composer).toBeHidden();
  for (const theme of THEMES) {
    await useTheme(context, theme, baseURL!);
    await page.goto(framedRun(running, "/accounts"));
    await waitForPage(page, "Accounts");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    for (const [name, dialog] of tools) {
      await openTool(page, name);
      const panel = page.getByRole("dialog", { name: dialog });
      await expect(panel).toBeVisible();
      if (name === "accessibility") {
        await panel.getByRole("button", { name: /Run audit/ }).click();
        await expect(panel.locator("[data-audit-result]").first()).toBeVisible();
      }
      if (name === "share") await expect(panel.getByLabel("Link to this view")).toBeVisible();
      await settled(page);
      await page.screenshot({ path: path.join(output, `orders-portal-${name}-${theme}.jpg`), type: "jpeg", quality: 75 });
    }
    await page.keyboard.press("Escape");

    // Timing's hot spots: the planted slow button, outlined and ranked.
    await application(page).getByRole("button", { name: "Recalculate totals" }).click();
    await expect(application(page).getByText("Total balance $38,575")).toBeVisible();
    await openTool(page, "timing");
    const timing = page.getByRole("dialog", { name: "Timing" });
    await expect(timing.locator("[data-hot-spot]")).toHaveCount(1);
    await timing.getByLabel("Show hot spots").check();
    await expect(page.locator("[data-hot-spot-outline]")).toHaveCount(1);
    await settled(page);
    await page.screenshot({ path: path.join(output, `orders-portal-hot-spots-${theme}.jpg`), type: "jpeg", quality: 75 });
    await page.keyboard.press("Escape");
  }
  expect(fs.readdirSync(output)).toHaveLength((tools.length + 1) * THEMES.length);
});

/**
 * Captures the restored tools where a real build gives them something to
 * show (restore-toolbar-tools-and-branch-previews, task 12.1): Quotes desk's
 * Microfrontends with its single-spa region outlined, a remote's Version
 * choice, Session with a preset and its form, and Settings with the Salt
 * theme and the event bus, in both operator themes.
 */
test("captures Microfrontends with regions, Session, and Settings over Quotes desk, in both operator themes", async ({ page, context, db, baseURL }) => {
  test.setTimeout(300_000);
  const output = path.join(OUTPUT, "toolbar-quotes");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const { desk } = await buildQuotes(db);
  await page.goto(framedRun(desk, "/"));
  await waitForPage(page, "Quotes desk");
  const presenter = await workspaceOf(context, db);
  setDisplayName(db, presenter.id, "Sam Rivera");
  const deskId = (db.$client.prepare("select id from applications where slug = ?").get(desk.application.slug) as { id: number }).id;
  createPreset(db, deskId, { name: "Admin user", entries: [{ store: "local", name: "desk:user", value: '{"role":"admin"}' }, { store: "cookie", name: "desk-region", value: "london" }, { store: "query", name: "desk", value: "fx" }] }, "Sam Rivera");
  let count = 0;
  const capture = async (name: string, theme: string) => {
    await settled(page);
    await page.screenshot({ path: path.join(output, `quotes-desk-${name}-${theme}.jpg`), type: "jpeg", quality: 75 });
    count++;
  };
  for (const theme of THEMES) {
    await useTheme(context, theme, baseURL!);
    await page.goto(framedRun(desk, "/"));
    await waitForPage(page, "Quotes desk");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

    await openTool(page, "microfrontends");
    const microfrontends = page.getByRole("dialog", { name: "Microfrontends" });
    await expect(microfrontends.locator('[data-member="quotesPanel"]')).toBeVisible();
    await microfrontends.getByLabel("Show regions").check();
    await expect(page.locator('[data-region-outline="@fixtures/quotes-panel"]')).toBeVisible();
    await capture("microfrontends-regions", theme);
    await microfrontends.locator('[data-member="quotesPanel"]').click();
    await expect(microfrontends.getByRole("group", { name: "Version" })).toBeVisible();
    await capture("microfrontends-version", theme);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await openTool(page, "session");
    const session = page.getByRole("dialog", { name: "Session" });
    await expect(session.getByRole("group", { name: "Start with" }).getByLabel("Admin user")).toBeVisible();
    await capture("session", theme);
    await session.getByRole("button", { name: "New preset" }).click();
    await capture("session-new-preset", theme);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await openTool(page, "settings");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByRole("group", { name: "Mode" })).toBeVisible();
    // One event in the log: a test event the page handles.
    const send = settings.locator("form").filter({ has: page.getByRole("heading", { name: "Send an event" }) });
    await send.getByLabel("Event name").fill("quotes:selected");
    await send.getByLabel("Detail").fill('{"symbol":"ACME"}');
    await send.getByRole("button", { name: "Send event" }).click();
    await expect(application(page).getByText("Selected: ACME")).toBeVisible();
    await capture("settings", theme);
    await page.keyboard.press("Escape");
  }
  expect(fs.readdirSync(output)).toHaveLength(count);
  expect(count).toBe(5 * THEMES.length);
});

/**
 * Captures the toolbar's own states at desktop and 375px widths, in both
 * operator themes: at rest, the open and filtered menu, each tool panel, the
 * composer with its formatting bar, and the hidden tab.
 */
test("captures the toolbar's states at desktop and mobile width, in both operator themes", async ({ page, context, db, baseURL }) => {
  test.setTimeout(240_000);
  const output = path.join(OUTPUT, "toolbar-states");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const panels: [id: string, dialog: string][] = [
    ["comments", "Comments"],
    ["share", "Share"],
    ["accessibility", "Accessibility"],
    ["timing", "Timing"],
    ["microfrontends", "Microfrontends"],
    ["session", "Session"],
    ["data", "Data"],
    ["settings", "Settings"],
    ["shortcuts", "Preferences / Keyboard shortcuts"],
  ];
  const menu = page.getByRole("dialog", { name: "Toolbar", exact: true });
  let count = 0;
  const capture = async (name: string, theme: string, viewport: string) => {
    await expectNoHorizontalOverflow(page);
    await settled(page);
    await page.screenshot({ path: path.join(output, `${name}-${viewport}-${theme}.jpg`), type: "jpeg", quality: 75 });
    count++;
  };
  const running = await runOrdersPortal(page, db);
  for (const theme of THEMES) {
    await useTheme(context, theme, baseURL!);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(framedRun(running, "/accounts"));
      await waitForPage(page, "Accounts");
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await capture("rest", theme, viewport.name);

      await page.getByRole("button", { name: /^Open toolbar menu/ }).click();
      await expect(menu).toBeVisible();
      await capture("menu", theme, viewport.name);
      await page.keyboard.type("tim");
      await capture("menu-filtered", theme, viewport.name);
      await page.keyboard.press("Escape");

      for (const [id, dialog] of panels) {
        await openTool(page, id);
        await expect(page.getByRole("dialog", { name: dialog })).toBeVisible();
        await capture(`panel-${id}`, theme, viewport.name);
        await page.keyboard.press("Escape");
      }

      await openTool(page, "comment");
      await application(page).getByRole("button", { name: "Export orders" }).click();
      const composer = page.getByRole("dialog", { name: "New comment" });
      await composer.getByLabel("Comment", { exact: true }).fill("Make this **primary**");
      await composer.getByRole("button", { name: "Formatting" }).click();
      await expect(composer.getByRole("group", { name: "Formatting" })).toBeVisible();
      // Taller with its formatting bar, the composer moves clear of the toolbar once it has measured itself.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const box = document.querySelector('[role="dialog"][aria-label="New comment"]')!.getBoundingClientRect();
            const controls = document.querySelector('[data-toolbar="controls"]')!.getBoundingClientRect();
            return box.bottom <= controls.top || box.top >= controls.bottom || box.right <= controls.left || box.left >= controls.right;
          }),
        )
        .toBe(true);
      await capture("composer", theme, viewport.name);
      await composer.getByLabel("Comment", { exact: true }).press("Escape");

      await page.keyboard.press(".");
      await expect(page.getByRole("button", { name: "Show toolbar" })).toBeVisible();
      await capture("hidden", theme, viewport.name);
      await page.keyboard.press(".");
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(count);
  expect(count).toBe((panels.length + 5) * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures Data where a mock set applies (add-mock-sets, task 13.1): the
 * pill's marker with its tooltip, Data's request list over Orders portal
 * with "Happy path" as its default, a failed call's detail with Create rule,
 * the Share dialog naming the set, and preview mode's line above the
 * browser window; and Data's refusal beside Quotes desk's own service
 * worker, in both operator themes. Data with no set is among the toolbar's
 * states.
 */
test("captures Data with a mock set, the pill's marker, and preview mode's line, in both operator themes", async ({ page, context, db, baseURL }) => {
  test.setTimeout(300_000);
  const output = path.join(OUTPUT, "toolbar-data");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  ordersPortalRemote();
  const running = await buildOrdersPortal(db);
  seedMockSet(db, running.application.slug, ORDERS_HAPPY_PATH, { default: true, byName: "Sam Rivera" });
  // Quotes desk, with a default set, and its own service worker registered for its build's path.
  const { desk } = await buildQuotes(db, { saved: false });
  seedMockSet(db, desk.application.slug, [{ pattern: "/v1/desk", responses: [{ json: { name: "FX desk" } }] }], { default: true });
  await page.goto(framedRun(desk, "/"));
  await waitForPage(page, "Quotes desk");
  await application(page)
    .locator(":root")
    .evaluate(async () => {
      await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
    });
  let count = 0;
  const capture = async (name: string, theme: string, fullPage = false) => {
    await settled(page);
    await page.screenshot({ path: path.join(output, `${name}-${theme}.jpg`), type: "jpeg", quality: 75, fullPage });
    count++;
  };
  const rates = "GET https://api.orders.test/v1/rates";
  for (const theme of THEMES) {
    await useTheme(context, theme, baseURL!);
    await page.goto(framedRun(running, "/accounts"));
    await waitForPage(page, "Accounts");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    // The page's calls have been answered: recent orders from the set, and the rates worker's call failed.
    await expect(application(page).locator("[data-recent-orders] li")).toHaveCount(5);
    await expect(application(page).locator("[data-rates]")).toHaveText("Rates unavailable");
    const resting = page.locator('[data-toolbar="controls"] [data-resting][data-toolbar-item="data"]');
    await resting.hover();
    await expect(page.locator("[data-toolbar-tooltip]")).toContainText("Data · Mock set: Happy path");
    await capture("orders-portal-data-pill", theme);

    await resting.click();
    const data = page.getByRole("dialog", { name: "Data" });
    await expect(data.locator(`[data-request="${rates}"]`)).toBeVisible();
    await capture("orders-portal-data", theme);
    await data.locator(`[data-request="${rates}"]`).getByRole("button").click();
    await data.getByRole("button", { name: "Create rule" }).click();
    await expect(data.getByRole("form", { name: "Create rule" })).toBeVisible();
    await capture("orders-portal-data-create-rule", theme);
    await page.keyboard.press("Escape");
    await openTool(page, "share");
    await expect(page.getByRole("dialog", { name: "Share" }).locator("[data-share-applies]")).toContainText('the mock set "Happy path"');
    await expect(page.getByRole("dialog", { name: "Share" }).getByLabel("Link to this view")).toBeVisible();
    await capture("orders-portal-share", theme);
    await page.keyboard.press("Escape");

    await page.goto(paths.applicationPreview(running.application.slug));
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expect(page.locator("[data-mock-line]")).toHaveText("Mock set: Happy path. Change it with Data in full screen.");
    await expect(page.frameLocator("[data-preview-frame]").locator("[data-recent-orders] li")).toHaveCount(5);
    await capture("orders-portal-preview-mode-line", theme, true);

    await page.goto(framedRun(desk, "/"));
    await waitForPage(page, "Quotes desk");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await openTool(page, "data");
    await expect(page.getByRole("dialog", { name: "Data" }).locator("[data-mock-refusal]")).toBeVisible();
    await capture("quotes-desk-data-refused", theme);
    await page.keyboard.press("Escape");
  }
  expect(fs.readdirSync(output)).toHaveLength(count);
  expect(count).toBe(6 * THEMES.length);
});
