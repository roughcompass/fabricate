import type { Page } from "@playwright/test";
import { findingsOf } from "../src/lib/evaluations/evaluation-records";
import { profilesOf } from "../src/lib/profiles/profile-records";
import { buildSource } from "../test/support/builders";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { BASELINE_CONTROLS, SERVICE_CONTROLS, seedResults, seedEvaluation } from "./support/results";
import { demoSurfaces, seedOperatorSurfaces } from "./support/surfaces";
import { paths } from "./support/paths";
import { pageHeader, useTheme } from "./support/shell";

// operator-interface/page-patterns spec: the application shell, and the
// primary menu: Home, then the Assessments and Templates groups under
// headings and dividers. The narrow-viewport drawer has its own cases below.

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/** The primary menu is shown, with +current+ marked as the page's item, and no other. */
async function expectCurrent(page: Page, current: string) {
  await expect(primary(page)).toBeVisible();
  await expect(primary(page).locator("[aria-current]")).toHaveCount(1);
  await expect(primary(page).getByRole("link", { name: current, exact: true })).toHaveAttribute("aria-current", /page|true/);
}

test.describe("on a wide viewport", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("renders the shell with a skip link and the primary menu with the page's item current", async ({ page, db: _db }) => {
    await page.goto(paths.assessments);
    await expect(page).toHaveTitle("Assessments · Frontend Registry");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
    await expect(page.getByRole("link", { name: "Frontend Registry home" })).toHaveAttribute("href", paths.home);
    // Shell on a wide viewport: the product mark beside the product name.
    await expect(page.locator("#sidebar").getByRole("link", { name: "Frontend Registry home" })).toHaveText("Frontend Registry");
    await expect(page.getByRole("button", { name: "Dark theme" })).toBeVisible();
    await expectCurrent(page, "All Assessments");
  });

  test("Full menu: Home, then the Assessments, Templates, and Admin groups under headings and dividers", async ({ page, db: _db }) => {
    await page.goto(paths.home);
    const nav = primary(page);
    await expect(nav.getByRole("link")).toHaveText(["Home", "Repositories", "All Assessments", "Standards", "Salt Patterns", "Bitbucket tokens"]);
    await expect(nav.locator("hr")).toHaveCount(3);
    await expect(nav.getByRole("list", { name: "Assessments" }).getByRole("link")).toHaveText(["Repositories", "All Assessments", "Standards"]);
    await expect(nav.getByRole("list", { name: "Templates" }).getByRole("link")).toHaveText(["Salt Patterns"]);
    await expect(nav.getByRole("list", { name: "Admin" }).getByRole("link")).toHaveText(["Bitbucket tokens"]);
    // Every item has one icon.
    for (const link of await nav.getByRole("link").all()) await expect(link.locator("svg")).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("Repositories: choosing it opens the list and keeps the primary menu, with Repositories current", async ({ page, db: _db }) => {
    await page.goto(paths.home);
    await primary(page).getByRole("link", { name: "Repositories", exact: true }).click();
    await expect(page).toHaveURL(/\/repositories$/);
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Repositories");
    await expectCurrent(page, "Repositories");
  });

  test("Record page: a Repository Profile marks All Assessments", async ({ page, db }) => {
    const { assessment } = await seedResults(db);
    const profile = profilesOf(db, assessment.id)[0]!.profile;
    await page.goto(`/profiles/${profile.publicId}`);
    await expectCurrent(page, "All Assessments");
  });

  test("Current section on a deep page: a Finding marks All Assessments", async ({ page, db }) => {
    const { evaluation } = await seedEvaluation(db);
    const finding = findingsOf(db, evaluation.id)[0]!;
    await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);
    await expectCurrent(page, "All Assessments");
  });

  test("Create page: New Repository, reached from the Repositories list, marks Repositories", async ({ page, db: _db }) => {
    await page.goto(paths.newRepository);
    await expectCurrent(page, "Repositories");
    await page.goto(paths.repositories);
    await expectCurrent(page, "Repositories");
  });

  test("The create pages that left the menu are offered on their list pages", async ({ page, db }) => {
    buildSource(db);
    await page.goto(paths.assessments);
    await expect(pageHeader(page).getByRole("link", { name: "New Assessment" })).toBeVisible();
    await page.goto(paths.repositories);
    await expect(pageHeader(page).getByRole("link", { name: "New Repository" })).toBeVisible();
    await expect(pageHeader(page).getByRole("link", { name: "Add in bulk" })).toBeVisible();
    await page.goto("/standards");
    await expect(pageHeader(page).getByRole("link", { name: "New Standard" })).toBeVisible();
  });

  test("Page outside every item: the gallery shows the primary menu with nothing current", async ({ page, db: _db }) => {
    await page.goto("/design-system");
    await expect(primary(page)).toBeVisible();
    await expect(primary(page).locator("[aria-current]")).toHaveCount(0);
  });

  test("Product mark opens Home from a Run", async ({ page, db }) => {
    const { assessment } = await seedResults(db);
    await page.goto(paths.run(assessment.publicId));
    await page.getByRole("link", { name: "Frontend Registry home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Home");
  });

  test("Items open their pages: Salt Patterns and Standards keep the primary menu, marked current", async ({ page, db: _db }) => {
    for (const [item, url, title] of [["Salt Patterns", /\/templates$/, "Salt Patterns"], ["Standards", /\/standards$/, "Standards"]] as const) {
      await page.goto("/design-system");
      await primary(page).getByRole("link", { name: item, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText(title);
      await expectCurrent(page, item);
    }
  });

  test("Templates section on a deep page: a template detail page marks Salt Patterns", async ({ page, db: _db }) => {
    await page.goto("/templates/market-watch");
    await expectCurrent(page, "Salt Patterns");
  });
});

// The page title moves into the shell header: one h1 per page, centered in the header.
test.describe("the shell header", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const header = (page: Page) => page.locator("[data-shell-header]");

  test("Title in the header: an Assessment's name, centered, is the page's only h1", async ({ page, db }) => {
    const { assessment } = await seedResults(db);
    await page.goto(paths.run(assessment.publicId));
    const title = header(page).getByRole("heading", { level: 1 });
    await expect(title).toHaveText("Run #1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const [titleBox, headerBox] = [(await title.boundingBox())!, (await header(page).boundingBox())!];
    expect(Math.abs(titleBox.x + titleBox.width / 2 - (headerBox.x + headerBox.width / 2))).toBeLessThan(2);
  });

  test("Title appears once: the page content does not repeat an Initiative's name", async ({ page, db }) => {
    const { initiative } = await seedResults(db);
    await page.goto(paths.assessment(initiative.publicId));
    await expect(header(page).getByRole("heading", { level: 1 })).toHaveText("Fleet assessment");
    await expect(pageHeader(page)).not.toContainText("Fleet assessment");
  });

  test("Breadcrumbs on a Finding: the Control title in the header, its ancestors in the page", async ({ page, db }) => {
    const { evaluation } = await seedEvaluation(db);
    const finding = findingsOf(db, evaluation.id)[0]!;
    const control = [...BASELINE_CONTROLS, ...SERVICE_CONTROLS].find((candidate) => candidate.key === finding.controlKey)!;
    await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);
    await expect(header(page).getByRole("heading", { level: 1 })).toHaveText(control.title as string);
    const crumbs = pageHeader(page).getByRole("navigation", { name: "Breadcrumb" }).getByRole("link");
    await expect(crumbs).toHaveText(["Assessments", "Fleet assessment", "Evaluation #1"]);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`Solid header: in the ${theme} theme, the header behind the create page's title is a solid surface, distinct from the canvas`, async ({ page, db: _db, baseURL }) => {
      await useTheme(page.context(), theme, baseURL!);
      await page.goto(paths.newRepository);
      await expect(header(page).getByRole("heading", { level: 1 })).toHaveText("New Repository");
      const [fill, canvas, surface] = await page.evaluate(() => {
        const header = document.querySelector("[data-shell-header]")!;
        const probe = (variable: string) => {
          const element = document.createElement("div");
          element.style.background = `var(${variable})`;
          header.append(element);
          const color = getComputedStyle(element).backgroundColor;
          element.remove();
          return color;
        };
        return [getComputedStyle(header).backgroundColor, probe("--color-canvas"), probe("--color-bg")];
      });
      expect(fill).toBe(surface);
      expect(fill).not.toBe(canvas);
      expect(fill).not.toMatch(/rgba\(.*, 0(\.\d+)?\)$/);
    });
  }

  test("Scrolling a long page keeps the header and the sidebar in view", async ({ page, db }) => {
    const { evaluation } = await seedEvaluation(db);
    await page.goto(`/evaluations/${evaluation.publicId}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    expect((await header(page).boundingBox())!.y).toBe(0);
    expect((await page.locator("#sidebar").boundingBox())!.y).toBe(0);
    await expect(header(page).getByRole("heading", { level: 1 })).toBeInViewport();
    await expect(primary(page).getByRole("link", { name: "All Assessments" })).toBeInViewport();
    // Nothing scrolled beneath the header shows through it: the header is the topmost element across its box.
    const box = (await header(page).boundingBox())!;
    const covered = await page.evaluate(({ x, y, width, height }) => {
      const header = document.querySelector("[data-shell-header]")!;
      const points = [0.25, 0.5, 0.75].flatMap((fx) => [0.2, 0.8].map((fy) => [x + width * fx, y + height * fy] as const));
      return points.every(([px, py]) => header.contains(document.elementFromPoint(px, py)));
    }, box);
    expect(covered).toBe(true);
  });

  test("every surface has exactly one h1, in the shell header", async ({ page, db, sourcesDir }) => {
    test.setTimeout(240_000);
    const surfaces = [...(await seedOperatorSurfaces(db, sourcesDir)), ...demoSurfaces()];
    for (const [name, url] of surfaces) {
      await page.goto(url);
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
    await page.context().addCookies([{ name: "frontend-registry-sidebar-width", value: "320", url: baseURL! }]);
    await page.goto(paths.repositories);
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
    await page.goto(paths.repositories);
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "256");
    await dragBy(page, 64);
    await expect.poll(() => sidebarWidth(page)).toBe(320);
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "320");
    await expect(resizer(page)).toHaveAttribute("aria-valuetext", "320 pixels");

    // The next response already carries the width, so the page loads at it without shifting.
    expect(await (await context.request.get(paths.repositories)).text()).toContain("--_sidebar-width:320px");
    await page.reload();
    expect(await sidebarWidth(page)).toBe(320);
  });

  test("Dragging past the limit stops at 400px", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
    await dragBy(page, 300);
    await expect.poll(() => sidebarWidth(page)).toBe(400);
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "400");
  });

  test("Resizing with the keyboard: Right Arrow widens by 16px, Home and End go to the limits", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
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
    await page.context().addCookies([{ name: "frontend-registry-sidebar-width", value: "360", url: baseURL! }]);
    await page.goto(paths.repositories);
    expect(await sidebarWidth(page)).toBe(360);
    await resizer(page).dblclick();
    await expect.poll(() => sidebarWidth(page)).toBe(256);
  });

  test("Out-of-range stored width renders at the maximum", async ({ page, db: _db, baseURL }) => {
    await page.context().addCookies([{ name: "frontend-registry-sidebar-width", value: "9999", url: baseURL! }]);
    await page.goto(paths.repositories);
    expect(await sidebarWidth(page)).toBe(400);
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "400");
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("Hiding without JavaScript renders the next page with the sidebar hidden", async ({ page, db: _db }) => {
      await page.goto(paths.repositories);
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
    await page.context().addCookies([{ name: "frontend-registry-sidebar-width", value: "400", url: baseURL! }]);
    const surfaces = new Map(await seedOperatorSurfaces(db, sourcesDir));
    const pages: [string, string][] = [
      ["Evaluation", surfaces.get("08-evaluation")!],
      ["Profile", surfaces.get("06-profile")!],
      ["Relationship Map", surfaces.get("07-map")!],
      ["Repositories list", paths.repositories],
      ["Templates gallery", "/templates"],
      ["Standard draft editor", surfaces.get("04-draft")!],
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
    await page.context().addCookies([{ name: "frontend-registry-sidebar-width", value: "400", url: baseURL }]);
    return sources[0]!;
  }

  test("the live toast stays on the viewport", async ({ page, db, baseURL }) => {
    const source = await setUp(page, db, baseURL!);
    await page.goto(`${paths.repositories}?notice=added&source=${source.publicId}`);
    await expect.poll(async () => (await page.locator("#sidebar").boundingBox())?.width).toBe(400);
    await expectOnViewport(page, page.getByRole("listitem").filter({ hasText: "source-00 was added." }).first());
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the server-rendered toast inside the page stays on the viewport", async ({ page, db, baseURL }) => {
      const source = await setUp(page, db, baseURL!);
      await page.goto(`${paths.repositories}?notice=added&source=${source.publicId}`);
      await expectOnViewport(page, page.getByRole("status").filter({ hasText: "source-00 was added." }).first());
    });
  });
});

// Below 1024px the sidebar is a drawer, opened from the header.
test.describe("on a narrow viewport", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const openNavigation = (page: Page) => page.locator("[data-shell-header]").getByRole("button", { name: "Open navigation" });

  test("Shell on a narrow viewport: the header shows Open navigation and the title, and no sidebar sits beside the content", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
    await expect(openNavigation(page)).toBeVisible();
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1, name: "Repositories" })).toBeVisible();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(primary(page)).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test("Opening the drawer shows the primary menu and the theme control; Escape returns focus", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
    await openNavigation(page).click();
    const drawer = page.locator("#sidebar");
    await expect(drawer).toBeVisible();
    await expectCurrent(page, "Repositories");
    await expect(drawer.getByRole("button", { name: "Dark theme" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(openNavigation(page)).toBeFocused();
  });

  test("choosing an item closes the drawer and opens the page", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
    await openNavigation(page).click();
    await primary(page).getByRole("link", { name: "Standards", exact: true }).click();
    await expect(page).toHaveURL(/\/standards$/);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Standards");
  });

  test.describe("on a touch device", () => {
    test.use({ hasTouch: true });

    test("gives Open navigation and every drawer item a 44px target", async ({ page, db: _db }) => {
      await page.goto(paths.repositories);
      expect((await openNavigation(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await openNavigation(page).click();
      for (const item of ["Repositories", "All Assessments", "Standards"]) {
        expect((await primary(page).getByRole("link", { name: item, exact: true }).boundingBox())!.height, item).toBeGreaterThanOrEqual(44);
      }
      await expectNoHorizontalOverflow(page);
    });
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("Drawer without JavaScript: it opens, and choosing Standards opens that page", async ({ page, db: _db }) => {
      await page.goto(paths.repositories);
      await openNavigation(page).click();
      await expect(page.locator("#sidebar")).toBeVisible();
      await primary(page).getByRole("link", { name: "Standards", exact: true }).click();
      await expect(page).toHaveURL(/\/standards$/);
      await expect(page.locator("#sidebar")).toBeHidden();
    });
  });
});
