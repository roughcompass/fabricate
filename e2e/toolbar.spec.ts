import type { Page } from "@playwright/test";
import { auditToolbar, expectToolbarOnTop, openTool, openToolbarMenu, startComment } from "./support/toolbar";
import { E2E_PREVIEWS } from "./support/env";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { paths } from "./support/paths";
import type { FixtureApplication } from "./support/fixture-app";
import { application, runOrdersPortal, waitForPage } from "./support/running-app";
import { useTheme } from "./support/shell";

/*
 * The toolbar over a running application (template-demo/toolbar spec;
 * add-applications, task 8.5): Comment, Comments, Share, Accessibility, and
 * Timing, with Microfrontends, Session, and Settings restored
 * (restore-toolbar-tools-and-branch-previews, task 8.2), over the fixture
 * application in its frame.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(90_000);

const toolbar = (page: Page) => page.getByRole("complementary", { name: "Toolbar", exact: true });
const menu = (page: Page) => page.getByRole("dialog", { name: "Toolbar", exact: true });
const menuButton = (page: Page) => page.getByRole("button", { name: /^Open toolbar menu/ });
const tooltip = (page: Page) => page.getByRole("tooltip");

let running: FixtureApplication;

test.beforeEach(async ({ page, db }) => {
  running = await runOrdersPortal(page, db);
});

test.describe("the pill", () => {
  test("docks to the middle of the right edge with the menu button only, and no Demo label", async ({ page }) => {
    const pill = toolbar(page);
    await expect(pill).toBeVisible();
    await expect(pill).not.toContainText(/demo/i);
    await expect(pill).not.toHaveAccessibleDescription(/simulated/i);
    await expect(pill.getByRole("button")).toHaveCount(1);
    await expect(menuButton(page)).toBeVisible();

    const box = (await pill.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(viewport.width - (box.x + box.width)).toBeLessThan(24);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
  });

  test("shows the active tool above the menu button, and leaves it from there", async ({ page }) => {
    await startComment(page);
    const active = toolbar(page).getByRole("button", { name: "Comment", exact: true });
    await expect(active).toHaveAttribute("aria-pressed", "true");
    const [activeBox, menuBox] = [(await active.boundingBox())!, (await menuButton(page).boundingBox())!];
    expect(activeBox.y).toBeLessThan(menuBox.y);
    await active.click();
    await expect(page.getByText("Choose any element to comment on it. Press Esc to cancel.")).toBeHidden();
    await expect(toolbar(page).getByRole("button", { name: "Comment", exact: true })).toHaveCount(0);

    await openTool(page, "timing");
    await expect(page.getByRole("dialog", { name: "Timing" })).toBeVisible();
    await toolbar(page).getByRole("button", { name: "Timing", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Timing" })).toBeHidden();
  });

  test("hides to a tab at the right edge that stays across reloads", async ({ page }) => {
    await openToolbarMenu(page);
    await menu(page).getByRole("option", { name: "Hide toolbar" }).click();
    await expect(toolbar(page)).toBeHidden();
    const tab = page.getByRole("button", { name: "Show toolbar" });
    await expect(tab).toBeVisible();
    // Reduced motion still runs a 0.01ms transition, which lands on the next frame.
    await expect.poll(async () => page.viewportSize()!.width - (await tab.boundingBox().then((box) => box!.x + box!.width))).toBeLessThan(2);
    await page.reload();
    await expect(tab).toBeVisible();
    await expect(toolbar(page)).toBeHidden();
    await tab.click();
    await expect(toolbar(page)).toBeVisible();
    // The . key hides and shows it too.
    await page.keyboard.press(".");
    await expect(tab).toBeVisible();
    await page.keyboard.press(".");
    await expect(toolbar(page)).toBeVisible();
  });
});

test.describe("tooltips", () => {
  test("names a hovered pill button and its key, to the left of the button", async ({ page }) => {
    await startComment(page);
    const active = toolbar(page).getByRole("button", { name: "Comment", exact: true });
    await active.hover();
    await expect(tooltip(page)).toHaveText("CommentC");
    const [tip, button] = [(await tooltip(page).boundingBox())!, (await active.boundingBox())!];
    expect(tip.x + tip.width).toBeLessThanOrEqual(button.x);
    expect(Math.abs(tip.y + tip.height / 2 - (button.y + button.height / 2))).toBeLessThan(2);
    // The tooltip stays while the pointer moves onto it.
    await tooltip(page).hover();
    await page.waitForTimeout(300);
    await expect(tooltip(page)).toBeVisible();
  });

  test("shows at once on keyboard focus and closes on Escape", async ({ page }) => {
    await openToolbarMenu(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(menu(page).getByRole("button", { name: "Comment" })).toBeFocused();
    await expect(tooltip(page)).toHaveText("CommentC");
    await page.keyboard.press("Escape");
    await expect(tooltip(page)).toBeHidden();
    // The first Escape only dismissed the tooltip.
    await expect(menu(page)).toBeVisible();
  });
});

test.describe("the menu", () => {
  test("opens beside the pill with focus in the search, the context row, the Shortcuts row, and every group", async ({ page }) => {
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole("combobox", { name: "What do you need?" })).toBeFocused();
    await expect(menu(page).getByRole("combobox")).toHaveAttribute("placeholder", "What do you need?");
    const shortcuts = menu(page).getByRole("group", { name: "Shortcuts" }).getByRole("button");
    expect(await shortcuts.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(["Comment", "Share", "Microfrontends", "Accessibility", "Timing", "Session", "Data", "Settings"]);
    for (const group of ["Collaboration", "Inspect", "Runtime", "More"]) await expect(menu(page).getByRole("group", { name: group })).toBeVisible();
    expect(await menu(page).getByRole("group", { name: "Inspect" }).getByRole("option").allInnerTexts()).toEqual(["Microfrontends\nM", "Accessibility\nA", "Timing\nT"]);
    expect(await menu(page).getByRole("group", { name: "Runtime" }).getByRole("option").allInnerTexts()).toEqual(["Session\nP", "Data\nD", "Settings\nS"]);
    expect(await menu(page).getByRole("option").evaluateAll((options) => options.map((option) => option.getAttribute("data-toolbar-item")))).toEqual(["comment", "comments", "share", "microfrontends", "accessibility", "timing", "session", "data", "settings", "shortcuts", "hide"]);
    const [menuBox, pillBox] = [(await menu(page).boundingBox())!, (await toolbar(page).boundingBox())!];
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(pillBox.x);

    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
  });

  test("filters to a tool by name and opens it with Enter (Filtering to a tool)", async ({ page }) => {
    await openToolbarMenu(page);
    await page.keyboard.type("tim");
    const options = menu(page).getByRole("option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveAccessibleName("Timing");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await expect(menu(page).getByRole("group", { name: "Inspect" })).toBeVisible();
    await expect(menu(page).getByRole("group", { name: "Collaboration" })).toHaveCount(0);
    await expect(menu(page).locator("[data-menu-context]")).toHaveCount(0);
    await expect(menu(page).getByRole("group", { name: "Shortcuts" })).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Timing" })).toBeVisible();
  });

  test("moves through the items with the arrow keys, and matches aliases", async ({ page }) => {
    await openToolbarMenu(page);
    await page.keyboard.type("a11y");
    await expect(menu(page).getByRole("option")).toHaveAccessibleName("Accessibility");
    await menu(page).getByRole("combobox").fill("");
    await page.keyboard.press("ArrowDown");
    await expect(menu(page).getByRole("option", { name: "Comment", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(menu(page).getByRole("option", { name: "Comments", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(menu(page).getByRole("option", { name: "Hide toolbar" })).toHaveAttribute("aria-selected", "true");
  });

  test("says when nothing matches (No match)", async ({ page }) => {
    await openToolbarMenu(page);
    for (const query of ["zzz", "environment"]) {
      await menu(page).getByRole("combobox").fill(query);
      await expect(menu(page).getByText("No matching tools")).toBeVisible();
      await expect(menu(page).getByRole("option")).toHaveCount(0);
    }
  });

  test("finds the restored tools by name and by other words, under their groups (Finding a tool by another word)", async ({ page }) => {
    await openToolbarMenu(page);
    for (const [query, name, group] of [
      ["micro", "Microfrontends", "Inspect"],
      ["mfe", "Microfrontends", "Inspect"],
      ["routing", "Microfrontends", "Inspect"],
      ["session", "Session", "Runtime"],
      ["storage", "Session", "Runtime"],
      ["cookies", "Session", "Runtime"],
      ["dark", "Settings", "Runtime"],
      ["density", "Settings", "Runtime"],
      ["events", "Settings", "Runtime"],
      // Data (add-mock-sets, task 10.1): "har" is in Share's name too, but Data is the one highlighted.
      ["har", "Data", "Runtime"],
      ["mock", "Data", "Runtime"],
      ["network", "Data", "Runtime"],
    ] as const) {
      await menu(page).getByRole("combobox").fill(query);
      const option = menu(page).getByRole("group", { name: group }).getByRole("option");
      await expect(option, query).toHaveCount(1);
      await expect(option).toHaveAccessibleName(name);
      await expect(option).toHaveAttribute("aria-selected", "true");
    }
  });

  test("names the application, its branch and short commit, and its status, and opens its page in a new tab (Context row)", async ({ page, context }) => {
    await openToolbarMenu(page);
    const row = menu(page).locator("[data-menu-context]");
    await expect(row).toContainText("Orders portal");
    await expect(row).toContainText("main");
    await expect(row).toContainText(running.preview.commitSha.slice(0, 12));
    await expect(row).toContainText("Ready");
    await expect(row).toHaveAttribute("target", "_blank");
    const [opened] = await Promise.all([context.waitForEvent("page"), row.click()]);
    await opened.waitForLoadState("domcontentloaded");
    expect(new URL(opened.url()).pathname).toBe(paths.application(running.application.slug));
    await opened.close();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no accessibility violations with the menu open in the ${theme} operator theme`, async ({ page, context, baseURL }) => {
      await useTheme(context, theme, baseURL!);
      await page.reload();
      await waitForPage(page, "Accounts");
      expect(await auditToolbar(page)).toEqual([]);
      await openToolbarMenu(page);
      expect(await auditToolbar(page)).toEqual([]);
      await page.keyboard.type("tim");
      expect(await auditToolbar(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await openToolbarMenu(page);
      await menu(page).getByRole("option", { name: "Hide toolbar" }).click();
      expect(await auditToolbar(page)).toEqual([]);
    });
  }
});

test.describe("panels", () => {
  test("open to the left of the pill, which stays fully visible (Panel beside the toolbar)", async ({ page }) => {
    await openTool(page, "accessibility");
    const panel = page.getByRole("dialog", { name: "Accessibility" });
    await expect(panel).toBeVisible();
    const [panelBox, pillBox] = [(await panel.boundingBox())!, (await toolbar(page).boundingBox())!];
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(pillBox.x);
    expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expectToolbarOnTop(page);

    // Back to menu reopens the menu with the tool highlighted.
    await panel.getByRole("button", { name: "Back to menu" }).click();
    await expect(menu(page).getByRole("option", { name: "Accessibility" })).toHaveAttribute("aria-selected", "true");
  });

  test("fit a 375px viewport beside the pill without overflowing", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openTool(page, "timing");
    const panel = page.getByRole("dialog", { name: "Timing" });
    const [panelBox, pillBox] = [(await panel.boundingBox())!, (await toolbar(page).boundingBox())!];
    expect(panelBox.x).toBeGreaterThanOrEqual(8);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(pillBox.x);
    await expectNoHorizontalOverflow(page);
  });

  test("open by shortcut with focus inside, close with Escape, and return focus (Panel focus)", async ({ page }) => {
    await page.keyboard.press("a");
    const panel = page.getByRole("dialog", { name: "Accessibility" });
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    await page.keyboard.press("l");
    await expect(page.getByRole("dialog", { name: "Share" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The restored tools' keys: M, then P, then S, each with focus inside its panel.
    for (const [key, name] of [
      ["m", "Microfrontends"],
      ["p", "Session"],
      ["d", "Data"],
      ["s", "Settings"],
    ] as const) {
      await page.keyboard.press(key);
      const restored = page.getByRole("dialog", { name });
      await expect(restored).toBeVisible();
      expect(await restored.evaluate((element) => element.contains(document.activeElement)), name).toBe(true);
      await page.keyboard.press("Escape");
      await expect(restored).toBeHidden();
    }

    // Opened from the menu, a panel returns focus to the menu button.
    await openTool(page, "timing");
    await expect(page.getByRole("dialog", { name: "Timing" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menuButton(page)).toBeFocused();
  });
});

test.describe("keyboard shortcuts", () => {
  test("lists every action with its icon and key under Preferences, and offers the switch (Shortcuts reference)", async ({ page }) => {
    await openTool(page, "shortcuts");
    const reference = page.getByRole("dialog", { name: "Preferences / Keyboard shortcuts" });
    await expect(reference).toBeVisible();
    const rows = reference.getByRole("list", { name: "Keyboard shortcuts" }).getByRole("listitem");
    await expect(rows).toHaveCount(11);
    for (const [name, key] of [
      ["Start or stop comment mode", "C"],
      ["Share", "L"],
      ["Microfrontends", "M"],
      ["Accessibility", "A"],
      ["Timing", "T"],
      ["Session", "P"],
      ["Data", "D"],
      ["Settings", "S"],
      ["Keyboard shortcuts", "?"],
      ["Hide or show the toolbar", "."],
      ["Close the menu or panel, or leave the current mode", "Esc"],
    ] as const) {
      const row = rows.filter({ hasText: name }).first();
      await expect(row.locator("kbd")).toHaveText(key);
      await expect(row.locator("svg")).toHaveCount(1);
    }
    await expect(reference.getByLabel("Use single-key shortcuts")).toBeChecked();
    await page.keyboard.press("Escape");
    await page.keyboard.press("?");
    await expect(reference).toBeVisible();
  });

  test("ignores a shortcut letter typed into a field (Typing in the application)", async ({ page }) => {
    const field = application(page).getByRole("searchbox");
    await field.click();
    await page.keyboard.type("cal");
    await expect(field).toHaveValue("cal");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toolbar(page).getByRole("button", { name: "Comment", exact: true })).toHaveCount(0);
  });

  test("does nothing while single-key shortcuts are off, leaving Escape working", async ({ page }) => {
    await openTool(page, "shortcuts");
    await page.getByLabel("Use single-key shortcuts").uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Wherever focus is: in the toolbar's page or the application's.
    for (const key of ["a", "t", "l", "c", "m", "p", "s", "."]) {
      await page.keyboard.press(key);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await application(page).getByRole("button", { name: "Export orders" }).focus();
    await page.keyboard.press("t");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toolbar(page)).toBeVisible();
    await page.reload();
    await waitForPage(page, "Accounts");
    await page.keyboard.press("a");
    await expect(page.getByRole("dialog", { name: "Accessibility" })).toBeHidden();
  });
});

test.describe("nothing overlays the toolbar", () => {
  /** Each overlay, turned on by itself. */
  const OVERLAYS: [name: string, turnOn: (page: Page) => Promise<void>][] = [
    [
      "an audit",
      async (page) => {
        await openTool(page, "accessibility");
        await page.getByRole("dialog", { name: "Accessibility" }).getByRole("button", { name: "Run audit" }).click();
        await expect(page.locator("[data-audit-outline]").first()).toBeVisible();
      },
    ],
    [
      "a comment draft",
      async (page) => {
        await startComment(page);
        await application(page).getByRole("button", { name: "Export orders" }).click();
        await expect(page.getByRole("dialog", { name: "New comment" })).toBeVisible();
      },
    ],
  ];

  for (const width of [1280, 375]) {
    for (const [name, turnOn] of OVERLAYS) {
      test(`keeps the controls on top with ${name} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await turnOn(page);
        await expectToolbarOnTop(page);
        if (await menu(page).isVisible()) await page.keyboard.press("Escape");
        await menuButton(page).click();
        await expect(menu(page)).toBeVisible();
        await expectToolbarOnTop(page);
      });
    }
  }

  test("passes an audit outline beneath the pill, whose buttons still respond (Audit outline beneath the toolbar)", async ({ page }) => {
    // Dock the field with no label under the pill.
    await application(page).locator("head").evaluate((head) => head.insertAdjacentHTML("beforeend", "<style>input[type=search] { position: fixed !important; top: calc(50% - 20px) !important; right: 0 !important; width: 200px !important; z-index: 2147483647 !important; }</style>"));
    await openTool(page, "accessibility");
    await page.getByRole("dialog", { name: "Accessibility" }).getByRole("button", { name: "Run audit" }).click();
    await expect(page.locator("[data-audit-outline]").first()).toBeVisible();
    await page.keyboard.press("Escape");
    const pill = (await toolbar(page).boundingBox())!;
    const beneath = await page.locator("[data-audit-outline]").evaluateAll(
      (outlines, box) => outlines.some((outline) => {
        const rect = outline.getBoundingClientRect();
        return rect.left < box.x + box.width && box.x < rect.right && rect.top < box.y + box.height && box.y < rect.bottom;
      }),
      pill,
    );
    expect(beneath, "an audit outline lies under the pill").toBe(true);
    await expectToolbarOnTop(page);
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();
  });

  test("stays above application content fixed at the right edge at the highest stacking order (Application content at the edge)", async ({ page }) => {
    await application(page).locator("body").evaluate((body) => {
      const cover = document.createElement("div");
      cover.style.cssText = "position: fixed; top: 0; right: 0; bottom: 0; width: 160px; z-index: 2147483647; background: rgb(200 0 0 / 0.5);";
      body.append(cover);
    });
    await expectToolbarOnTop(page);
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();
    await expectToolbarOnTop(page);
    await menu(page).getByRole("option", { name: "Timing" }).click();
    await expect(page.getByRole("dialog", { name: "Timing" })).toBeVisible();
    await expectToolbarOnTop(page);
  });
});

test.describe("nothing overlays the toolbar, with guided hints", () => {
  test.use({ guidedHints: true });
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  for (const width of [1280, 375]) {
    test(`keeps the controls on top, and the hint clear of them, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.reload();
      await waitForPage(page, "Accounts");
      for (const name of ["Hint 1 of 3: Audit accessibility", "Hint 2 of 3: See what's slow", "Hint 3 of 3: Comment on anything"]) {
        const hint = page.getByRole("dialog", { name });
        await expect(hint).toBeVisible();
        await expect(menu(page)).toBeVisible();
        await expect.poll(async () => overlap((await hint.boundingBox())!, (await menu(page).boundingBox())!)).toBe(false);
        expect(overlap((await hint.boundingBox())!, (await toolbar(page).boundingBox())!)).toBe(false);
        await expectToolbarOnTop(page);
        if (!name.startsWith("Hint 3")) await hint.getByRole("button", { name: "Next hint" }).click();
      }
      // The menu button still works: it closes the menu the hints opened, and opens it again.
      await menuButton(page).click();
      await expect(menu(page)).toBeHidden();
      await menuButton(page).click();
      await expect(menu(page)).toBeVisible();
      await expectToolbarOnTop(page);
    });
  }
});
