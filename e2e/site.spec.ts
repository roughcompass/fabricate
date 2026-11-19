import fs from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { storeEntry } from "../src/lib/catalog/entries";
import { loadDocsSite } from "../src/lib/docs/site";
import { buildRepository } from "../test/support/builders";
import { saltEntry } from "../test/support/catalog";
import { seedSurvey } from "../test/support/scenarios";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { pageHeader, pageTitle, useTheme } from "./support/shell";

/*
 * The product site (establish-frontend-registry, tasks 10.1 to 10.3, 10.6,
 * 10.9, and 10.12; the product-site spec): the site's frame, the docs pages
 * and what they offer people and their agents, the marketing page, and
 * accessibility on every site page.
 */

const INSTALLED_SURVEYOR = (JSON.parse(fs.readFileSync("node_modules/@repo-facts/contract/package.json", "utf8")) as { version: string }).version;

test.describe("the site's frame", () => {
  test("shows the product mark and name, Product, Docs, and Open the Frontend Registry, and no operator sidebar (Site header)", async ({ page, db: _db }) => {
    await page.goto("/docs/get-started/what-it-is");
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("link", { name: "Frontend Registry product page" })).toHaveAttribute("href", "/about");
    await expect(banner.getByRole("navigation", { name: "Site" }).getByRole("link")).toHaveText(["Product", "Docs"]);
    await expect(banner.getByRole("link", { name: "Docs" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#sidebar")).toHaveCount(0);
    await banner.getByRole("link", { name: "Open the Frontend Registry" }).click();
    await expect(page).toHaveURL(paths.home);
    await expect(page.locator("#sidebar")).toHaveCount(1);
  });

  test("opens the docs at their first page from the operator shell's Docs control (Docs from the app)", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
    await page.locator("[data-shell-header]").getByRole("link", { name: "Docs" }).click();
    await expect(page).toHaveURL("/docs/get-started/what-it-is");
    await expect(pageTitle(page)).toHaveText("What the Frontend Registry is");
  });

  test("renders in the theme the operator chose (Theme carries over)", async ({ page, db: _db, baseURL }) => {
    await useTheme(page.context(), "dark", baseURL!);
    await page.goto(paths.home);
    await page.goto("/docs/get-started/what-it-is");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const canvas = await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(canvas).toBe("rgb(0, 0, 0)");
  });
});

test.describe("a docs page", () => {
  test("shows its title, summary, contents, previous and next pages, and the release it describes (Docs page)", async ({ page, db: _db }) => {
    await page.goto("/docs/get-started/add-your-repository");
    await expect(page).toHaveTitle("Add your repository · Frontend Registry");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(pageTitle(page)).toHaveText("Add your repository");
    await expect(pageHeader(page)).toContainText("Register your repository once, and the Frontend Registry surveys it and keeps its Profile current.");
    await expect(page.locator("[data-docs-release]")).toHaveText(/^Describes Frontend Registry \d+\.\d+\.\d+$/);
    const contents = page.getByRole("navigation", { name: "On this page" });
    await expect(contents.getByRole("link")).toHaveText(["Add it", "What happens next", "If the survey fails", "Change or remove it"]);
    await contents.getByRole("link", { name: "If the survey fails" }).click();
    await expect(page).toHaveURL(/#if-the-survey-fails$/);
    await expect(page.getByRole("heading", { level: 2, name: "If the survey fails" })).toBeInViewport();
    const docs = page.getByRole("navigation", { name: "Docs" }).first();
    await expect(docs.getByRole("link", { name: "Add your repository" })).toHaveAttribute("aria-current", "page");
    const pager = page.getByRole("navigation", { name: "Previous and next pages" });
    await expect(pager.getByRole("link")).toHaveText(["PreviousWhat the Frontend Registry is", "NextFind a repository and read its Profile"]);
    // A table, a code span, and a link to another page render from the Markdown.
    await page.goto("/docs/reference/json-profile");
    await expect(page.locator("[data-docs-article] table").first()).toContainText("Digest");
    await expect(page.locator("[data-docs-article] figure").first()).toContainText("GET /repositories/<id>/profile.json");
    await page.locator("[data-docs-article]").getByRole("link", { name: "Fact document" }).first().click();
    await expect(page).toHaveURL("/docs/reference/fact-document");
  });

  test("labels Surveyor's reference with the release installed (Surveyor upgrade)", async ({ page, db: _db }) => {
    await page.goto("/docs/reference/fact-document");
    await expect(pageTitle(page)).toHaveText("Fact document");
    await expect(page.locator("[data-docs-release]")).toHaveText(`Describes Surveyor ${INSTALLED_SURVEYOR}`);
    await expect(page.locator("[data-docs-article]")).toContainText("This contract governs how Surveyor's detectors");
  });

  test("links its Markdown as an alternate, and offers View as Markdown and Copy page (Markdown version of a page)", async ({ page, db: _db, context }) => {
    await page.goto("/docs/get-started/add-your-repository");
    await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", "/docs/get-started/add-your-repository.md");
    await expect(pageHeader(page).getByRole("link", { name: "View as Markdown" })).toHaveAttribute("href", "/docs/get-started/add-your-repository.md");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // Copy page appears once the page hydrates, since it needs the clipboard.
    await pageHeader(page).getByRole("button", { name: "Copy page" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Page copied as Markdown" })).toHaveCount(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fs.readFileSync("docs/site/get-started/add-your-repository.md", "utf8"));
  });

  test("answers not found for an address that names no page, and opens the first page at /docs", async ({ page, db: _db }) => {
    const response = await page.goto("/docs/get-started/nowhere");
    expect(response?.status()).toBe(404);
    await expect(pageTitle(page)).toHaveText("Page not found");
    await expect(page.getByRole("link", { name: "Go to the docs" })).toHaveAttribute("href", "/docs");
    await page.goto("/docs");
    await expect(page).toHaveURL("/docs/get-started/what-it-is");
  });

  test("puts the navigation in a disclosure, and keeps everything inside the viewport (Docs page on a narrow viewport)", async ({ page, db: _db }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/docs/reference/configuration");
    await expect(pageTitle(page)).toBeInViewport();
    await expect(page.getByRole("navigation", { name: "On this page" })).toBeHidden();
    const toggle = page.locator("summary").filter({ hasText: "Docs pages" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("navigation", { name: "Docs" }).getByRole("link", { name: "Glossary" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoOverlappingContent(page);
  });
});

const SECTIONS = [
  "Teams already register their repositories here",
  "Today, every question about the fleet starts from scratch",
  "Your agent knows your repository; the Frontend Registry knows the fleet",
  "Four parts, each with one job",
  "Register once, and everyone who depends on your app gets an answer",
  "You can check every fact yourself",
  "Your agent can read it too",
  "Questions teams ask before they register",
  "Add your repository",
];
const section = (page: Page, heading: string) => page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: heading, exact: true }) });

test.describe("the marketing page", () => {
  test("runs its sections in order, under one h1, with Add your repository in the hero and at the end (Section order)", async ({ page, db }) => {
    buildRepository(db, { name: "web" });
    await page.goto("/about");
    await expect(page).toHaveTitle("Every CIB frontend repository and what it's built on, in one place · Frontend Registry");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main h2")).toHaveText(SECTIONS);
    const adds = page.getByRole("main").getByRole("link", { name: "Add your repository", exact: true });
    await expect(adds).toHaveCount(2);
    for (const link of await adds.all()) await expect(link).toHaveAttribute("href", "/repositories/bulk");
    await adds.last().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add Repositories");
  });

  test("says what it does and that it's the official registry, with a real Profile, Add your repository first, and Read the docs (Hero)", async ({ page, db: _db }) => {
    await page.goto("/about");
    const hero = pageHeader(page);
    await expect(hero.getByRole("heading", { level: 1 })).toHaveText("Every CIB frontend repository and what it's built on, in one place");
    await expect(hero).toContainText("The Frontend Registry is the Digital Enablement team's official registry of CIB frontend applications.");
    const picture = hero.getByRole("img", { name: /A repository's Profile in the Frontend Registry/ });
    await expect(picture).toBeVisible();
    expect(await picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(hero.getByRole("link", { name: "Add your repository" })).toHaveAttribute("data-variant", "primary");
    await expect(hero.getByRole("link", { name: "Read the docs" })).toHaveAttribute("data-variant", "secondary");
  });

  test("names what teams do today, the four parts with one job each, a survey in four steps, and what each audience gets (The problem, How it works, Benefits by audience)", async ({ page, db: _db }) => {
    await page.goto("/about");
    const problem = section(page, SECTIONS[1]!);
    await expect(problem.getByRole("listitem")).toHaveText([/search repositories one at a time/, /send surveys asking each team which versions it uses/, /No one has a shared record of what each repository is built on/]);
    const how = section(page, SECTIONS[3]!);
    await expect(how.locator("dt")).toHaveText(["Frontend Registry", "Surveyor", "Reference Catalog", "Catalog Builder"]);
    await expect(how.locator("dd")).toHaveCount(4);
    await expect(how.getByRole("listitem")).toHaveCount(4);
    await expect(how).toContainText("never runs it");
    await expect(section(page, SECTIONS[4]!).locator("dt")).toHaveText(["App owners", "Product managers", "Design-system teams", "Platform teams"]);
    await expect(section(page, SECTIONS[4]!)).toContainText("Every CIB frontend repository must be registered in the Frontend Registry.");
  });

  test("compares a reader's agent with the Frontend Registry as complements, and says what an agent can read (Reader with an agent, Use with an agent)", async ({ page, db: _db }) => {
    await page.goto("/about");
    const comparison = section(page, SECTIONS[2]!);
    await expect(comparison.getByRole("rowheader")).toHaveText(["Scope", "Results", "Repeatability", "Rules", "Time"]);
    await expect(comparison).toContainText("Use your AI agent and code-intelligence tools for your own code.");
    const agent = section(page, SECTIONS[6]!);
    await expect(agent.getByRole("listitem")).toHaveText([/Markdown/, /llms\.txt/, /AGENTS\.md/, /profile\.json/]);
    await agent.getByRole("link", { name: "Use the Frontend Registry with your agent" }).click();
    await expect(page).toHaveURL("/docs/guides/use-with-your-agent");
    await expect(page.locator("[data-docs-article]")).toContainText("## Frontend Registry");
  });

  test("says what Surveyor never does, that every fact has evidence, and that a Profile reproduces from its recipe (Trust section)", async ({ page, db: _db }) => {
    await page.goto("/about");
    await expect(section(page, SECTIONS[5]!).getByRole("listitem")).toHaveText([/never runs your code/, /names the file and lines it came from/, /records its recipe/]);
  });

  test("answers whether registering is required, whether Surveyor runs code, who sees the facts, and what to do about a wrong one (Common questions)", async ({ page, db: _db }) => {
    await page.goto("/about");
    await expect(section(page, SECTIONS[7]!).locator("dt")).toHaveText(["Is registering required?", "Does Surveyor run or change my code?", "Who can see my repository's facts?", "What if a fact is wrong?"]);
  });

  test("shows live figures with the time they were read, hiding a figure at zero (Live figures)", async ({ page, db }) => {
    storeEntry(db, saltEntry());
    for (const name of ["web", "orders", "ledger"]) await seedSurvey(db, buildRepository(db, { name }));
    buildRepository(db, { name: "billing" });
    await page.goto("/about");
    const figures = section(page, SECTIONS[0]!);
    await expect(figures.locator("[data-key-figure] dt")).toHaveText(["Repositories registered", "Repositories profiled", "Salt versions described"]);
    await expect(figures.locator("[data-key-figure] dd")).toHaveText(["4", "3", "1"]);
    await expect(figures.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  });

  test("leaves the figures out of an installation with no Repositories, and renders the rest (Empty installation)", async ({ page, db: _db }) => {
    await page.goto("/about");
    await expect(page.locator("[data-about-section='figures']")).toHaveCount(0);
    await expect(page.locator("main h2")).toHaveText(SECTIONS.slice(1));
  });

  test("shows every reader the same page (Same page for every reader)", async ({ browser, page, db, baseURL }) => {
    buildRepository(db, { name: "web" });
    const content = async (reader: Page) => {
      await reader.goto("/about");
      return reader.locator("main").evaluate((main: HTMLElement) => main.innerText.replace(/Read [^\n]+UTC\./, "Read <time>."));
    };
    const other = await browser.newContext({ baseURL });
    expect(await content(await other.newPage())).toBe(await content(page));
    await other.close();
  });

  test("keeps the hero's heading and primary action in view, and nothing wider than the screen, at 375px (Narrow viewport)", async ({ page, db: _db }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
    await expect(pageHeader(page).getByRole("link", { name: "Add your repository" })).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    await expectNoOverlappingContent(page);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("shows every section, figure, and link of the marketing page, and its links work (Without JavaScript)", async ({ page, db }) => {
    await seedSurvey(db, buildRepository(db, { name: "web" }));
    await page.goto("/about");
    await expect(page.locator("main h2")).toHaveText(SECTIONS);
    await expect(section(page, SECTIONS[0]!).locator("[data-key-figure] dd")).toHaveText(["1", "1"]);
    await page.getByRole("main").getByRole("link", { name: "Read the docs" }).first().click();
    await expect(page).toHaveURL("/docs/get-started/what-it-is");
    await page.getByRole("link", { name: "View as Markdown" }).click();
    expect(await page.content()).toContain("# What the Frontend Registry is");
  });
});

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

/** The automated WCAG 2.2 A and AA rules, target size among them, over the whole page. */
async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
    return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  });
}

/**
 * Every element that keyboard focus reaches, tabbing through the page and
 * back, that the sticky site header covers (WCAG 2.2, 2.4.11). Tabbing back
 * up the page is when a sticky header would hide what takes focus.
 */
async function obscuredFocus(page: Page): Promise<string[]> {
  const obscured = new Set<string>();
  const count = Math.min(await page.locator("a[href], button, summary, [tabindex='0']").count(), 120);
  for (const key of [...Array<string>(count).fill("Tab"), ...Array<string>(count).fill("Shift+Tab")]) {
    await page.keyboard.press(key);
    const covered = await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement | null;
      const header = document.querySelector("[data-site-header]");
      if (!focused || !header || header.contains(focused) || focused === document.body) return null;
      // Covered where the header draws over it: at its center, what's on top is the header's.
      const rect = focused.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return top && header.contains(top) ? (focused.getAttribute("aria-label") ?? focused.textContent ?? focused.tagName).trim().slice(0, 60) : null;
    });
    if (covered) obscured.add(covered);
  }
  return [...obscured];
}

test.describe("accessibility", () => {
  test("the focus check finds a control the sticky header covers", async ({ page, db: _db }) => {
    await page.goto("/docs/reference/glossary");
    // Without the scroll padding that keeps focus below the header, tabbing back up the page hides links under it.
    await page.addStyleTag({ content: "html { scroll-padding-top: 0 !important; }" });
    expect((await obscuredFocus(page)).length).toBeGreaterThan(0);
  });

  test("every docs page passes the WCAG 2.2 A and AA rules, target size included, at desktop and phone widths", async ({ page, db: _db }) => {
    test.setTimeout(300_000);
    const problems: string[] = [];
    for (const docsPage of loadDocsSite(process.cwd()).pages) {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
        await page.setViewportSize(viewport);
        await page.goto(docsPage.href);
        for (const violation of await axeViolations(page)) problems.push(`${docsPage.href} at ${viewport.width}px: ${violation}`);
      }
    }
    expect(problems).toEqual([]);
  });

  for (const url of ["/about", "/docs/get-started/what-it-is", "/docs/reference/configuration", "/docs/reference/fact-document"]) {
    test(`${url} passes the WCAG 2.2 A and AA rules, target size included, and focus is never hidden under the header`, async ({ page, db }) => {
      buildRepository(db, { name: "web" });
      for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
        await page.setViewportSize(viewport);
        await page.goto(url);
        expect(await axeViolations(page), `${url} at ${viewport.width}px`).toEqual([]);
        expect(await obscuredFocus(page), `${url} at ${viewport.width}px`).toEqual([]);
      }
    });
  }
});
