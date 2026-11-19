import type { Page } from "@playwright/test";
import { buildRun, buildAssessment, buildRepository } from "../test/support/builders";
import { buildEvaluation, driveEvaluation, driveRun } from "../test/support/home";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { seedResults } from "./support/results";
import { pageTitle } from "./support/shell";

// operator-interface/home spec: Home at the root address, its figures and the
// exact lists they open, Needs attention, and the shell's ways to reach it.

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const title = pageTitle;
const attention = (page: Page) => page.getByRole("table", { name: "Needs attention" }).locator("tbody tr");

type Db = Parameters<typeof buildRepository>[0];

/** An Assessment over one new Repository whose latest Run ends in +run+, evaluated to +conclusion+ when given. */
function assessment(db: Db, name: string, run: "complete" | "failed", conclusion?: "gaps" | "conforms" | "undetermined") {
  const assessment = buildAssessment(db, { name, repositories: [buildRepository(db)] });
  const finished = driveRun(db, buildRun(db, { assessment }).run, run);
  if (conclusion) driveEvaluation(db, buildEvaluation(db, assessment, finished), "complete", conclusion);
  return { assessment, run: finished };
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
  await expect(page).toHaveTitle("Home · Frontend Registry");
  await expect(title(page)).toHaveText("Home");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expectClosedMenu(page);
});

test("Fresh installation: each group shows its empty state and actions, and nothing needs attention", async ({ page, db: _db }) => {
  await page.goto(paths.home);
  await expect(page.getByText("No Repositories yet")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Add Repositories" }).first()).toHaveAttribute("href", "/repositories/bulk");
  await expect(page.getByRole("link", { name: "New Repository" }).last()).toHaveAttribute("href", "/repositories/new");
  await expect(page.getByText("No Assessments yet")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "New Assessment" }).first()).toHaveAttribute("href", "/assessments/new");
  const needsAttention = page.getByRole("region", { name: "Needs attention" });
  await expect(needsAttention.getByText("Nothing needs attention")).toBeVisible();
  await expect(needsAttention.getByRole("link")).toHaveCount(0);
});

test("every figure opens a list showing exactly the records it counts (Conclusion figure opens its tab)", async ({ page, db }) => {
  for (let index = 0; index < 6; index++) buildRepository(db, { name: `repo-${index}` });
  assessment(db, "Checkout platform migration", "complete", "gaps");
  assessment(db, "Payments baseline", "complete", "gaps");
  assessment(db, "Markets baseline", "complete", "conforms");
  assessment(db, "Ledger review", "complete");

  await page.goto(paths.home);
  const figures: { group: string; label: string; value: number; href: string }[] = [];
  for (const group of ["Repositories", "Assessments"]) {
    // Each figure's count is the first link in it; Profiled is a count without a list, so it has none.
    for (const stat of await page.locator(`dl[aria-label="${group}"] [data-figure]`).all()) {
      const link = stat.locator("a").first();
      if (!(await link.count())) continue;
      figures.push({ group, label: (await stat.getAttribute("data-figure"))!, value: Number((await link.textContent())!.replace(/[^\d]/g, "")), href: (await link.getAttribute("href"))! });
    }
  }
  expect(figures.map(({ label, value }) => [label, value])).toEqual([
    // Six Repositories, and one more for each Assessment.
    ["Repositories", 10],
    ["Assessments", 4],
    ["Gaps found", 2],
    ["Undetermined", 0],
    ["Conforms", 1],
    ["Not evaluated", 1],
  ]);
  await expect(page.locator('dl[aria-label="Repositories"] [data-figure="Profiled"]')).toContainText("of 10");

  for (const { group, label, value, href } of figures) {
    await page.goto(href);
    const rows = page.getByRole("table", { name: group, exact: true }).locator("tbody tr");
    if (value === 0) await expect(rows, label).toHaveCount(0);
    else await expect(rows, `${label} opens ${href}`).toHaveCount(value);
  }
});

