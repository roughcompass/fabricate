import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

/** The component gallery, and the component behavior it demonstrates. */

const light = (page: Page, title: string) => page.getByRole("region", { name: `${title}, light` });
const height = (locator: Locator) => locator.evaluate((element) => element.getBoundingClientRect().height);

test("renders every component section in both themes", async ({ page }) => {
  await page.goto("/design-system");
  await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
  const titles = await page.getByRole("list", { name: "Components" }).getByRole("link").allTextContents();
  expect(titles.length).toBeGreaterThan(10);
  for (const title of titles) {
    await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: new RegExp(`^${title}, light$`) })).toBeAttached();
  }
  // Bordered containers never nest.
  expect(await page.locator("[data-panel] [data-panel]").count()).toBe(0);
  // The dark frame resolves the dark palette while the page stays light.
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.getByRole("region", { name: "Buttons, dark" })).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(light(page, "Buttons")).toHaveCSS("background-color", "rgb(250, 250, 250)");
});

test("sizes controls at 36px by default and fills primary buttons with the monochrome primary color", async ({ page }) => {
  await page.goto("/design-system");
  const buttons = light(page, "Buttons");
  expect(await height(buttons.locator('[data-size-sample="md"]'))).toBe(36);
  expect(await height(buttons.locator('[data-size-sample="sm"]'))).toBe(28);
  const primary = buttons.getByRole("button", { name: "Primary", exact: true });
  await expect(primary).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await expect(primary).toHaveCSS("color", "rgb(255, 255, 255)");
  // Inverted in the dark theme.
  const darkPrimary = page.getByRole("region", { name: "Buttons, dark" }).getByRole("button", { name: "Primary", exact: true });
  await expect(darkPrimary).toHaveCSS("background-color", "rgb(237, 237, 237)");
  await expect(darkPrimary).toHaveCSS("color", "rgb(10, 10, 10)");
  await expect(buttons.getByRole("link", { name: "Edit" })).toHaveCSS("text-decoration-line", "none");
});

// operator-interface/design-system: monochrome palette with a single blue accent.
test("uses the primary color for selection and blue only for links and focus", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-system");
  const form = light(page, "Form controls");
  await expect(form.getByLabel("Checked", { exact: true })).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await expect(page.getByRole("list", { name: "Components" }).getByRole("link").first()).toHaveCSS("color", "rgb(0, 104, 214)");
  const input = form.getByLabel("Name", { exact: true });
  await input.focus();
  await expect(input).toHaveCSS("border-top-color", "rgb(0, 104, 214)");
});

// operator-interface/page-patterns: content sits on white surfaces over a gray canvas.
test("puts every content container on a surface over the canvas, in both themes", async ({ page }) => {
  await page.goto("/design-system");
  const canvas = { light: "rgb(250, 250, 250)", dark: "rgb(0, 0, 0)" };
  const surface = { light: "rgb(255, 255, 255)", dark: "rgb(10, 10, 10)" };
  for (const theme of ["light", "dark"] as const) {
    for (const title of ["Section and panel", "Stat group", "Media card", "Empty state", "Code block", "Disclosure", "Table"]) {
      const frame = page.getByRole("region", { name: `${title}, ${theme}` });
      await expect(frame, `${title}, ${theme}`).toHaveCSS("background-color", canvas[theme]);
      // Panels, code blocks, stat cells (the group's own fill draws its dividers), cards, and disclosure panels.
      const backgrounds = await frame.evaluate((element) =>
        [...element.querySelectorAll("[data-panel]:not(dl), dl[data-panel] > div, article:not([aria-disabled]), details")].filter((node) => getComputedStyle(node).borderTopWidth !== "0px" || node.matches("dl > div")).map((node) => getComputedStyle(node).backgroundColor),
      );
      expect(backgrounds.length, `${title}, ${theme}`).toBeGreaterThan(0);
      expect(new Set(backgrounds), `${title}, ${theme}`).toEqual(new Set([surface[theme]]));
    }
    const unavailable = page.getByRole("region", { name: `Media card, ${theme}` }).locator("article[aria-disabled]");
    await expect(unavailable).not.toHaveCSS("background-color", canvas[theme]);
  }
});

