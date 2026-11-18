import type { Page } from "@playwright/test";
import { recordFailedDeConsoleRead } from "../src/lib/ownership/de-console";
import { createApplication } from "../src/lib/ownership/records";
import { buildAssessment, buildInitiative, buildSource } from "../test/support/builders";
import { buildEvaluation, claim, driveEvaluation, driveRun, readDeConsole } from "../test/support/home";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { seedResults } from "./support/results";

// operator-interface/home spec: Home at the root address, its figures and the
// exact lists they open, Needs attention, and the shell's ways to reach it.

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const title = (page: Page) => page.locator("[data-shell-header]").getByRole("heading", { level: 1 });
const attention = (page: Page) => page.getByRole("table", { name: "Needs attention" }).locator("tbody tr");

type Db = Parameters<typeof buildSource>[0];

/** An Assessment over one new Repository whose latest Run ends in +run+, evaluated to +conclusion+ when given. */
function assessment(db: Db, name: string, run: "complete" | "failed", conclusion?: "gaps" | "conforms" | "undetermined") {
  const initiative = buildInitiative(db, { name, sources: [buildSource(db)] });
  const finished = driveRun(db, buildAssessment(db, { initiative }).assessment, run);
  if (conclusion) driveEvaluation(db, buildEvaluation(db, initiative, finished), "complete", conclusion);
  return { initiative, run: finished };
}

/** Home shows the primary menu, with Home current. */
async function expectClosedMenu(page: Page) {
  const nav = primary(page);
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "All Assessments", exact: true })).toBeVisible();
}

test("Opening the root address: Home opens without a redirect, titled Home, with the menu closed", async ({ page, db: _db }) => {
  const response = await page.goto(paths.home);
  expect(response?.request().redirectedFrom()).toBeNull();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle("Home · DE FabLab");
  await expect(title(page)).toHaveText("Home");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expectClosedMenu(page);
});

test("Fresh installation: each group shows its empty state and actions, and nothing needs attention", async ({ page, db: _db }) => {
  await page.goto(paths.home);
  await expect(page.getByText("No Repositories yet")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Import Repositories" }).first()).toHaveAttribute("href", "/repositories/import");
  await expect(page.getByRole("link", { name: "New Repository" }).last()).toHaveAttribute("href", "/repositories/new");
  await expect(page.getByText("No Assessments yet")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "New Assessment" }).first()).toHaveAttribute("href", "/assessments/new");
  const needsAttention = page.getByRole("region", { name: "Needs attention" });
  await expect(needsAttention.getByText("Nothing needs attention")).toBeVisible();
  await expect(needsAttention.getByRole("link")).toHaveCount(0);
});

test("every figure opens a list showing exactly the records it counts (Unclaimed figure opens its list, Conclusion figure opens its tab)", async ({ page, db }) => {
  const sources = Array.from({ length: 6 }, (_, index) => buildSource(db, { name: `repo-${index}` }));
  for (const source of sources.slice(0, 4)) claim(db, source);
  claim(db, buildSource(db, { name: "archived", enabled: false }));
  assessment(db, "Checkout platform migration", "complete", "gaps");
  assessment(db, "Payments baseline", "complete", "gaps");
  assessment(db, "Markets baseline", "complete", "conforms");
  assessment(db, "Ledger review", "complete");

  await page.goto(paths.home);
  const figures: { group: string; label: string; value: number; href: string }[] = [];
  for (const group of ["Repositories", "Assessments"]) {
    for (const stat of await page.locator(`dl[aria-label="${group}"] > div`).all()) {
      const link = stat.locator("dd a");
      figures.push({ group, label: (await stat.locator("dt").textContent())!, value: Number((await link.textContent())!.replaceAll(",", "")), href: (await link.getAttribute("href"))! });
    }
  }
  expect(figures.map(({ label, value }) => [label, value])).toEqual([
    // Six Repositories, and one more for each Assessment.
    ["Enabled", 10],
    ["Claimed", 4],
    ["Unclaimed", 6],
    ["Assessments", 4],
    ["Gaps found", 2],
    ["Undetermined", 0],
    ["Conforms", 1],
    ["Not evaluated", 1],
  ]);
  await expect(page.locator('dl[aria-label="Repositories"]')).toContainText("40% of enabled");

  for (const { group, label, value, href } of figures) {
    await page.goto(href);
    const rows = page.getByRole("table", { name: group, exact: true }).locator("tbody tr");
    if (value === 0) await expect(rows, label).toHaveCount(0);
    else await expect(rows, `${label} opens ${href}`).toHaveCount(value);
  }
});

test("Same page for everyone: a stated name in a cookie doesn't change Home", async ({ page, context, db, baseURL }) => {
  claim(db, buildSource(db));
  assessment(db, "Checkout platform migration", "failed");
  await page.goto(paths.home);
  const first = await page.getByRole("main").innerText();

  await context.addCookies([{ name: "fabricate-claimant", value: "Bo", url: baseURL! }]);
  await page.reload();
  expect(await page.getByRole("main").innerText()).toBe(first);
});

