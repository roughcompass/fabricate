import type { Page } from "@playwright/test";
import { buildRepository } from "../test/support/builders";
import { expect, test } from "./support/fixtures";
import { paths } from "./support/paths";

/** The design system's foundations: bundled typefaces and the theme preference. */

// Retrying, because reduced motion gives every property a near-zero transition.
const expectBackground = (page: Page, color: string) => expect(page.locator("body")).toHaveCSS("background-color", color);
// The page background is the canvas: light gray in the light theme, black in the dark.
const LIGHT = "rgb(250, 250, 250)";
const DARK = "rgb(0, 0, 0)";

test("renders text in Geist Sans and identifiers in Geist Mono, served by the application", async ({ page, db }) => {
  const repository = buildRepository(db, { name: "orders" });
  const fonts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fonts.push(request.url());
  });

  await page.goto(paths.repositories);
  await page.evaluate(() => document.fonts.ready);

  const firstFamily = (locator: ReturnType<Page["locator"]>) => locator.first().evaluate((element) => getComputedStyle(element).fontFamily.split(",")[0]!.trim());
  expect(await firstFamily(page.locator("body"))).toMatch(/geist/i);
  // The clone URL is an identifier, shown as a Tag.
  expect(await firstFamily(page.getByRole("table").getByText(repository.cloneUrl, { exact: true }))).toMatch(/geist.*mono|mono.*geist/i);

  const loaded = await page.evaluate(() => [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family));
  expect(loaded.some((family) => /geist/i.test(family))).toBe(true);
  expect(fonts.length).toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  expect(fonts.filter((url) => new URL(url).origin !== origin)).toEqual([]);
});

test("keeps a chosen theme across reloads and renders it on the server", async ({ page, db: _db }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(paths.repositories);
  await expectBackground(page, LIGHT);

  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "true");
  await expectBackground(page, DARK);

  // The server renders the preference, so the first paint is already dark.
  const html = await (await page.request.get("/standards")).text();
  expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  await page.reload();
  await expectBackground(page, DARK);

  await page.getByRole("button", { name: "System theme" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("follows the operating system when the preference is System", async ({ page, db: _db }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(paths.repositories);
  await expectBackground(page, DARK);
  await page.emulateMedia({ colorScheme: "light" });
  await expectBackground(page, LIGHT);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("changes the theme preference", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
    await page.getByRole("button", { name: "Dark theme" }).click();
    await page.waitForLoadState("load");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
