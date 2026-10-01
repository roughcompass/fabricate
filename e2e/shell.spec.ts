import type { Page } from "@playwright/test";
import { findingsOf } from "../src/lib/evaluations/evaluation-records";
import { profilesOf } from "../src/lib/profiles/profile-records";
import { buildSource } from "../test/support/builders";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { BASELINE_CONTROLS, SERVICE_CONTROLS, evaluate, seedResults } from "./support/results";
import { seedDemoSurfaces, seedOperatorSurfaces, surfaceUrl } from "./support/surfaces";

// operator-interface/page-patterns spec: the application shell and the
// sidebar navigation that drills into each section. The narrow-viewport
// drawer has its own cases below.

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/** The sidebar shows the sub-menu of `section` with `current` marked as the page's item. */
async function expectSubmenu(page: Page, section: string, items: string[], current: string) {
  const nav = primary(page);
  await expect(nav.locator("#sidebar-section-title")).toHaveText(section);
  await expect(nav.getByRole("link", { name: "Show all sections" })).toBeVisible();
  for (const item of items) await expect(nav.getByRole("link", { name: item, exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: current, exact: true })).toHaveAttribute("aria-current", "page");
  for (const item of items.filter((name) => name !== current)) await expect(nav.getByRole("link", { name: item, exact: true })).not.toHaveAttribute("aria-current");
}

