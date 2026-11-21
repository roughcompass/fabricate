import type { Locator, Page } from "@playwright/test";
import { addBitbucketToken } from "../src/lib/admin/bitbucket-tokens";
import { storeEntry } from "../src/lib/catalog/entries";
import { saltEntry } from "../test/support/catalog";
import { buildRepository } from "../test/support/builders";
import { expect, expectNoHorizontalOverflow, expectNoNestedBorders, test } from "./support/fixtures";
import { buildOrdersPortal, framedRun, ordersPortalRemote } from "./support/fixture-app";
import { ORDERS_HAPPY_PATH, seedMockSet } from "./support/mock-sets";
import { buildQuotes } from "./support/quotes-fixtures";
import { application, waitForPage, workspaceOf } from "./support/running-app";
import { expectToolbarOnTop, openTool } from "./support/toolbar";
import { seedResults } from "./support/results";
import { limitViolations } from "./support/page-limits";
import { type Surface, applicationSurfaces, importReviewSurface, seedOperatorSurfaces } from "./support/surfaces";
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
  const surfaces = [...(await seedOperatorSurfaces(db, sourcesDir)), ...(await applicationSurfaces(db, sourcesDir)), importReviewSurface(db, (await workspaceOf(page.context(), db)).id)];
  for (const [name, url] of surfaces) {
    await page.goto(url);
    await test.step(name, () => expectNoNestedBorders(page));
  }
});

/** Every page: the captured operator surfaces, the routes they leave out, each seeded, and the product site's pages; Review HAR is the upload of +page+'s workspace. */
async function everyPage(db: Parameters<typeof seedOperatorSurfaces>[0], sourcesDir: string, page: Page): Promise<Surface[]> {
  const surfaces = [...(await seedOperatorSurfaces(db, sourcesDir)), ...(await applicationSurfaces(db, sourcesDir)), importReviewSurface(db, (await workspaceOf(page.context(), db)).id)];
  addBitbucketToken(db, { name: "Platform team", serverUrl: "https://bitbucket.example.com", token: "BBDC-surface-token-0000" });
  storeEntry(db, saltEntry());
  const url = (name: string) => surfaces.find(([candidate]) => candidate === name)![1];
  const profile = url("06-profile");
  const evidenceId = url("06-evidence").split("/").at(-1)!;
  return [
    ...surfaces,
    ["10-repository-version", `${url("03-repository")}/versions/1`],
    ["10-profile-evidence", `${profile}/evidence/${evidenceId}`],
    ["10-system", "/admin/system"],
    ["10-adoption", "/adoption"],
    ["10-adoption-salt", "/adoption/design-systems/salt"],
    ["10-adoption-salt-html", "/adoption/design-systems/salt?view=html"],
    ["10-adoption-salt-snapshots", "/adoption/design-systems/salt?view=snapshots"],
    ["10-adoption-button", "/adoption/design-systems/salt/components/Button"],
    ["10-adoption-package", "/adoption/packages/@salt-ds/core"],
    ["10-bitbucket-tokens", "/admin/bitbucket-tokens"],
    ["10-bitbucket-token-new", "/admin/bitbucket-tokens/new"],
    ["10-unknown-address", "/no-such-page"],
    ["14-about", "/about"],
    ["14-docs", "/docs/get-started/add-your-repository"],
    ["14-docs-surveyor", "/docs/reference/fact-document"],
    ["14-docs-not-found", "/docs/get-started/nowhere"],
  ];
}

// restore-toolbar-tools-and-branch-previews, task 12.1: the restored panels and overlays keep the toolbar's surface rules in both themes.
test("Microfrontends with regions, Session, Settings, and hot spots: no nested bordered containers, no horizontal overflow, and the toolbar on top, in both themes", async ({ page, db, baseURL }) => {
  test.setTimeout(300_000);
  const { desk } = await buildQuotes(db, { saved: false });
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page.context(), theme, baseURL!);
    await page.goto(framedRun(desk, "/"));
    await waitForPage(page, "Quotes desk");
    for (const [id, dialog] of [
      ["microfrontends", "Microfrontends"],
      ["session", "Session"],
      ["settings", "Settings"],
    ] as const) {
      await openTool(page, id);
      await expect(page.getByRole("dialog", { name: dialog })).toBeVisible();
      if (id === "microfrontends") {
        await page.getByRole("dialog", { name: dialog }).getByLabel("Show regions").check();
        await expect(page.locator('[data-region-outline="@fixtures/quotes-panel"]')).toBeVisible();
      }
      await test.step(`${dialog}, ${theme}`, async () => {
        await expectNoNestedBorders(page, "[data-tool-panel]");
        await expectNoHorizontalOverflow(page);
        await expectToolbarOnTop(page);
      });
      await page.keyboard.press("Escape");
    }
    // Hot spots of the desk's own interactions: a quick one is never outlined.
    await application(page).getByRole("button", { name: "ACME" }).first().click();
    await openTool(page, "timing");
    await page.getByRole("dialog", { name: "Timing" }).getByLabel("Show hot spots").check();
    await test.step(`Timing with hot spots, ${theme}`, async () => {
      await expectNoNestedBorders(page, "[data-tool-panel]");
      await expectToolbarOnTop(page);
    });
    await page.keyboard.press("Escape");
  }
});

