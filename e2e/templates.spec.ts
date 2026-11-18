import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { expectCurrentItem } from "./support/shell";

/** The Find your template gallery (template-gallery spec). */

const cards = (page: Page) => page.getByRole("article");
const cardTitles = (page: Page) => page.getByRole("article").getByRole("heading").allTextContents();
const rail = (page: Page) => page.getByRole("form", { name: "Filter templates" });

test("Opening the gallery: titled Salt Patterns, with the search, the filter rail, and every template", async ({ page, db: _db }) => {
  await page.goto("/templates");
  await expect(page).toHaveTitle("Salt Patterns · DE FabLab");
  await expect(page.getByRole("heading", { level: 1, name: "Salt Patterns" })).toBeVisible();
  await expect(page.getByText("Jumpstart your app development process with pre-built solutions from DE Web and our community.")).toBeVisible();
  await expectCurrentItem(page, "Salt Patterns");

  // The search spans the page above the rail and the results.
  const search = page.getByRole("searchbox", { name: "Search templates" });
  await expect(search).toBeVisible();
  const searchBox = (await page.getByRole("search", { name: "Search templates" }).boundingBox())!;
  const railBox = (await rail(page).boundingBox())!;
  const gridBox = (await page.getByRole("article").first().boundingBox())!;
  expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(railBox.y);
  expect(searchBox.x).toBeLessThanOrEqual(railBox.x + 1);
  expect(searchBox.x + searchBox.width).toBeGreaterThanOrEqual(gridBox.x + gridBox.width - 1);

  await expect(rail(page).getByRole("heading", { name: "Filter templates" })).toBeVisible();
  await expect(rail(page).getByRole("link", { name: "Clear" })).toHaveCount(0);
  await expect(rail(page).getByRole("group", { name: "Brand" })).toBeVisible();
  await expect(rail(page).getByRole("group", { name: "Provider" })).toBeVisible();
  await expect(page.getByText("Showing 16 of 16 templates")).toBeVisible();
  await expect(cards(page)).toHaveCount(16);
  expect((await cardTitles(page)).slice(0, 4)).toEqual(["Client onboarding", "Market watch", "Operations console", "Payments workspace"]);
  // No primary action; resetting the demo is under More actions.
  const header = page.locator("[data-page-header]");
  await expect(header.locator('[data-variant="primary"]')).toHaveCount(0);
  await expect(header.getByRole("button", { name: "More actions" })).toBeVisible();
});

test("Reset demo: More actions asks first, then the gallery says the demo was reset", async ({ page, db: _db }) => {
  await page.goto("/templates");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset the demo?" });
  await expect(dialog).toContainText("Your comments, share links, and session profiles are removed.");
  await dialog.getByRole("button", { name: "Reset demo" }).click();
  const toast = page.getByRole("region", { name: "Notifications" });
  await expect(toast.getByText("The demo was reset.")).toBeVisible();
  await expect(toast.getByText("Your comments, share links, and session profiles were removed.")).toBeVisible();
});

test("shows how many options each group has selected, including while it is collapsed", async ({ page, db: _db }) => {
  await page.goto("/templates");
  const brandHeading = rail(page).locator("summary").filter({ hasText: "Brand" });
  const providerHeading = rail(page).locator("summary").filter({ hasText: "Provider" });
  await expect(brandHeading).not.toContainText("selected");

  await rail(page).getByRole("checkbox", { name: /Payments/ }).check();
  await expect(page).toHaveURL(/brand=payments/);
  await rail(page).getByRole("checkbox", { name: /Markets/ }).check();
  await expect(page).toHaveURL(/brand=payments&brand=markets/);
  await rail(page).getByRole("checkbox", { name: /DE Web/ }).check();
  await expect(page).toHaveURL(/provider=de-web/);
  await expect(brandHeading).toContainText("2 selected");
  await expect(providerHeading).toContainText("1 selected");

  await providerHeading.click();
  await expect(rail(page).getByRole("checkbox", { name: /DE Web/ })).toBeHidden();
  await expect(providerHeading).toContainText("1 selected");
  await providerHeading.click();
  await expect(rail(page).getByRole("checkbox", { name: /DE Web/ })).toBeChecked();
});

