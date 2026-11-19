import type { Locator } from "@playwright/test";
import { addBitbucketToken } from "../src/lib/admin/bitbucket-tokens";
import { buildRepository } from "../test/support/builders";
import { expect, expectNoNestedBorders, test } from "./support/fixtures";
import { seedResults } from "./support/results";
import { limitViolations } from "./support/page-limits";
import { type Surface, demoSurfaces, seedOperatorSurfaces } from "./support/surfaces";
import { paths } from "./support/paths";
import { pageHeader, useTheme } from "./support/shell";

// operator-interface/page-patterns spec: content sits on white surfaces over a
// gray canvas. page-templates spec: every page's one h1 is in its page header,
// and no page exceeds its template's limits.

const CANVAS = { light: "rgb(250, 250, 250)", dark: "rgb(0, 0, 0)" };
const SURFACE = { light: "rgb(255, 255, 255)", dark: "rgb(10, 10, 10)" };
const TRANSPARENT = "rgba(0, 0, 0, 0)";

const background = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);

test.use({ viewport: { width: 1440, height: 900 } });

test("Initiative overview on a surface: the list is white, its heading on the canvas", async ({ page, db, baseURL }) => {
  await useTheme(page.context(), "light", baseURL!);
  const { assessment } = await seedResults(db);
  await page.goto(paths.assessment(assessment.publicId));
  const overview = page.locator("section").filter({ has: page.getByRole("heading", { name: "Overview", exact: true }) });
  expect(await background(overview.locator("dl[data-panel]"))).toBe(SURFACE.light);
  expect(await background(overview)).toBe(TRANSPARENT);
  expect(await background(page.locator("body"))).toBe(CANVAS.light);
});

test("Sources list in the light theme: canvas behind the sidebar and filters; the header and the table on white", async ({ page, db, baseURL }) => {
  await useTheme(page.context(), "light", baseURL!);
  buildRepository(db, { name: "orders" });
  await page.goto(paths.repositories);
  expect(await background(page.locator("body"))).toBe(CANVAS.light);
  expect(await background(page.locator("#sidebar"))).toBe(CANVAS.light);
  expect(await background(page.locator("[data-shell-header]"))).toBe(SURFACE.light);
  expect(await background(page.getByRole("form", { name: "Search Repositories" }))).toBe(TRANSPARENT);
  expect(await background(page.locator("[data-panel]").filter({ has: page.getByRole("table") }))).toBe(SURFACE.light);
});

test("Form page: New Initiative's form sits on white over the canvas", async ({ page, db: _db, baseURL }) => {
  await useTheme(page.context(), "light", baseURL!);
  await page.goto(paths.newAssessment);
  expect(await background(page.locator("form [data-panel], [data-panel]:has(form)").first())).toBe(SURFACE.light);
  expect(await background(page.locator("body"))).toBe(CANVAS.light);
});

test("Dark theme: the canvas is darker than the surfaces and the header", async ({ page, db, baseURL }) => {
  await useTheme(page.context(), "dark", baseURL!);
  buildRepository(db, { name: "orders" });
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

/** Every page: the captured operator surfaces, the routes they leave out, each seeded, and the product site's pages. */
async function everyPage(db: Parameters<typeof seedOperatorSurfaces>[0], sourcesDir: string): Promise<Surface[]> {
  const surfaces = [...(await seedOperatorSurfaces(db, sourcesDir)), ...demoSurfaces()];
  addBitbucketToken(db, { name: "Platform team", serverUrl: "https://bitbucket.example.com", token: "BBDC-surface-token-0000" });
  const url = (name: string) => surfaces.find(([candidate]) => candidate === name)![1];
  const profile = url("06-profile");
  const evidenceId = url("06-evidence").split("/").at(-1)!;
  return [
    ...surfaces,
    ["10-repository-version", `${url("03-repository")}/versions/1`],
    ["10-profile-evidence", `${profile}/evidence/${evidenceId}`],
    ["10-bitbucket-tokens", "/admin/bitbucket-tokens"],
    ["10-bitbucket-token-new", "/admin/bitbucket-tokens/new"],
    ["10-unknown-address", "/no-such-page"],
    ["14-docs", "/docs/get-started/add-your-repository"],
    ["14-docs-surveyor", "/docs/reference/fact-document"],
    ["14-docs-not-found", "/docs/get-started/nowhere"],
  ];
}

test("every operator page has exactly one h1, in its page header, and none in the shell header", async ({ page, db, sourcesDir }) => {
  test.setTimeout(300_000);
  for (const [name, url] of await everyPage(db, sourcesDir)) {
    await page.goto(url);
    await test.step(name, async () => {
      await expect(page.locator("h1"), name).toHaveCount(1);
      await expect(page.locator("[data-shell-header] h1"), name).toHaveCount(0);
      // A focused page, such as preview mode, has no page header: its title is the h1 of its content, for assistive technology only.
      if (await page.locator("[data-focused-page]").count()) await expect(page.locator("[data-focused-page] > h1.visually-hidden"), name).toHaveCount(1);
      else await expect(pageHeader(page).locator("h1"), name).toHaveCount(1);
    });
  }
});

test("Limits on every page: one primary action, three secondary actions, four meta facts, seven tabs, and five key figures", async ({ page, db, sourcesDir }) => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  for (const [name, url] of await everyPage(db, sourcesDir)) {
    await page.goto(url);
    for (const problem of await limitViolations(page)) problems.push(`${name} (${url}): ${problem}`);
  }
  expect(problems).toEqual([]);
});

test("the limit check names the page's every limit it exceeds", async ({ page }) => {
  const repeat = (count: number, html: (index: number) => string) => Array.from({ length: count }, (_, index) => html(index)).join("");
  await page.setContent(`
    <main>
      <header data-page-header>
        <div data-header-actions>${repeat(4, (index) => `<a href="#a${index}">Action ${index}</a>`)}<button data-variant="primary">Start Run</button></div>
        <div data-header-meta>${repeat(5, (index) => `<span data-meta-item>Fact ${index}</span>`)}</div>
        <nav data-scroll-x aria-label="Views">${repeat(8, (index) => `<a href="#v${index}">View ${index}</a>`)}</nav>
      </header>
      <button data-variant="primary">Start Evaluation</button>
      <dl data-key-figures>${repeat(6, (index) => `<div data-key-figure><dt>Figure ${index}</dt><dd>${index}</dd></div>`)}</dl>
    </main>`);
  expect(await limitViolations(page)).toEqual(["2 primary actions: Start Run, Start Evaluation", "4 secondary actions in the page header", "5 facts in the meta row", '8 tabs in "Views"', "6 key figures in a row"]);
});
