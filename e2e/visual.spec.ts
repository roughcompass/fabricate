import fs from "node:fs";
import path from "node:path";
import { expect, expectNoHorizontalOverflow, expectNoNestedBorders, expectNoOverlappingContent, test } from "./support/fixtures";
import { setView, waitForRegions } from "./support/demo";
import { seedDemoSurfaces, seedOperatorSurfaces, surfaceUrl } from "./support/surfaces";

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
test.setTimeout(600_000);

test("captures every product surface at desktop and mobile width, in both themes", async ({ page, db, sourcesDir, baseURL }) => {
  const surfaces = await seedOperatorSurfaces(db, sourcesDir);

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const theme of THEMES) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(surfaceUrl(url));
        // The development server's floating indicator is not part of the product.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
 * section menu shown after Show all sections on a desktop, and the drawer
 * open on a phone.
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
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);

    await page.setViewportSize(VIEWPORTS[0]!);
    await page.context().addCookies([{ name: "fabricate-sidebar", value: "hidden", url: baseURL! }]);
    await page.goto("/");
    await expect(page.locator("#sidebar")).toBeHidden();
    await capture("sidebar-hidden-desktop", theme);
    await page.context().clearCookies({ name: "fabricate-sidebar" });

    await page.goto("/");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Show all sections" }).click();
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Standards", exact: true })).toBeVisible();
    await capture("section-menu-desktop", theme);

    await page.setViewportSize(VIEWPORTS[1]!);
    await page.goto("/sources");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await capture("drawer-open-mobile", theme);
  }
  expect(fs.readdirSync(output)).toHaveLength(3 * THEMES.length);
});

/**
 * Captures each portal shell of the template demo, with its hero application,
 * at desktop and mobile width in both runtime themes. Portals are application
 * content, so only overflow and overlap are checked, not the operator rules.
 */
test("captures every portal shell at desktop and mobile width, in both runtime themes", async ({ page, db: _db }) => {
  const output = path.join(OUTPUT, "portals");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const heroes = ["payments-workspace", "client-onboarding", "market-watch", "operations-console"];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const slug of heroes) {
      await page.goto(`/run/ref-${slug}`);
      await waitForRegions(page);
      for (const theme of THEMES) {
        await setView(page, { theme });
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-theme", theme);
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await page.screenshot({ path: path.join(output, `${slug}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(heroes.length * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures the template demo's operator surfaces: the create page and the
 * import, the gallery, template detail, preview mode on every device and
 * orientation and its Code tab, the deploy form, building and ready
 * applications, and the Applications list. A building application is created
 * just before each capture of it, so it is always mid-build.
 */
test("captures every template demo surface at desktop and mobile width, in both themes", async ({ page, context, db, baseURL }) => {
  const output = path.join(OUTPUT, "demo");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const surfaces = await seedDemoSurfaces(page, context, db);

  for (const theme of THEMES) {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(surfaceUrl(url));
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (name.startsWith("13-preview-") && name !== "13-preview-code") {
          const frame = (await (await page.locator("[data-preview-frame]").elementHandle())!.contentFrame())!;
          await frame.waitForFunction(() => document.querySelector("[data-demo-mfe]") && !document.querySelector('[data-demo-mfe]:not([data-demo-state="ready"])'), null, { timeout: 15_000 });
        }
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await expectNoNestedBorders(page);
        await page.screenshot({ path: path.join(output, `${name}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(surfaces.length * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures each hero application with each toolbar tool open, in both
 * application themes, with the toolbar in the matching operator theme.
 */
test("captures each toolbar tool over every hero application, in both themes", async ({ page, context, db: _db, baseURL }) => {
  const output = path.join(OUTPUT, "toolbar");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const heroes = ["payments-workspace", "client-onboarding", "market-watch", "operations-console"];
  const tools: [name: string, button: string, dialog: string][] = [
    ["microfrontends", "Open microfrontends", "Microfrontends"],
    ["accessibility", "Open accessibility audit", "Accessibility"],
    ["timing", "Open timing", "Timing"],
    ["settings", "Open settings", "Settings"],
    ["share", "Open sharing", "Share"],
    ["comments", "Open comments", "Comments"],
  ];
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of THEMES) {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const slug of heroes) {
      await page.goto(`/run/ref-${slug}`);
      await waitForRegions(page);
      await setView(page, { theme });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      if (theme === "light") {
        // One comment per hero, so the comments list and a pin show.
        await page.keyboard.press("c");
        await page.locator("[data-demo-mfe] [data-demo-anchor]").first().click();
        const composer = page.getByRole("dialog", { name: "New comment" });
        if (await composer.getByLabel("Your name").count()) await composer.getByLabel("Your name").fill("Sam Rivera");
        await composer.getByLabel("Comment", { exact: true }).fill("Can this use the shared component?");
        await composer.getByRole("button", { name: "Post comment" }).click();
        await expect(composer).toBeHidden();
        await page.getByRole("dialog", { name: "Comment 1" }).getByRole("button", { name: "Close comment" }).click();
      }
      for (const [name, button, dialog] of tools) {
        await page.getByRole("button", { name: button }).click();
        const panel = page.getByRole("dialog", { name: dialog });
        await expect(panel).toBeVisible();
        if (name === "accessibility") {
          await panel.getByRole("button", { name: /Run audit/ }).click();
          await expect(panel.locator("[data-audit-result]").first()).toBeVisible();
        }
        if (name === "share") await expect(panel.getByLabel("Link to this view")).toBeVisible();
        await page.screenshot({ path: path.join(output, `${slug}-${name}-${theme}.jpg`), type: "jpeg", quality: 75 });
      }
      await page.keyboard.press("Escape");
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(heroes.length * tools.length * THEMES.length);
});