test.describe("on a wide viewport", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("renders the shell with a skip link and the current section's sub-menu", async ({ page, db: _db }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Initiatives · Fabricate");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
    await expect(page.getByRole("link", { name: "Fabricate home" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dark theme" })).toBeVisible();
    await expectSubmenu(page, "Initiatives", ["All Initiatives", "New Initiative"], "All Initiatives");
    // The section menu is not shown while a section's sub-menu is.
    await expect(primary(page).getByRole("link", { name: "Sources", exact: true })).toBeHidden();
  });

  test("Choosing a section opens its first page and its sub-menu", async ({ page, db: _db }) => {
    await page.goto("/");
    await primary(page).getByRole("link", { name: "Show all sections" }).click();
    await primary(page).getByRole("link", { name: "Sources", exact: true }).click();
    await expect(page).toHaveURL(/\/sources$/);
    await expectSubmenu(page, "Sources", ["All Sources", "Add Source", "Import Sources"], "All Sources");
  });

  test("Record page: a Repository Profile marks All Initiatives", async ({ page, db }) => {
    const { assessment } = await seedResults(db);
    const profile = profilesOf(db, assessment.id)[0]!.profile;
    await page.goto(`/profiles/${profile.publicId}`);
    await expectSubmenu(page, "Initiatives", ["All Initiatives", "New Initiative"], "All Initiatives");
  });

  test("Current section on a deep page: a Finding marks All Initiatives", async ({ page, db }) => {
    const { initiative, assessment } = await seedResults(db);
    const evaluation = await evaluate(db, initiative.publicId, assessment.publicId);
    const finding = findingsOf(db, evaluation.id)[0]!;
    await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);
    await expectSubmenu(page, "Initiatives", ["All Initiatives", "New Initiative"], "All Initiatives");
  });

  test("Create page: Add Source is current, not All Sources", async ({ page, db: _db }) => {
    await page.goto("/sources/new");
    await expectSubmenu(page, "Sources", ["All Sources", "Add Source", "Import Sources"], "Add Source");
  });

  test("Returning to all sections keeps the page and focuses the current section", async ({ page, db }) => {
    const { assessment } = await seedResults(db);
    await page.goto(`/assessments/${assessment.publicId}`);
    const nav = primary(page);
    await nav.getByRole("link", { name: "Show all sections" }).click();
    const initiatives = nav.getByRole("link", { name: "Initiatives", exact: true });
    await expect(initiatives).toHaveAttribute("aria-current", "true");
    await expect(initiatives).toBeFocused();
    for (const section of ["Sources", "Standards", "Templates"]) await expect(nav.getByRole("link", { name: section, exact: true })).not.toHaveAttribute("aria-current");
    await expect(page).toHaveURL(new RegExp(`/assessments/${assessment.publicId}$`));
    await expect(nav.getByRole("link", { name: "All Initiatives" })).toBeHidden();

    // Opening another page shows that page's sub-menu again.
    await nav.getByRole("link", { name: "Standards", exact: true }).click();
    await expectSubmenu(page, "Standards", ["All Standards", "New Standard"], "All Standards");
  });

  test("Page outside every section: the gallery shows the section menu with nothing current", async ({ page, db: _db }) => {
    await page.goto("/design-system");
    const nav = primary(page);
    for (const section of ["Initiatives", "Sources", "Standards", "Templates"]) {
      await expect(nav.getByRole("link", { name: section, exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: section, exact: true })).not.toHaveAttribute("aria-current");
    }
    await expect(nav.getByRole("link", { name: "Show all sections" })).toHaveCount(0);
  });

  // The browser-test server runs with the template demo enabled; the
  // demo-disabled navigation is covered by test/components/app-shell.test.ts
  // and test/components/navigation.test.ts.
  test("the Templates section opens the create page", async ({ page, db: _db }) => {
    await page.goto("/");
    await primary(page).getByRole("link", { name: "Show all sections" }).click();
    await primary(page).getByRole("link", { name: "Templates", exact: true }).click();
    await expect(page).toHaveURL(/\/new$/);
    await expectSubmenu(page, "Templates", ["New application", "Gallery", "Applications"], "New application");
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("Returning without JavaScript shows the section menu, and a section opens its sub-menu", async ({ page, db }) => {
      const { assessment } = await seedResults(db);
      await page.goto(`/assessments/${assessment.publicId}`);
      const nav = primary(page);
      await nav.getByRole("link", { name: "Show all sections" }).click();
      await expect(page).toHaveURL(/#sidebar-sections$/);
      await expect(nav.getByRole("link", { name: "Initiatives", exact: true })).toHaveAttribute("aria-current", "true");
      await nav.getByRole("link", { name: "Standards", exact: true }).click();
      await expect(page).toHaveURL(/\/standards$/);
      await expectSubmenu(page, "Standards", ["All Standards", "New Standard"], "All Standards");
    });
  });
});

// The page title moves into the shell header: one h1 per page, centered in the header.
test.describe("the shell header", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const header = (page: Page) => page.locator("[data-shell-header]");

  test("Title in the header: an Assessment's name, centered, is the page's only h1", async ({ page, db }) => {
    const { assessment } = await seedResults(db);
    await page.goto(`/assessments/${assessment.publicId}`);
    const title = header(page).getByRole("heading", { level: 1 });
    await expect(title).toHaveText("Assessment #1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const [titleBox, headerBox] = [(await title.boundingBox())!, (await header(page).boundingBox())!];
    expect(Math.abs(titleBox.x + titleBox.width / 2 - (headerBox.x + headerBox.width / 2))).toBeLessThan(2);
  });

  test("Title appears once: the page content does not repeat an Initiative's name", async ({ page, db }) => {
    const { initiative } = await seedResults(db);
    await page.goto(`/initiatives/${initiative.publicId}`);
    await expect(header(page).getByRole("heading", { level: 1 })).toHaveText("Fleet assessment");
    await expect(page.locator("[data-page-header]")).not.toContainText("Fleet assessment");
  });

  test("Breadcrumbs on a Finding: the Control title in the header, its ancestors in the page", async ({ page, db }) => {
    const { initiative, assessment } = await seedResults(db);
    const evaluation = await evaluate(db, initiative.publicId, assessment.publicId);
    const finding = findingsOf(db, evaluation.id)[0]!;
    const control = [...BASELINE_CONTROLS, ...SERVICE_CONTROLS].find((candidate) => candidate.key === finding.controlKey)!;
    await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);
    await expect(header(page).getByRole("heading", { level: 1 })).toHaveText(control.title as string);
    const crumbs = page.locator("[data-page-header]").getByRole("navigation", { name: "Breadcrumb" }).getByRole("link");
    await expect(crumbs).toHaveText(["Initiatives", "Fleet assessment", "Evaluation #1"]);
  });

  test("Scrolling a long page keeps the header and the sidebar in view", async ({ page, db }) => {
    const { initiative, assessment } = await seedResults(db);
    const evaluation = await evaluate(db, initiative.publicId, assessment.publicId);
    await page.goto(`/evaluations/${evaluation.publicId}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    expect((await header(page).boundingBox())!.y).toBe(0);
    expect((await page.locator("#sidebar").boundingBox())!.y).toBe(0);
    await expect(header(page).getByRole("heading", { level: 1 })).toBeInViewport();
    await expect(primary(page).getByRole("link", { name: "All Initiatives" })).toBeInViewport();
  });

  test("every surface has exactly one h1, in the shell header", async ({ page, context, db, sourcesDir }) => {
    test.setTimeout(240_000);
    const surfaces = [...(await seedOperatorSurfaces(db, sourcesDir)), ...(await seedDemoSurfaces(page, context, db))];
    for (const [name, url] of surfaces) {
      await page.goto(surfaceUrl(url));
      await expect(page.locator("h1"), name).toHaveCount(1);
      await expect(header(page).locator("h1"), name).toHaveCount(1);
    }
  });
});

// The sidebar can be resized and hidden, and the browser remembers both.
test.describe("an adjustable sidebar", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const sidebar = (page: Page) => page.locator("#sidebar");
  const showSidebar = (page: Page) => page.locator("[data-shell-header]").getByRole("button", { name: "Show sidebar" });
  const hideSidebar = (page: Page) => sidebar(page).getByRole("button", { name: "Hide sidebar" });

  test("Hiding and showing: the sidebar stays hidden across pages and comes back at its width", async ({ page, db: _db, baseURL }) => {
    await page.context().addCookies([{ name: "fabricate-sidebar-width", value: "320", url: baseURL! }]);
    await page.goto("/sources");
    await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(320);
    await hideSidebar(page).click();
    await expect(sidebar(page)).toBeHidden();
    await expect(showSidebar(page)).toBeFocused();
    // The content takes the whole width. (Under reduced motion every change still takes one 0.01ms transition frame.)
    await expect.poll(async () => (await page.locator("main").boundingBox())!.x).toBe(0);

    await page.goto("/standards");
    await expect(sidebar(page)).toBeHidden();
    await expect(showSidebar(page)).toBeVisible();
    await showSidebar(page).click();
    await expect(sidebar(page)).toBeVisible();
    await expect.poll(async () => (await sidebar(page).boundingBox())!.width).toBe(320);
    await expect(hideSidebar(page)).toBeFocused();
    await expect(showSidebar(page)).toBeHidden();
  });

  const resizer = (page: Page) => page.getByRole("separator", { name: "Resize sidebar" });
  const sidebarWidth = async (page: Page) => (await sidebar(page).boundingBox())!.width;

  /** Drags the resize control horizontally by `dx` pixels. */
  async function dragBy(page: Page, dx: number) {
    const box = (await resizer(page).boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 8 });
    await page.mouse.up();
  }

  test("Resizing by dragging: the server renders the remembered width on the next load", async ({ page, context, db: _db }) => {
    await page.goto("/sources");
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "256");
    await dragBy(page, 64);
    await expect.poll(() => sidebarWidth(page)).toBe(320);
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "320");
    await expect(resizer(page)).toHaveAttribute("aria-valuetext", "320 pixels");

    // The next response already carries the width, so the page loads at it without shifting.
    expect(await (await context.request.get("/sources")).text()).toContain("--_sidebar-width:320px");
    await page.reload();
    expect(await sidebarWidth(page)).toBe(320);
  });

  test("Dragging past the limit stops at 400px", async ({ page, db: _db }) => {
    await page.goto("/sources");
    await dragBy(page, 300);
    await expect.poll(() => sidebarWidth(page)).toBe(400);
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "400");
  });

  test("Resizing with the keyboard: Right Arrow widens by 16px, Home and End go to the limits", async ({ page, db: _db }) => {
    await page.goto("/sources");
    await resizer(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => sidebarWidth(page)).toBe(272);
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "272");
    await expect(resizer(page)).toHaveAttribute("aria-valuetext", "272 pixels");
    await page.keyboard.press("Home");
    await expect.poll(() => sidebarWidth(page)).toBe(200);
    await page.keyboard.press("End");
    await expect.poll(() => sidebarWidth(page)).toBe(400);
  });

  test("Restoring the default width with a double-click", async ({ page, db: _db, baseURL }) => {
    await page.context().addCookies([{ name: "fabricate-sidebar-width", value: "360", url: baseURL! }]);
    await page.goto("/sources");
    expect(await sidebarWidth(page)).toBe(360);
    await resizer(page).dblclick();
    await expect.poll(() => sidebarWidth(page)).toBe(256);
  });

  test("Out-of-range stored width renders at the maximum", async ({ page, db: _db, baseURL }) => {
    await page.context().addCookies([{ name: "fabricate-sidebar-width", value: "9999", url: baseURL! }]);
    await page.goto("/sources");
    expect(await sidebarWidth(page)).toBe(400);
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "400");
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("Hiding without JavaScript renders the next page with the sidebar hidden", async ({ page, db: _db }) => {
      await page.goto("/sources");
      await hideSidebar(page).click();
      await expect(sidebar(page)).toBeHidden();
      await expect(showSidebar(page)).toBeVisible();
      await page.goto("/standards");
      await expect(sidebar(page)).toBeHidden();
      await showSidebar(page).click();
      await expect(sidebar(page)).toBeVisible();
    });
  });
});

// Layouts follow the content column, so the widest sidebar never causes overflow.
test.describe("a wide sidebar on a laptop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Wide sidebar on a laptop: no page overflows beside a 400px sidebar", async ({ page, db, sourcesDir, baseURL }) => {
    test.setTimeout(120_000);
    await page.context().addCookies([{ name: "fabricate-sidebar-width", value: "400", url: baseURL! }]);
    const surfaces = new Map(await seedOperatorSurfaces(db, sourcesDir));
    const pages: [string, string][] = [
      ["Evaluation", surfaceUrl(surfaces.get("08-evaluation")!)],
      ["Profile", surfaceUrl(surfaces.get("06-profile")!)],
      ["Relationship Map", surfaceUrl(surfaces.get("07-map")!)],
      ["Sources list", "/sources"],
      ["Templates gallery", "/templates"],
      ["Standard draft editor", surfaceUrl(surfaces.get("04-draft")!)],
    ];
    for (const [name, url] of pages) {
      await page.goto(url);
      await test.step(name, async () => {
        expect((await page.locator("#sidebar").boundingBox())!.width, name).toBe(400);
        await expectNoHorizontalOverflow(page);
      });
    }
  });
});

// The content column is a size container; an outcome toast rendered inside a
// page must still be fixed to the viewport, not to the column, with a wide
// sidebar and a page taller than the viewport.
test.describe("an outcome toast beside a wide sidebar", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  async function expectOnViewport(page: Page, toast: ReturnType<Page["locator"]>) {
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(1350);
    await expect(toast).toBeInViewport();
    const box = (await toast.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(900 - 40);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    expect(box.x + box.width).toBeGreaterThan(1280 - 48);
  }

  async function setUp(page: Page, db: Parameters<typeof buildSource>[0], baseURL: string) {
    const sources = Array.from({ length: 40 }, (_, index) => buildSource(db, { name: `source-${String(index).padStart(2, "0")}` }));
    await page.context().addCookies([{ name: "fabricate-sidebar-width", value: "400", url: baseURL }]);
    return sources[0]!;
  }

  test("the live toast stays on the viewport", async ({ page, db, baseURL }) => {
    const source = await setUp(page, db, baseURL!);
    await page.goto(`/sources?notice=added&source=${source.publicId}`);
    await expect.poll(async () => (await page.locator("#sidebar").boundingBox())?.width).toBe(400);
    await expectOnViewport(page, page.getByRole("listitem").filter({ hasText: "source-00 was added." }).first());
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the server-rendered toast inside the page stays on the viewport", async ({ page, db, baseURL }) => {
      const source = await setUp(page, db, baseURL!);
      await page.goto(`/sources?notice=added&source=${source.publicId}`);
      await expectOnViewport(page, page.getByRole("status").filter({ hasText: "source-00 was added." }).first());
    });
  });
});

// Below 1024px the sidebar is a drawer, opened from the header.
test.describe("on a narrow viewport", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const openNavigation = (page: Page) => page.locator("[data-shell-header]").getByRole("button", { name: "Open navigation" });

  test("Shell on a narrow viewport: the header shows Open navigation and the title, and no sidebar sits beside the content", async ({ page, db: _db }) => {
    await page.goto("/sources");
    await expect(openNavigation(page)).toBeVisible();
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(primary(page)).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test("Opening the drawer shows the section's sub-menu and the theme control; Escape returns focus", async ({ page, db: _db }) => {
    await page.goto("/sources");
    await openNavigation(page).click();
    const drawer = page.locator("#sidebar");
    await expect(drawer).toBeVisible();
    await expectSubmenu(page, "Sources", ["All Sources", "Add Source", "Import Sources"], "All Sources");
    await expect(drawer.getByRole("button", { name: "Dark theme" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(openNavigation(page)).toBeFocused();
  });

  test("choosing an item closes the drawer and opens the page", async ({ page, db: _db }) => {
    await page.goto("/sources");
    await openNavigation(page).click();
    await primary(page).getByRole("link", { name: "Add Source" }).click();
    await expect(page).toHaveURL(/\/sources\/new$/);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("New Source");
  });

  test.describe("on a touch device", () => {
    test.use({ hasTouch: true });

    test("gives Open navigation and every drawer item a 44px target", async ({ page, db: _db }) => {
      await page.goto("/sources");
      expect((await openNavigation(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await openNavigation(page).click();
      for (const item of ["All Sources", "Add Source", "Import Sources"]) {
        expect((await primary(page).getByRole("link", { name: item, exact: true }).boundingBox())!.height, item).toBeGreaterThanOrEqual(44);
      }
      await expectNoHorizontalOverflow(page);
    });
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("Drawer without JavaScript: it opens, and choosing Add Source opens that page", async ({ page, db: _db }) => {
      await page.goto("/sources");
      await openNavigation(page).click();
      await expect(page.locator("#sidebar")).toBeVisible();
      await primary(page).getByRole("link", { name: "Add Source" }).click();
      await expect(page).toHaveURL(/\/sources\/new$/);
      await expect(page.locator("#sidebar")).toBeHidden();
    });
  });
});
