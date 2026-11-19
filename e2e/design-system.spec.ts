import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { pageHeader } from "./support/shell";

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

test("draws every icon at 20px in the text color, in both themes", async ({ page }) => {
  await page.goto("/design-system");
  for (const [theme, color] of [["light", "rgb(23, 23, 23)"], ["dark", "rgb(237, 237, 237)"]] as const) {
    const svgs = page.getByRole("region", { name: `Icons, ${theme}` }).locator("[data-icon] svg");
    expect(await svgs.count()).toBeGreaterThan(10);
    for (const svg of await svgs.all()) {
      await expect(svg).toBeVisible();
      expect(await svg.evaluate((element) => element.getBoundingClientRect().width)).toBe(20);
    }
    await expect(svgs.first()).toHaveCSS("color", color);
  }
});

test("draws choice cards with icons in every state, in both themes, and moves the choice with the arrow keys", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-system");
  const card = (theme: "light" | "dark", label: string) => page.getByRole("region", { name: `Form controls, ${theme}` }).getByRole("group", { name: "Platform, with icons" }).locator("label").filter({ hasText: label });
  for (const theme of ["light", "dark"] as const) {
    for (const label of ["Web", "Mobile", "Desktop"]) await expect(card(theme, label).locator("svg")).toBeVisible();
  }

  // Checked takes the primary border; default and hover differ.
  await expect(card("light", "Web")).toHaveCSS("border-top-color", "rgb(23, 23, 23)");
  const before = await card("light", "Mobile").evaluate((element) => getComputedStyle(element).borderTopColor);
  await card("light", "Mobile").hover();
  await expect(card("light", "Mobile")).not.toHaveCSS("border-top-color", before);

  // Focus shows the ring, and the Right arrow moves the choice.
  const web = card("light", "Web").getByRole("radio");
  await web.focus();
  await expect(card("light", "Web")).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("ArrowRight");
  await expect(card("light", "Mobile").getByRole("radio")).toBeChecked();
  await expect(web).not.toBeChecked();

  // Disabled and error, in the dark theme.
  await expect(card("dark", "Desktop").getByRole("radio")).toBeDisabled();
  await expect(card("dark", "Desktop")).toHaveCSS("cursor", "not-allowed");
  const darkGroup = page.getByRole("region", { name: "Form controls, dark" }).getByRole("group", { name: "Platform, with icons" });
  await expect(darkGroup).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("region", { name: "Form controls, dark" }).getByText("Choose the Portal's platform")).toBeVisible();
});