test("Demo enabled: Home shows no templates or reference deployments", async ({ page, db: _db }) => {
  await page.goto(paths.home);
  const main = page.getByRole("main");
  await expect(main).not.toContainText("Salt Patterns");
  await expect(main).not.toContainText("template");
  await expect(main.locator('a[href^="/run/"], a[href^="/templates"]')).toHaveCount(0);
});

test("Failed Run: the item names the Run and its Assessment and opens the Run", async ({ page, db }) => {
  const { run } = assessment(db, "Checkout platform migration", "failed");
  await page.goto(paths.home);
  await expect(attention(page)).toHaveCount(1);
  await expect(attention(page).first()).toContainText("Checkout platform migration");
  await attention(page).first().getByRole("link", { name: "Run #1 failed" }).click();
  await expect(page).toHaveURL(new RegExp(`${paths.run(run.publicId)}$`));
});

test("More than one page of problems: 20 per page, newest first, with the page in the address", async ({ page, db }) => {
  for (let index = 0; index < 45; index++) assessment(db, `Assessment ${String(index).padStart(2, "0")}`, "failed");
  await page.goto(paths.home);
  await expect(page.getByRole("region", { name: "Needs attention" })).toContainText("45 problems");
  await expect(attention(page)).toHaveCount(20);
  await expect(attention(page).first()).toContainText("Assessment 44");
  const pager = page.getByRole("navigation", { name: "Needs attention pages" });
  await expect(pager).toContainText("Page 1 of 3");

  await page.goto("/?page=2");
  await expect(attention(page)).toHaveCount(20);
  await expect(attention(page).first()).toContainText("Assessment 24");
  await expect(attention(page).last()).toContainText("Assessment 05");
});

