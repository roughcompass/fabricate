import fs from "node:fs";
import path from "node:path";
import { expect, expectNoHorizontalOverflow, expectNoNestedBorders, expectNoOverlappingContent, test } from "./support/fixtures";
import { openTool, setView, waitForRegions } from "./support/demo";
import { demoSurfaces, seedOperatorSurfaces } from "./support/surfaces";
import { paths } from "./support/paths";
import { useTheme } from "./support/shell";

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
    await useTheme(page.context(), theme, baseURL!);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(url);
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
    await page.context().addCookies([{ name: "fabricate-sidebar", value: "hidden", url: baseURL! }]);
    await page.goto(paths.assessments);
    await expect(page.locator("#sidebar")).toBeHidden();
    await capture("sidebar-hidden-desktop", theme);
    await page.context().clearCookies({ name: "fabricate-sidebar" });

    await page.goto(paths.home);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Salt Patterns", exact: true })).toBeVisible();
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
 * Captures the template demo's operator surfaces: the gallery, template
 * detail, and preview mode on every device and orientation and its Code tab.
 */
test("captures every template demo surface at desktop and mobile width, in both themes", async ({ page, context, db: _db, baseURL }) => {
  const output = path.join(OUTPUT, "demo");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const surfaces = demoSurfaces();

  for (const theme of THEMES) {
    await useTheme(context, theme, baseURL!);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(url);
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
  const tools: [id: string, dialog: string][] = [
    ["microfrontends", "Microfrontends"],
    ["accessibility", "Accessibility"],
    ["timing", "Timing"],
    ["settings", "Settings"],
    ["share", "Share"],
    ["comments", "Comments"],
  ];
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of THEMES) {
    await useTheme(context, theme, baseURL!);
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
      for (const [name, dialog] of tools) {
        await openTool(page, name);
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

/**
 * Captures the toolbar's own states at desktop and 375px widths, in both
 * operator themes: at rest, the open and filtered menu, each tool panel, the
 * Session create form, the composer with its formatting bar, and the hidden
 * tab.
 */
test("captures the toolbar's states at desktop and mobile width, in both operator themes", async ({ page, context, db: _db, baseURL }) => {
  const output = path.join(OUTPUT, "toolbar-states");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const panels: [id: string, dialog: string][] = [
    ["comments", "Comments"],
    ["share", "Share"],
    ["microfrontends", "Microfrontends"],
    ["accessibility", "Accessibility"],
    ["timing", "Timing"],
    ["session", "Session"],
    ["settings", "Settings"],
    ["shortcuts", "Preferences / Keyboard shortcuts"],
  ];
  const menu = page.getByRole("dialog", { name: "Toolbar", exact: true });
  let count = 0;
  const capture = async (name: string, theme: string, viewport: string) => {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(output, `${name}-${viewport}-${theme}.jpg`), type: "jpeg", quality: 75 });
    count++;
  };
  for (const theme of THEMES) {
    await useTheme(context, theme, baseURL!);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("/run/ref-payments-workspace");
      await waitForRegions(page);
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await capture("rest", theme, viewport.name);

      await page.getByRole("button", { name: /^Open toolbar menu/ }).click();
      await expect(menu).toBeVisible();
      await capture("menu", theme, viewport.name);
      await page.keyboard.type("set");
      await capture("menu-filtered", theme, viewport.name);
      await page.keyboard.press("Escape");

      for (const [id, dialog] of panels) {
        await openTool(page, id);
        await expect(page.getByRole("dialog", { name: dialog })).toBeVisible();
        await capture(`panel-${id}`, theme, viewport.name);
        await page.keyboard.press("Escape");
      }

      await openTool(page, "session");
      await page.getByRole("dialog", { name: "Session" }).getByRole("button", { name: "New profile" }).click();
      await expect(page.getByRole("form", { name: "New profile" })).toBeVisible();
      await capture("session-create", theme, viewport.name);
      await page.keyboard.press("Escape");

      await openTool(page, "comment");
      await page.locator('[data-demo-anchor="send-payment"]').click();
      const composer = page.getByRole("dialog", { name: "New comment" });
      await composer.getByLabel("Comment", { exact: true }).fill("Make this **primary**");
      await composer.getByRole("button", { name: "Formatting" }).click();
      await expect(composer.getByRole("group", { name: "Formatting" })).toBeVisible();
      await capture("composer", theme, viewport.name);
      await composer.getByLabel("Comment", { exact: true }).press("Escape");

      await page.keyboard.press(".");
      await expect(page.getByRole("button", { name: "Show toolbar" })).toBeVisible();
      await capture("hidden", theme, viewport.name);
      await page.keyboard.press(".");
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(count);
  expect(count).toBe((panels.length + 6) * VIEWPORTS.length * THEMES.length);
});