test("shows each template's preview, title, description, brand, and provider", async ({ page, db: _db }) => {
  await page.goto("/templates");
  const hero = cards(page).filter({ hasText: "Payments workspace" });
  await expect(hero.getByRole("img", { name: "Preview of the Payments workspace template in the J.P. Morgan Access portal" })).toBeVisible();
  await expect(hero).toContainText("Manage payees, send transfers");
  await expect(hero).toContainText("Payments");
  await expect(hero).toContainText("DE Web");

  const community = cards(page).filter({ hasText: "FX rates board" });
  await expect(community).toContainText("By Kenji Watanabe");
  await expect(community).not.toContainText("DE Web");

  // Every card in a row is the same height.
  const heights = await cards(page).evaluateAll((elements) => elements.slice(0, 3).map((element) => Math.round(element.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
});

test("searches by title, description, tag, or author, keeping the search in the URL", async ({ page, db: _db }) => {
  await page.goto("/templates");
  const search = page.getByRole("searchbox", { name: "Search templates" });
  await search.fill("onboarding");
  await search.press("Enter");

  await expect(page).toHaveURL(/\/templates\?q=onboarding$/);
  await expect(page.getByText("Showing 2 of 16 templates")).toBeVisible();
  expect(await cardTitles(page)).toEqual(["Client onboarding", "Team directory"]);
  await expect(rail(page).getByRole("checkbox", { name: /Global Banking/ })).toBeVisible();
  await expect(rail(page).getByRole("group", { name: "Brand" })).toContainText("Payments0Global Banking1Markets0Other1");
});

test("combines brand and provider filters and clears them", async ({ page, db: _db }) => {
  await page.goto("/templates");
  await rail(page).getByRole("checkbox", { name: /Payments/ }).check();
  await expect(page).toHaveURL(/brand=payments/);
  await rail(page).getByRole("checkbox", { name: /Markets/ }).check();
  await expect(page).toHaveURL(/brand=payments&brand=markets/);
  await rail(page).getByRole("checkbox", { name: /DE Web/ }).check();
  await expect(page).toHaveURL(/brand=payments&brand=markets&provider=de-web/);

  await expect(page.getByText("Showing 5 of 16 templates")).toBeVisible();
  expect(await cardTitles(page)).toEqual(["Market watch", "Payments workspace", "Payment status tracker", "Research hub", "Risk limits monitor"]);

  // The search keeps the filters, and the filters keep the search.
  const search = page.getByRole("searchbox", { name: "Search templates" });
  await search.fill("limits");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=limits/);
  await expect(page).toHaveURL(/provider=de-web/);
  expect(await cardTitles(page)).toEqual(["Risk limits monitor"]);

  await rail(page).getByRole("link", { name: "Clear" }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByText("Showing 16 of 16 templates")).toBeVisible();
});

test("explains an empty result and offers to clear it", async ({ page, db: _db }) => {
  await page.goto("/templates?q=quantum+teleporter");
  await expect(page.getByText("Showing 0 of 16 templates")).toBeVisible();
  await expect(page.getByText("No templates match", { exact: true })).toBeVisible();
  await expect(page.getByText("No template matches “quantum teleporter” with the chosen filters.")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Clear filters" }).last().click();
  await expect(cards(page)).toHaveCount(16);
});

test("opens a template from its card with the keyboard", async ({ page, db: _db }) => {
  await page.goto("/templates");
  const title = cards(page).filter({ hasText: "Market watch" }).getByRole("link", { name: "Market watch" });
  await title.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/templates\/market-watch$/);
});

/** A card's preview frame and media area, and the preview's own aspect ratio. */
async function preview(card: ReturnType<typeof cards>) {
  return card.evaluate((element) => {
    const image = element.querySelector("img")!;
    const frame = image.parentElement!;
    const media = frame.parentElement!;
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    };
    return { transform: getComputedStyle(frame).transform, duration: getComputedStyle(frame).transitionDuration, frame: box(frame), media: box(media), ratio: image.naturalWidth / image.naturalHeight };
  });
}

// template-gallery spec, template cards: hover and focus straighten the angled preview.
test.describe("template card previews", () => {
  test.use({ reducedMotion: "no-preference" });

  test("Hovering over a card straightens its preview to the card's full width, with the whole image visible", async ({ page, db: _db }) => {
    await page.goto("/templates");
    const card = cards(page).filter({ hasText: "Market watch" });
    await expect(card.locator("img")).toHaveJSProperty("complete", true);
    const before = (await card.boundingBox())!;
    expect((await preview(card)).transform).not.toBe("none");

    await card.hover();
    await expect.poll(async () => (await preview(card)).transform).toBe("none");
    await expect.poll(async () => {
      const { frame, media } = await preview(card);
      return Math.abs(frame.left - media.left) < 1 && Math.abs(frame.top - media.top) < 1 && Math.abs(frame.width - media.width) < 1;
    }).toBe(true);
    const { frame, media, ratio } = await preview(card);
    // The frame has the image's own ratio and fits the media area, so nothing is cropped.
    expect(Math.abs(frame.width / frame.height - ratio)).toBeLessThan(0.02);
    expect(frame.height).toBeLessThanOrEqual(media.height + 1);
    expect(await card.boundingBox()).toEqual(before);

    await page.mouse.move(0, 0);
    await expect.poll(async () => (await preview(card)).transform).not.toBe("none");
  });

  test("Focusing a card straightens its preview, as hovering does", async ({ page, db: _db }) => {
    await page.goto("/templates");
    await cards(page).filter({ hasText: "Client onboarding" }).getByRole("link", { name: "Client onboarding" }).focus();
    await page.keyboard.press("Tab");
    const card = cards(page).filter({ hasText: "Market watch" });
    await expect(card.getByRole("link", { name: "Market watch" })).toBeFocused();
    await expect.poll(async () => (await preview(card)).transform).toBe("none");
  });
});

test("Reduced motion: a card's preview straightens at once, without an animation", async ({ page, db: _db }) => {
  // The browser tests run with reduced motion (playwright.config.ts).
  await page.goto("/templates");
  const card = cards(page).filter({ hasText: "Market watch" });
  expect((await preview(card)).duration.split(",").every((value) => parseFloat(value) <= 0.001)).toBe(true);
  await card.hover();
  expect((await preview(card)).transform).toBe("none");
});

test("collapses the filters into a disclosure at 375px without overflowing", async ({ page, db: _db }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/templates?brand=markets&provider=community");
  const summary = rail(page).locator("summary").first();
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("2 active");
  await expect(rail(page).getByRole("checkbox", { name: /Markets/ })).toBeHidden();
  await summary.click();
  await expect(rail(page).getByRole("checkbox", { name: /Markets/ })).toBeChecked();
  await expectNoHorizontalOverflow(page);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("searches and applies filters with the Apply button", async ({ page, db: _db }) => {
    await page.goto("/templates");
    await rail(page).getByRole("checkbox", { name: /Other/ }).check();
    await rail(page).getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/brand=other/);
    await expect(page.getByText("Showing 4 of 16 templates")).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Search templates" });
    await search.fill("flags");
    await search.press("Enter");
    await expect(page).toHaveURL(/brand=other&q=flags|q=flags.*brand=other/);
    expect(await cardTitles(page)).toEqual(["Feature flag console"]);
  });
});

