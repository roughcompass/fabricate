import { expect, test } from "./support/fixtures";
import { waitForFrame } from "./support/prototypes";

// prototypes/availability spec, "Each workspace starts with seeded examples";
// learning spec, "Seeded progress" and "Seeded lesson check". The browser's
// workspace is copied from the committed seed, with no model credential.

test.beforeEach(async ({ page, db: _db }) => {
  await page.request.post("/api/test/prototypes/settings", { data: { examples: true, credentials: "none" } });
});

test("lists the seeded prototypes, personas, and lessons in a new workspace (First visit)", async ({ page, db: _db }) => {
  await page.goto("/prototypes");
  const rows = page.locator("[data-prototype]");
  expect(await rows.count()).toBeGreaterThanOrEqual(4);
  await expect(rows.filter({ hasText: "Component" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "(fork)" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "v3" }).first()).toBeVisible();

  await page.goto("/prototypes/personas");
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await page.goto("/prototypes/lessons");
  expect(await page.getByRole("list", { name: "Active lessons" }).getByRole("listitem").count()).toBeGreaterThan(0);
});

test("shows the seeded progress and lesson check on the Lessons page without a model (Seeded progress; Seeded lesson check)", async ({ page, db: _db }) => {
  await page.goto("/prototypes/lessons?view=progress");
  expect(await page.locator("[data-progress-row]").count()).toBeGreaterThanOrEqual(6);
  const summary = page.locator("[data-progress-summary]");
  await expect(summary).toContainText("Earliest five generations");
  await expect(summary).toContainText("Latest five generations");
  await page.goto("/prototypes/lessons?view=check");
  const check = page.locator("[data-lesson-check]").first();
  await expect(check).toContainText(/With lessons: won \d, lost \d, undecided \d/);
  await expect(page.locator("[data-lesson-check-pair]")).toHaveCount(3);
});

test("opens a seeded prototype's versions, preview, checks, review, and feedback without a model (Seeds without a model)", async ({ page, db: _db }) => {
  await page.goto("/prototypes");
  await page.locator("[data-prototype]").filter({ hasText: "v3" }).first().getByRole("link").first().click();
  await waitForFrame(page);
  await expect(page.locator("[data-version-summary]")).toContainText("Version 3: Checks passed");
  await page.getByRole("link", { name: "Checks" }).click();
  await expect(page.locator("[data-checks-panel]")).toContainText("Persona fit");
  await page.getByRole("link", { name: "Feedback" }).click();
  await expect(page.getByText(/rated 5 of 5|Rated 5/).first()).toBeVisible();
  await expect(page.getByText("Generation isn't configured in this environment.").first()).toBeVisible();
});