// add-mock-sets, task 13.1: Data with its request list and Create rule, the pill's marker, and preview mode's line keep the surface rules in both themes.
test("Data with a set, its request list, and Create rule, the pill's marker, and preview mode's line: no nested bordered containers, no horizontal overflow, and the toolbar on top, in both themes", async ({ page, db, baseURL }) => {
  test.setTimeout(300_000);
  ordersPortalRemote();
  const running = await buildOrdersPortal(db);
  seedMockSet(db, running.application.slug, ORDERS_HAPPY_PATH, { default: true });
  const rates = "GET https://api.orders.test/v1/rates";
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page.context(), theme, baseURL!);
    await page.goto(framedRun(running, "/accounts"));
    await waitForPage(page, "Accounts");
    await expect(page.locator('[data-toolbar="controls"] [data-resting][data-toolbar-item="data"]')).toBeVisible();
    await test.step(`The pill's marker, ${theme}`, () => expectToolbarOnTop(page));
    await openTool(page, "data");
    const data = page.getByRole("dialog", { name: "Data" });
    await data.locator(`[data-request="${rates}"]`).getByRole("button").click();
    await data.getByRole("button", { name: "Create rule" }).click();
    await expect(data.getByRole("form", { name: "Create rule" })).toBeVisible();
    await test.step(`Data with its requests and Create rule, ${theme}`, async () => {
      await expectNoNestedBorders(page, "[data-tool-panel]");
      await expectNoHorizontalOverflow(page);
      await expectToolbarOnTop(page);
    });
    await page.goto(paths.applicationPreview(running.application.slug));
    await expect(page.locator("[data-mock-line]")).toHaveText("Mock set: Happy path. Change it with Data in full screen.");
    await test.step(`Preview mode's line, ${theme}`, async () => {
      await expectNoNestedBorders(page);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test("every operator page has exactly one h1, in its page header, and none in the shell header", async ({ page, db, sourcesDir }) => {
  test.setTimeout(300_000);
  for (const [name, url] of await everyPage(db, sourcesDir, page)) {
    await page.goto(url);
    await test.step(name, async () => {
      await expect(page.locator("h1"), name).toHaveCount(1);
      await expect(page.locator("[data-shell-header] h1"), name).toHaveCount(0);
      // A focused page, such as preview mode, has no page header: its title is the h1 of its content, for assistive technology only.
      // A focused flow, such as onboarding, keeps its page header.
      if (await page.locator("[data-focused-page]:not([data-focused-flow])").count()) await expect(page.locator("[data-focused-page] > h1.visually-hidden"), name).toHaveCount(1);
      else await expect(pageHeader(page).locator("h1"), name).toHaveCount(1);
    });
  }
});

// page-patterns spec, the shell header requirement and finding 26: one banner, one main, and no landmark per item.
test("Landmarks on every page: one banner outside one main, and no region for an item of a list or table", async ({ page, db, sourcesDir }) => {
  test.setTimeout(300_000);
  const pages = await everyPage(db, sourcesDir, page);
  const profile = pages.find(([name]) => name === "06-profile")![1];
  const problems: string[] = [];
  const views = ["composition", "dependencies", "design-system", "services", "tooling", "diagnostics"].map((tab) => [`10-profile-${tab}`, `${profile}?tab=${tab}`] as const);
  for (const [name, url] of [...pages, ...views]) {
    await page.goto(url);
    const found = await page.evaluate(() => {
      const named = (element: Element) => element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby");
      const regions = [...document.querySelectorAll("section, [role=region]")].filter((element) => element.matches("[role=region]") || named(element));
      // A header is a banner unless it sits in sectioning content or main, as a page header does; the shell's and the product site's are.
      const banners = [...document.querySelectorAll("header, [role=banner]")].filter((element) => element.matches("[role=banner]") || !element.parentElement?.closest("article, aside, main, nav, section, [role=main]"));
      return {
        banners: banners.length,
        mains: document.querySelectorAll("main, [role=main]").length,
        bannerInMain: banners.some((banner) => banner.closest("main, [role=main]")),
        perItem: regions.filter((region) => region.closest("li, tr, [role=listitem], [role=row]")).map((region) => region.getAttribute("aria-label") ?? region.id),
        regions: regions.length,
      };
    });
    if (found.banners !== 1) problems.push(`${name}: ${found.banners} banners`);
    if (found.mains !== 1) problems.push(`${name}: ${found.mains} main landmarks`);
    if (found.bannerInMain) problems.push(`${name}: the banner is inside the main landmark`);
    for (const region of found.perItem) problems.push(`${name}: a region for an item, ${region}`);
    // A page's regions are its sections; a dozen or more means its items became landmarks. The gallery's specimens are examples.
    if (found.regions > 12 && name !== "09-design-system") problems.push(`${name}: ${found.regions} regions`);
  }
  expect(problems).toEqual([]);
});

test("Limits on every page: one primary action, three secondary actions, four meta facts, seven tabs, and five key figures", async ({ page, db, sourcesDir }) => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  for (const [name, url] of await everyPage(db, sourcesDir, page)) {
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
