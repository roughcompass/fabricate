import type { Locator, Page } from "@playwright/test";
import { buildSource } from "../test/support/builders";
import { expect, expectNoNestedBorders, test } from "./support/fixtures";
import { seedResults } from "./support/results";
import { demoSurfaces, seedOperatorSurfaces } from "./support/surfaces";
import { paths } from "./support/paths";

// operator-interface/page-patterns spec: content sits on white surfaces over a gray canvas.

const CANVAS = { light: "rgb(250, 250, 250)", dark: "rgb(0, 0, 0)" };
const SURFACE = { light: "rgb(255, 255, 255)", dark: "rgb(10, 10, 10)" };
const TRANSPARENT = "rgba(0, 0, 0, 0)";

const background = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);

async function useTheme(page: Page, theme: "light" | "dark", baseURL: string) {
  await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL }]);
}

test.use({ viewport: { width: 1440, height: 900 } });

test("Initiative overview on a surface: the list is white, its heading on the canvas", async ({ page, db, baseURL }) => {
  await useTheme(page, "light", baseURL!);
  const { initiative } = await seedResults(db);
  await page.goto(paths.assessment(initiative.publicId));
  const overview = page.locator("section").filter({ has: page.getByRole("heading", { name: "Overview", exact: true }) });
  expect(await background(overview.locator("dl[data-panel]"))).toBe(SURFACE.light);
  expect(await background(overview)).toBe(TRANSPARENT);
  expect(await background(page.locator("body"))).toBe(CANVAS.light);
});

test("Sources list in the light theme: canvas behind the sidebar and filters; the header and the table on white", async ({ page, db, baseURL }) => {
  await useTheme(page, "light", baseURL!);
  buildSource(db, { name: "orders" });
  await page.goto(paths.repositories);
  expect(await background(page.locator("body"))).toBe(CANVAS.light);
  expect(await background(page.locator("#sidebar"))).toBe(CANVAS.light);
  expect(await background(page.locator("[data-shell-header]"))).toBe(SURFACE.light);
  expect(await background(page.getByRole("form", { name: "Search and filter Repositories" }))).toBe(TRANSPARENT);
  expect(await background(page.locator("[data-panel]").filter({ has: page.getByRole("table") }))).toBe(SURFACE.light);
});

test("Form page: New Initiative's form sits on white over the canvas", async ({ page, db: _db, baseURL }) => {
  await useTheme(page, "light", baseURL!);
  await page.goto(paths.newAssessment);
  expect(await background(page.locator("form [data-panel], [data-panel]:has(form)").first())).toBe(SURFACE.light);
  expect(await background(page.locator("body"))).toBe(CANVAS.light);
});

test("Dark theme: the canvas is darker than the surfaces and the header", async ({ page, db, baseURL }) => {
  await useTheme(page, "dark", baseURL!);
  buildSource(db, { name: "orders" });
  await page.goto(paths.repositories);
  expect(await background(page.locator("body"))).toBe(CANVAS.dark);
  expect(await background(page.locator("[data-panel]").filter({ has: page.getByRole("table") }))).toBe(SURFACE.dark);
  expect(await background(page.locator("[data-shell-header]"))).toBe(SURFACE.dark);
});

test("No nested bordered containers on any surface", async ({ page, db, sourcesDir }) => {
  test.setTimeout(240_000);
  const surfaces = [...(await seedOperatorSurfaces(db, sourcesDir)), ...demoSurfaces()];
  for (const [name, url] of surfaces) {
    await page.goto(url);
    await test.step(name, () => expectNoNestedBorders(page));
  }
});