test("Same page for everyone: a visitor's cookies don't change Home", async ({ page, context, db, baseURL }) => {
  buildRepository(db);
  assessment(db, "Checkout platform migration", "failed");
  await page.goto(paths.home);
  const first = await page.getByRole("main").innerText();

  await context.addCookies([{ name: "stated-name", value: "Bo", url: baseURL! }]);
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

test("Nothing to do: an empty state without an action", async ({ page, db }) => {
  assessment(db, "Checkout platform migration", "complete", "conforms");
  await page.goto(paths.home);
  const needsAttention = page.getByRole("region", { name: "Needs attention" });
  await expect(needsAttention.getByText("Nothing needs attention")).toBeVisible();
  await expect(needsAttention.getByText("Home checks each Assessment's latest Run and Evaluation.")).toBeVisible();
  await expect(needsAttention.getByRole("link")).toHaveCount(0);
  await expect(needsAttention.getByRole("button")).toHaveCount(0);
});

// Every way to Home lands on Home with the menu closed: no drawer open.
test.describe("reaching Home", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the product mark opens Home from a Run, with the menu closed", async ({ page, db }) => {
    const { run } = await seedResults(db);
    await page.goto(paths.run(run.publicId));
    await expect(primary(page).getByRole("link", { name: "All Assessments" })).toBeVisible();
    await page.getByRole("link", { name: "Frontend Registry home" }).click();
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
    await page.getByRole("link", { name: "Frontend Registry home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expectClosedMenu(page);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the product mark and the Home item open Home with the menu closed", async ({ page, db: _db }) => {
      await page.goto(paths.repositories);
      await page.getByRole("link", { name: "Frontend Registry home" }).click();
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
    await page.getByRole("link", { name: "Frontend Registry home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#sidebar")).toBeHidden();

    // Already on Home, the address doesn't change, and the drawer still closes.
    await openNavigation(page).click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.getByRole("link", { name: "Frontend Registry home" }).click();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(title(page)).toHaveText("Home");
  });

  test("Narrow content area: two figures per row, stacked attention rows, no overflow", async ({ page, db }) => {
    assessment(db, "Checkout platform migration", "failed");
    await page.goto(paths.home);
    const [first, second] = await page.locator('dl[aria-label="Repositories"] > div').all();
    const [a, b] = await Promise.all([first!.boundingBox(), second!.boundingBox()]);
    expect(a!.y).toBe(b!.y);
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

  test("Wide layout: Needs attention first at full width, then the Repositories and Assessments figures side by side, then the trend and activity at equal heights (Wide layout)", async ({ page, db }) => {
    assessment(db, "Checkout platform migration", "failed");
    await page.goto(paths.home);
    const panel = (name: string) => page.getByRole("main").getByRole("region", { name, exact: true });
    const boxes = async (names: string[]) => Promise.all(names.map(async (name) => (await panel(name).boundingBox())!));
    const [attentionBox, repositories, assessments, trend, activity] = await boxes(["Needs attention", "Repositories", "Assessments", "Assessment trend", "Recent activity"]);
    expect(attentionBox!.y).toBeLessThan(repositories!.y);
    expect(Math.round(repositories!.y)).toBe(Math.round(assessments!.y));
    expect(Math.round(repositories!.height)).toBe(Math.round(assessments!.height));
    expect(repositories!.y).toBeLessThan(trend!.y);
    expect(Math.round(trend!.y)).toBe(Math.round(activity!.y));
    expect(Math.round(trend!.height)).toBe(Math.round(activity!.height));
    expect(attentionBox!.width).toBeGreaterThan(repositories!.width);
    // The two Repositories figures sit in one row.
    const cards = await page.locator('dl[aria-label="Repositories"] > [data-figure]').all();
    expect(new Set(await Promise.all(cards.map(async (card) => Math.round((await card.boundingBox())!.y)))).size).toBe(1);
  });

  test("Profiled: how many Repositories have a profile, out of all, with what's profiling now", async ({ page, db }) => {
    buildRepository(db, { name: "payee-hub" });
    buildRepository(db, { name: "ledger" });
    await page.goto(paths.home);
    const profiled = page.locator('dl[aria-label="Repositories"] [data-figure="Profiled"]');
    await expect(profiled).toContainText("0");
    await expect(profiled).toContainText("of 2");
    await expect(profiled.getByRole("img", { name: "Profiled: 0%" })).toBeVisible();
  });

  test("Repositories added this week: the figure states its change over seven days in words", async ({ page, db }) => {
    buildRepository(db, { name: "payee-hub" });
    buildRepository(db, { name: "ledger" });
    await page.goto(paths.home);
    const repositories = page.locator('dl[aria-label="Repositories"]');
    await expect(repositories.locator('[data-figure="Repositories"]')).toContainText("2");
    await expect(repositories.locator('[data-figure="Repositories"]')).toContainText("+2 this week");
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
    await expect(activity.first()).toContainText("Run finished: Run #1 · Payments baseline");
    await expect(activity.nth(1)).toContainText("Run failed: Run #1 · Checkout platform migration");
    await activity.first().getByRole("link", { name: "Run #1 · Payments baseline" }).click();
    await expect(page).toHaveURL(new RegExp(`${paths.run(run.publicId)}$`));
  });

  test("Actions in the header: New Assessment and Add Repositories", async ({ page, db }) => {
    buildRepository(db);
    await page.goto(paths.home);
    await expect(page.getByRole("main").getByRole("link", { name: "Add Repositories" }).first()).toHaveAttribute("href", "/repositories/bulk");
    await page.getByRole("main").getByRole("link", { name: "New Assessment" }).first().click();
    await expect(page).toHaveURL(/\/assessments\/new$/);
  });
});

// page-patterns spec, content standard "One label per destination".
test("One label for adding Repositories: Home and the Repositories list link the bulk page with one label", async ({ page, db }) => {
  buildRepository(db, { name: "orders" });
  const labels = new Set<string>();
  for (const address of [paths.home, paths.repositories]) {
    await page.goto(address);
    for (const link of await page.getByRole("main").locator('a[href="/repositories/bulk"]').all()) labels.add((await link.textContent())!.trim());
  }
  expect([...labels]).toEqual(["Add Repositories"]);
});

// page-patterns spec, "Link text names its target".
test("Recent activity: four Runs of one Assessment each name their Run, and no two links share a text", async ({ page, db }) => {
  const repositories = [buildRepository(db, { name: "web" })];
  const fleet = buildAssessment(db, { name: "Salt adherence, fleet", repositories });
  for (let index = 0; index < 4; index++) driveRun(db, buildRun(db, { assessment: fleet, repositories }).run, "complete");
  await page.goto(paths.home);
  const links = page.getByRole("list", { name: "Recent activity" }).getByRole("link");
  await expect(links).toHaveText(["Run #4 · Salt adherence, fleet", "Run #3 · Salt adherence, fleet", "Run #2 · Salt adherence, fleet", "Run #1 · Salt adherence, fleet"]);
});

// design-system spec, "Status and values are presented through one registry": a Run with issues is a warning wherever it shows.
test("A Run complete with issues shows the registry's warning tone in Recent activity, the Run header, the Assessments list, and the Assessment's Runs", async ({ page, db }) => {
  const repositories = [buildRepository(db, { name: "orders" }), buildRepository(db, { name: "billing" })];
  const fleet = buildAssessment(db, { name: "Fleet baseline", repositories });
  const run = driveRun(db, buildRun(db, { assessment: fleet, repositories }).run, "complete_with_issues", { failedTargets: 1 });
  const tone = (scope: ReturnType<Page["locator"]>) => scope.locator("[data-tone]").first().getAttribute("data-tone");

  await page.goto(paths.home);
  const item = page.getByRole("list", { name: "Recent activity" }).getByRole("listitem");
  await expect(item).toContainText("Run finished with issues: Run #1 · Fleet baseline");
  expect(await tone(item)).toBe("warning");

  await page.goto(paths.run(run.publicId));
  const header = page.locator("main header").first();
  await expect(header).toContainText("Complete with issues");
  expect(await tone(header.locator("[data-header-status]"))).toBe("warning");

  await page.goto(paths.assessments);
  const latest = page.getByRole("table", { name: "Assessments" }).getByRole("row").filter({ hasText: "Fleet baseline" });
  await expect(latest).toContainText("Complete with issues");
  expect(await tone(latest.locator("td").filter({ hasText: "Complete with issues" }))).toBe("warning");

  await page.goto(paths.assessment(fleet.publicId));
  const row = page.getByRole("table", { name: "Run history" }).getByRole("row").filter({ hasText: "Run #1" });
  await expect(row).toContainText("Complete with issues");
  expect(await tone(row.locator("td").filter({ hasText: "Complete with issues" }))).toBe("warning");
});
