import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalOverflow, expectNoNestedBorders, expectNoOverlappingContent, test } from "./support/fixtures";
import { openTool } from "./support/toolbar";
import { framedRun } from "./support/fixture-app";
import { application, runOrdersPortal, waitForPage } from "./support/running-app";
import { applicationSurfaces, seedOperatorSurfaces } from "./support/surfaces";
import { paths } from "./support/paths";
import { useTheme } from "./support/shell";
import { storeEntry } from "../src/lib/catalog/entries";
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

/**
 * Waits until React has hydrated the page's title. A screenshot hides the
 * caret with an inline style on the focused field, such as an autofocused
 * one, and a capture taken before hydration would make React report it as a
 * hydration mismatch.
 */
const hydrated = (page: Page) => page.waitForFunction(() => Object.keys(document.querySelector("h1") ?? {}).some((key) => key.startsWith("__reactFiber$")));

/** Loads every image now, the lazy ones below the fold too, which a full-page capture never scrolls to. */
const loadImages = (page: Page) =>
  page.evaluate(async () => {
    const images = [...document.images];
    for (const image of images) image.loading = "eager";
    const settled = (image: HTMLImageElement) =>
      new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    await Promise.all(images.map((image) => (image.complete ? null : settled(image))));
  });
test.setTimeout(600_000);

test("captures every product surface at desktop and mobile width, in both themes", async ({ page, db, sourcesDir, baseURL }) => {
  // The surfaces, then the System status and Adoption pages, which read the Reference Catalog's Salt entry and the surfaces' Profiles, and Bitbucket tokens.
  storeEntry(db, saltEntry());
  const surfaces = [
    ...(await seedOperatorSurfaces(db, sourcesDir)),
    ...applicationSurfaces(db, sourcesDir),
    ["10-system", "/admin/system"],
    ["10-bitbucket-tokens", "/admin/bitbucket-tokens"],
    ["10-adoption", "/adoption"],
    ["10-adoption-salt", "/adoption/design-systems/salt"],
    ["10-adoption-button", "/adoption/design-systems/salt/components/Button"],
    ["10-adoption-package", "/adoption/packages/@salt-ds/core"],
  ] as const;

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
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
        await page.screenshot({ path: path.join(OUTPUT, `${name}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(OUTPUT)).toHaveLength(surfaces.length * VIEWPORTS.length * THEMES.length);
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
      await page.screenshot({ path: path.join(output, `orders-portal-${name}-${theme}.jpg`), type: "jpeg", quality: 75 });
    }
    await page.keyboard.press("Escape");
  }
  expect(fs.readdirSync(output)).toHaveLength(tools.length * THEMES.length);
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
    ["shortcuts", "Preferences / Keyboard shortcuts"],
  ];
  const menu = page.getByRole("dialog", { name: "Toolbar", exact: true });
  let count = 0;
  const capture = async (name: string, theme: string, viewport: string) => {
    await expectNoHorizontalOverflow(page);
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