test("tells the states with no value apart by their indicators", async ({ page }) => {
  await page.goto("/design-system");
  const status = light(page, "Status and severity");
  const drawing = (state: string) =>
    status.locator(`span:has(> [data-state="${state}"]) > [data-shape]`).evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.backgroundColor} ${style.boxShadow} ${style.height}`;
    });
  await expect(status.getByText("Unknown", { exact: true })).toBeVisible();
  await expect(status.getByText("None detected", { exact: true })).toBeVisible();
  await expect(status.getByText("Not covered", { exact: true })).toBeVisible();
  const drawings = [await drawing("unknown"), await drawing("absent"), await drawing("not_covered")];
  expect(new Set(drawings).size, drawings.join(" | ")).toBe(3);
});

test("draws check boxes, switches, inputs, and selects consistently", async ({ page }) => {
  await page.goto("/design-system");
  const form = light(page, "Form controls");
  const sizesOf = (locator: Locator) => locator.evaluateAll((inputs) => inputs.map((input) => `${input.getBoundingClientRect().width}x${input.getBoundingClientRect().height}`));
  expect(new Set(await sizesOf(form.locator('input[type="checkbox"]:not([role="switch"])')))).toEqual(new Set(["16x16"]));
  expect(new Set(await sizesOf(form.getByRole("switch")))).toEqual(new Set(["32x18"]));
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

test("keeps table rows one height with and without actions at 1280px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/design-system");
  const table = light(page, "Table");
  // clientHeight leaves out the collapsed row border, which only the first row has.
  const inner = (row: string) => table.locator(`[data-row-sample="${row}"] td`).first().evaluate((cell) => cell.clientHeight);
  const withActions = await inner("actions");
  const withoutActions = await inner("plain");
  expect(withActions).toBe(withoutActions);
});

// page-patterns spec, "Layouts adapt to narrow viewports": a stacked row's actions are at its top, not orphaned at its bottom.
test("puts a stacked row's actions at its top, beside its first cell and no taller than it, at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/design-system");
  const row = light(page, "Table").locator('[data-row-sample="actions"]');
  const box = (cell: string) => row.locator(cell).evaluate((element) => element.getBoundingClientRect().toJSON() as DOMRect);
  const [first, actions] = await Promise.all([box("td:first-child"), box("td:last-child")]);
  expect(Math.abs(actions.top - first.top)).toBeLessThanOrEqual(1);
  expect(actions.bottom).toBeLessThanOrEqual(first.bottom + 1);
  expect(actions.left).toBeGreaterThanOrEqual(first.right);
});

for (const [width, narrow] of [[1280, false], [375, true]] as const) {
  test(`lays out the page header at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/design-system#page-header");
    const specimen = light(page, "Page header");
    const header = specimen.locator("header").first();
    await expect(header.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    await expect(header.getByRole("heading", { level: 3, name: "Run #3" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Start Evaluation" })).toBeVisible();
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

// operator-interface/page-templates spec: the gallery shows every template.
const TEMPLATE_NAMES = ["Dashboard", "Index", "Details", "Analysis", "Form", "Flow", "Editor", "Settings", "Content", "System"];

test("Gallery shows every template: each of the ten with its empty and loading states, in both themes", async ({ page }) => {
  await page.goto("/design-system");
  const index = page.getByRole("list", { name: "Components" });
  for (const name of TEMPLATE_NAMES) {
    await expect(index.getByRole("link", { name: `${name} template`, exact: true })).toHaveAttribute("href", `#template-${name.toLowerCase()}`);
    for (const theme of ["light", "dark"] as const) {
      const frame = page.getByRole("region", { name: `${name} template, ${theme}` });
      await expect(frame, `${name}, ${theme}`).toHaveAttribute("data-theme", theme);
      // The example and the empty state each show the template's page header; a System page shows its two conditions instead.
      const states = name === "System" ? ["Not found", "Error", "Loading"] : ["Example", "Empty", "Loading"];
      for (const state of states) await expect(frame.getByText(state, { exact: true }), `${name}, ${theme}: ${state}`).toBeVisible();
      expect(await pageHeader(frame, name.toLowerCase()).count(), `${name}, ${theme}`).toBeGreaterThanOrEqual(2);
      await expect(frame.locator('[aria-busy="true"]'), `${name}, ${theme}: skeleton`).toHaveCount(1);
    }
  }
  // Specimens title their headers below the gallery's own headings, so the page keeps one h1.
  await expect(page.locator("h1")).toHaveCount(1);
});

test("Flow in the gallery: every step keeps the task's title and shows its position, and the review links back to each step", async ({ page }) => {
  await page.goto("/design-system#template-flow");
  const flow = () => page.getByRole("region", { name: "Flow template, light" });
  const title = () => pageHeader(flow(), "flow").getByRole("heading", { name: "Add a Repository" });

  await expect(title()).toBeVisible();
  await expect(flow().getByText("Step 1 of 3")).toBeVisible();
  await flow().getByRole("textbox", { name: "Name" }).fill("web");
  await flow().getByRole("button", { name: "Next" }).click();

  await expect(page).toHaveURL(/flowStep=2/);
  await expect(title()).toBeVisible();
  await expect(flow().getByText("Step 2 of 3")).toBeVisible();
  await flow().getByText("Library", { exact: true }).click();
  await flow().getByRole("button", { name: "Next" }).click();

  await expect(page).toHaveURL(/flowStep=3/);
  await expect(title()).toBeVisible();
  await expect(flow().getByText("Step 3 of 3")).toBeVisible();
  await expect(flow().getByText("web", { exact: true })).toBeVisible();
  await expect(flow().getByText("Library", { exact: true })).toBeVisible();
  await expect(flow().getByRole("link", { name: "Change kind" })).toBeVisible();
  await flow().getByRole("link", { name: "Change name" }).click();
  await expect(flow().getByText("Step 1 of 3")).toBeVisible();
  await expect(flow().getByRole("textbox", { name: "Name" })).toHaveValue("web");
});
