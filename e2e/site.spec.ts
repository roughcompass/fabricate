import fs from "node:fs";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { pageHeader, pageTitle, useTheme } from "./support/shell";

/*
 * The product site (establish-frontend-registry, tasks 10.1 to 10.3 and 10.6;
 * the product-site spec): the site's frame, the docs pages, and what they
 * offer people and their agents.
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