test("shows description lists both plain and on a surface", async ({ page }) => {
  await page.goto("/design-system#description-list");
  for (const [theme, surface] of [["light", "rgb(255, 255, 255)"], ["dark", "rgb(10, 10, 10)"]] as const) {
    const frame = page.getByRole("region", { name: `Description list, ${theme}` });
    await expect(frame.locator("dl:not([data-panel])")).toHaveCount(2);
    await expect(frame.locator("dl[data-panel]")).toHaveCount(2);
    for (const list of await frame.locator("dl[data-panel]").all()) await expect(list).toHaveCSS("background-color", surface);
  }
});

test("shows every role color in both themes", async ({ page }) => {
  await page.goto("/design-system");
  const swatch = (theme: "light" | "dark", token: string) => page.getByRole("region", { name: `Color, ${theme}` }).locator(`[data-swatch="${token}"] > span`).first();
  for (const theme of ["light", "dark"] as const) {
    await expect(page.getByRole("region", { name: `Color, ${theme}` }).locator("[data-swatch]")).toHaveCount(7);
  }
  await expect(swatch("light", "--color-canvas")).toHaveCSS("background-color", "rgb(250, 250, 250)");
  await expect(swatch("dark", "--color-canvas")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(swatch("light", "--color-primary")).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await expect(swatch("dark", "--color-primary")).toHaveCSS("background-color", "rgb(237, 237, 237)");
  await expect(swatch("light", "--color-accent")).toHaveCSS("background-color", "rgb(0, 104, 214)");
  await expect(swatch("dark", "--color-accent")).toHaveCSS("background-color", "rgb(82, 168, 255)");
});

test("draws check boxes, inputs, and selects consistently", async ({ page }) => {
  await page.goto("/design-system");
  const form = light(page, "Form controls");
  const boxes = form.locator('input[type="checkbox"]');
  const sizes = await boxes.evaluateAll((inputs) => inputs.map((input) => `${input.getBoundingClientRect().width}x${input.getBoundingClientRect().height}`));
  expect(new Set(sizes)).toEqual(new Set(["16x16"]));
  const input = form.getByLabel("Name", { exact: true });
  const select = form.getByLabel("Severity");
  expect(await height(input)).toBe(await height(select));
  const border = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(await border(input)).toBe(await border(select));
});

test.describe("on a touch device", () => {
  test.use({ hasTouch: true });

  test("gives every control a 44px target", async ({ page }) => {
    await page.goto("/design-system");
    const buttons = light(page, "Buttons");
    expect(await height(buttons.locator('[data-size-sample="md"]'))).toBeGreaterThanOrEqual(44);
    expect(await height(buttons.locator('[data-size-sample="sm"]'))).toBeGreaterThanOrEqual(44);
  });
});

for (const width of [1280, 375]) {
  test(`keeps table rows one height with and without actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/design-system");
    const table = light(page, "Table");
    // clientHeight leaves out the collapsed row border, which only the first row has.
    const inner = (row: string) => table.locator(`[data-row-sample="${row}"] td`).first().evaluate((cell) => cell.clientHeight);
    const withActions = await inner("actions");
    const withoutActions = await inner("plain");
    expect(withActions).toBe(withoutActions);
  });
}

for (const [width, narrow] of [[1280, false], [375, true]] as const) {
  test(`lays out the page header at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/design-system#page-header");
    const specimen = light(page, "Page header");
    const header = specimen.locator("header").first();
    await expect(header.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    await expect(header.getByRole("heading", { level: 3, name: "Assessment #3" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Start Assessment" })).toBeVisible();
    if (narrow) {
      await expect(header.getByRole("link", { name: "Edit" })).toBeHidden();
      await header.getByRole("button", { name: "More actions" }).click();
      await expect(page.locator("[popover]:popover-open").getByRole("link", { name: "Edit" })).toBeVisible();
    } else {
      await expect(header.getByRole("link", { name: "Edit" })).toBeVisible();
      await expect(header.getByRole("button", { name: "More actions" })).toBeHidden();
    }
  });
}

test("opens a menu inside a scrolling table without clipping, and closes it on Escape and an outside click", async ({ page }) => {
  await page.goto("/design-system");
  const table = light(page, "Table");
  const trigger = table.getByRole("button", { name: "Actions in a scrolling table, light" });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const item = page.getByRole("link", { name: "Open Release" }).first();
  await expect(item).toBeVisible();
  // The item is the topmost element at its own center: nothing clips or covers it.
  const box = (await item.boundingBox())!;
  const topmost = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(topmost).toBe("Open Release");

  await page.keyboard.press("Escape");
  await expect(item).toBeHidden();
  await trigger.click();
  await expect(item).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(item).toBeHidden();
});

test("copies a digest's full value", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/design-system");
  const sample = light(page, "Tags and copy").locator("[data-copy-sample]");
  await sample.getByRole("button", { name: "Copy digest" }).click();
  await expect(sample.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("4807ba9e52ea3f1c9d0b7a6e5f4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2a");
});

test("applies a filter as soon as it changes and offers to clear it", async ({ page }) => {
  await page.goto("/design-system");
  const bar = page.getByRole("form", { name: "Filter demo" });
  await expect(bar.getByRole("button", { name: "Apply" })).toBeHidden();
  await bar.getByLabel("Tone").selectOption("error");
  await expect(page).toHaveURL(/tone=error/);
  await expect(page.getByText("Filtered to error")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByText("No filter")).toBeVisible();
});

test("applies a filter rail option as soon as it changes and shows each option's count", async ({ page }) => {
  await page.goto("/design-system#filter-rail");
  const rail = page.getByRole("form", { name: "Filter rail demo" });
  await expect(rail.getByRole("button", { name: "Apply" })).toBeHidden();
  await expect(rail.getByRole("group", { name: "Kind" })).toContainText("Policy4Plugin2Retired0");
  await expect(rail.getByRole("checkbox", { name: /Retired/ })).toBeDisabled();
  await rail.getByRole("checkbox", { name: /Plugin/ }).check();
  await expect(page).toHaveURL(/kind=plugin/);
  await expect(page.getByText("Filtered to plugin")).toBeVisible();
  await rail.getByRole("link", { name: "Clear" }).click();
  await expect(page.getByText("No filter")).toBeVisible();
});

test("collapses the filter rail into a Filters disclosure with the active count on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/design-system?kind=policy#filter-rail");
  const rail = page.getByRole("form", { name: "Filter rail demo" });
  const checkbox = rail.getByRole("checkbox", { name: /Policy/ });
  await expect(checkbox).toBeHidden();
  await rail.locator("summary").first().click();
  await expect(rail.locator("summary").first()).toContainText("1 active");
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toBeChecked();
});

test("opens a media card from anywhere on the card, with the title as its one focus stop", async ({ page }) => {
  await page.goto("/design-system#media-card");
  const card = light(page, "Media card").getByRole("article").filter({ hasText: "Market watch" });
  const box = (await card.locator("p").boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect(page).toHaveURL(/card=light/);

  await expect(light(page, "Media card").getByRole("article").filter({ hasText: "Unavailable card" }).getByRole("link")).toHaveCount(0);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("applies filter rail options with the Apply button", async ({ page }) => {
    await page.goto("/design-system#filter-rail");
    const rail = page.getByRole("form", { name: "Filter rail demo" });
    await rail.getByRole("checkbox", { name: /Policy/ }).check();
    await rail.getByRole("checkbox", { name: /Plugin/ }).check();
    await rail.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/kind=policy&kind=plugin/);
    await expect(page.getByText("Filtered to policy and plugin")).toBeVisible();
  });

  test("opens a menu and applies filters with the Apply button", async ({ page }) => {
    await page.goto("/design-system");
    await light(page, "Menu").getByRole("button", { name: "Row actions, light" }).click();
    await expect(page.getByRole("link", { name: "Edit" }).filter({ visible: true }).first()).toBeVisible();

    const bar = page.getByRole("form", { name: "Filter demo" });
    await bar.getByLabel("Tone").selectOption("success");
    await bar.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/tone=success/);
    await expect(page.getByText("Filtered to success")).toBeVisible();
  });
});