test.describe("template detail", () => {
  test("names the brand, the provider, and each microfrontend, with no Deploy template", async ({ page, db: _db }) => {
    await page.goto("/templates/market-watch");
    await expect(page).toHaveTitle("Market watch · Salt Patterns · DE FabLab");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Salt Patterns" })).toHaveAttribute("href", "/templates");
    await expect(page.getByRole("heading", { level: 1, name: "Market watch" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Preview of the Market watch template/ })).toBeVisible();

    const overview = page.locator("dl").first();
    await expect(overview).toContainText("BrandMarkets");
    await expect(overview).toContainText("PortalJ.P. Morgan Markets");
    await expect(overview).toContainText("ProviderDE Web");
    await expect(overview).toContainText("Watchlist, Order ticket, Price chart, Trade blotter");
    const members = page.getByRole("table", { name: "Microfrontends in this template" });
    for (const name of ["Markets shell", "Watchlist", "Order ticket", "Price chart", "Trade blotter"]) await expect(members).toContainText(name);
    await expectCurrentItem(page, "Salt Patterns", "true");

    await expect(page.getByRole("link", { name: "Deploy template" })).toHaveCount(0);
  });

  test("Breadcrumb names its page: Salt Patterns opens the page titled Salt Patterns", async ({ page, db: _db }) => {
    await page.goto("/templates/market-watch");
    const crumbs = page.locator("[data-page-header]").getByRole("navigation", { name: "Breadcrumb" }).getByRole("link");
    await expect(crumbs.first()).toHaveText("Salt Patterns");
    await crumbs.first().click();
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Salt Patterns");
  });

  test("shows a community template's author", async ({ page, db: _db }) => {
    await page.goto("/templates/relationship-notes");
    await expect(page.locator("dl").first()).toContainText("ProviderCommunity · Hannah Okafor");
  });

  test("opens Preview template in the same tab, in preview mode", async ({ page, db: _db }) => {
    await page.goto("/templates/client-onboarding");
    await page.getByRole("link", { name: "Preview template" }).click();
    await expect(page).toHaveURL(/\/templates\/client-onboarding\/preview$/);
    await expect(page.getByRole("heading", { level: 1, name: "Client onboarding" })).toBeVisible();
    expect(page.context().pages()).toHaveLength(1);
  });

  test("explains a template that does not exist", async ({ page, db: _db }) => {
    const response = await page.goto("/templates/no-such-template");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Template not found" })).toBeVisible();
    await expect(page.getByText("This template does not exist.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Salt Patterns" })).toHaveAttribute("href", "/templates");
  });
});