test("Opening the conflicts from Home: the item opens the DE Console import page at its conflicts", async ({ page, db }) => {
  createApplication(db, { sealId: "88002", name: "Access Shell" });
  createApplication(db, { sealId: "88002", name: "Access Settings" });
  readDeConsole(db, [{ seal_id: "88002" }, { seal_id: "88001" }, { seal_id: "88001" }], new Date());
  recordFailedDeConsoleRead(db, { trigger: "schedule", error: "The DE Console didn't answer within 30 seconds", readAt: new Date() });

  await page.goto(paths.home);
  await expect(attention(page).filter({ hasText: "The DE Console couldn't be read" })).toHaveCount(1);
  await attention(page).getByRole("link", { name: "2 DE Console entries are in conflict" }).click();
  await expect(page).toHaveURL(/\/repositories\/de-console#conflicts$/);
  await expect(page.getByRole("region", { name: "Conflicts" })).toBeInViewport();
});

test("Nothing to do: an empty state without an action", async ({ page, db }) => {
  assessment(db, "Checkout platform migration", "complete", "conforms");
  await page.goto(paths.home);
  const needsAttention = page.getByRole("region", { name: "Needs attention" });
  await expect(needsAttention.getByText("Nothing needs attention")).toBeVisible();
  await expect(needsAttention.getByText("Home checks each Assessment's latest Run and Evaluation, and the DE Console import.")).toBeVisible();
  await expect(needsAttention.getByRole("link")).toHaveCount(0);
  await expect(needsAttention.getByRole("button")).toHaveCount(0);
});

// Every way to Home lands on Home with the menu closed: no drawer open.
test.describe("reaching Home", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the product mark opens Home from a Run, with the menu closed", async ({ page, db }) => {
    const { assessment: run } = await seedResults(db);
    await page.goto(paths.run(run.publicId));
    await expect(primary(page).getByRole("link", { name: "All Assessments" })).toBeVisible();
    await page.getByRole("link", { name: "DE FabLab home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(title(page)).toHaveText("Home");
    await expectClosedMenu(page);
  });

  test("the Home item opens Home from a list page, with the menu closed", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
    await primary(page).getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expectClosedMenu(page);
  });

  test("the product mark on Home keeps Home with the menu closed", async ({ page, db: _db }) => {
    await page.goto(paths.home);
    await page.getByRole("link", { name: "DE FabLab home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expectClosedMenu(page);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the product mark and the Home item open Home with the menu closed", async ({ page, db: _db }) => {
      await page.goto(paths.repositories);
      await page.getByRole("link", { name: "DE FabLab home" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expectClosedMenu(page);

      await page.goto(paths.repositories);
      await primary(page).getByRole("link", { name: "Home", exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await expectClosedMenu(page);
    });
  });
});

test.describe("reaching Home on a narrow viewport", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  const openNavigation = (page: Page) => page.locator("[data-shell-header]").getByRole("button", { name: "Open navigation" });

  test("the Home item closes the drawer and opens Home", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
    await openNavigation(page).click();
    await primary(page).getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(title(page)).toHaveText("Home");
  });

  test("the product mark closes the drawer, from another page and on Home itself", async ({ page, db: _db }) => {
    await page.goto(paths.repositories);
    await openNavigation(page).click();
    await page.getByRole("link", { name: "DE FabLab home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#sidebar")).toBeHidden();

    // Already on Home, the address doesn't change, and the drawer still closes.
    await openNavigation(page).click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.getByRole("link", { name: "DE FabLab home" }).click();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(title(page)).toHaveText("Home");
  });

  test("Narrow content area: two figures per row, stacked attention rows, no overflow", async ({ page, db }) => {
    for (let index = 0; index < 3; index++) claim(db, buildSource(db));
    assessment(db, "Checkout platform migration", "failed");
    await page.goto(paths.home);
    const [first, second, third] = await page.locator('dl[aria-label="Repositories"] > div').all();
    const [a, b, c] = await Promise.all([first!.boundingBox(), second!.boundingBox(), third!.boundingBox()]);
    expect(a!.y).toBe(b!.y);
    expect(c!.y).toBeGreaterThan(a!.y);
    await expect(attention(page)).toHaveCount(1);
    // Every panel stacks in one column.
    const lefts = await page.getByRole("main").locator("[data-panel]").evaluateAll((panels) => [...new Set(panels.map((panel) => Math.round(panel.getBoundingClientRect().left)))]);
    expect(lefts).toHaveLength(1);
    await expectNoHorizontalOverflow(page);
  });
});

// operator-interface/home spec: the dashboard.
test.describe("the dashboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Wide layout: the Repositories and Assessments panels side by side, then the trend and activity, each row at equal heights, then Needs attention and Quick actions at full width (Wide layout)", async ({ page, db }) => {
    claim(db, buildSource(db));
    assessment(db, "Checkout platform migration", "complete", "gaps");
    await page.goto(paths.home);
    const panel = (name: string) => page.getByRole("main").getByRole("region", { name, exact: true });
    const boxes = async (names: string[]) => Promise.all(names.map(async (name) => (await panel(name).boundingBox())!));
    for (const row of [["Repositories", "Assessments"], ["Assessment trend", "Recent activity"]]) {
      const shown = await boxes(row);
      expect(new Set(shown.map((box) => Math.round(box.y))).size, row.join(", ")).toBe(1);
      expect(new Set(shown.map((box) => Math.round(box.height))).size, row.join(", ")).toBe(1);
    }
    const [figures, trend, attentionBox, actions] = await boxes(["Repositories", "Assessment trend", "Needs attention", "Quick actions"]);
    expect(figures!.y).toBeLessThan(trend!.y);
    expect(trend!.y).toBeLessThan(attentionBox!.y);
    expect(attentionBox!.y).toBeLessThan(actions!.y);
    expect(Math.round(attentionBox!.width)).toBe(Math.round(actions!.width));
    expect(attentionBox!.width).toBeGreaterThan(figures!.width * 1.5);
  });

  test("Repositories added this week: each figure states its change over seven days in words (No change)", async ({ page, db }) => {
    buildSource(db, { name: "payee-hub" });
    buildSource(db, { name: "ledger" });
    await page.goto(paths.home);
    const repositories = page.locator('dl[aria-label="Repositories"]');
    await expect(repositories.locator('[data-figure="Enabled"]')).toContainText("2");
    await expect(repositories.locator('[data-figure="Enabled"]')).toContainText("+2 this week");
    await expect(repositories.locator('[data-figure="Claimed"]')).toContainText("No change this week");
  });

  test("Trend: this week's Evaluations are charted by conclusion, with the same figures in a table (Trend)", async ({ page, db }) => {
    assessment(db, "Checkout platform migration", "complete", "gaps");
    assessment(db, "Payments baseline", "complete", "gaps");
    assessment(db, "Markets baseline", "complete", "conforms");
    await page.goto(paths.home);
    const trend = page.getByRole("main").getByRole("region", { name: "Assessment trend" });
    await expect(trend.locator("svg rect title")).toHaveCount(2);
    const table = trend.getByRole("table", { name: "Evaluations completed each week, by conclusion" });
    const lastWeek = table.locator("tbody tr").last();
    await expect(lastWeek.locator("td")).toHaveText(["2", "0", "1", "0"]);
  });

  test("Recent activity: the newest finished Run first, linking to it", async ({ page, db }) => {
    assessment(db, "Checkout platform migration", "failed");
    const { run } = assessment(db, "Payments baseline", "complete");
    await page.goto(paths.home);
    const activity = page.getByRole("list", { name: "Recent activity" }).getByRole("listitem");
    await expect(activity).toHaveCount(2);
    await expect(activity.first()).toContainText("Run finished: Payments baseline");
    await expect(activity.nth(1)).toContainText("Run failed: Checkout platform migration");
    await activity.first().getByRole("link", { name: "Payments baseline" }).click();
    await expect(page).toHaveURL(new RegExp(`${paths.run(run.publicId)}$`));
  });

  test("Quick actions: New Assessment and Import Repositories", async ({ page, db: _db }) => {
    await page.goto(paths.home);
    const actions = page.getByRole("group", { name: "Quick actions" });
    await expect(actions.getByRole("link")).toHaveText(["New Assessment", "Import Repositories"]);
    await actions.getByRole("link", { name: "New Assessment" }).click();
    await expect(page).toHaveURL(/\/assessments\/new$/);
  });
});
