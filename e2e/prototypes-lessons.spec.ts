import { expect, test } from "./support/fixtures";
import { generate } from "./support/prototypes";

// prototypes/learning spec: the Lessons page.

const LESSON = "Show the cut-off time beside every payment amount.";

test("applies a lesson written directly to the next generation, and records it in provenance (Writing a lesson)", async ({ page, db: _db }) => {
  await page.goto("/prototypes/lessons?view=progress");
  await expect(page.locator("[data-progress-summary=not-enough]")).toBeVisible();
  await page.goto("/prototypes/lessons");
  await page.getByText("Write a lesson").click();
  await page.getByLabel("Lesson", { exact: true }).first().fill(LESSON);
  await page.getByRole("button", { name: "Add lesson" }).click();
  const active = page.getByRole("list", { name: "Active lessons" });
  await expect(active).toContainText(LESSON);
  await expect(active.locator("[data-applied]")).toHaveText("Applied by 0 versions");

  await generate(page, { intent: "Review and release today's urgent payments before cut-off", personas: ["Maya Lindqvist"], variants: 1 });
  await page.getByRole("button", { name: "Keep" }).click();
  await page.getByRole("link", { name: "Exception-first queue" }).click();
  await page.waitForURL(/\/prototypes\/pro_[a-z0-9]{16}$/);
  await page.goto(`${page.url()}?tab=provenance`);
  await expect(page.getByRole("main")).toContainText(LESSON);

  await page.goto("/prototypes/lessons");
  await expect(active.locator("[data-applied]")).toHaveText("Applied by 1 version");
  await page.goto("/prototypes/lessons?view=progress");
  await expect(page.locator("[data-progress-row]")).toHaveCount(1);
  await page.goto("/prototypes/lessons");

  // Turned off, it moves to its own list; deleted, it is gone.
  await active.getByRole("button", { name: "Turn off" }).click();
  await page.getByText("Turned off (1)").click();
  const off = page.getByRole("list", { name: "Turned off lessons" });
  await expect(off).toContainText(LESSON);
  await off.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete lesson" }).click();
  await expect(page.getByRole("list", { name: "Turned off lessons" })).toHaveCount(0);
});

test("proposes a lesson from a discard reason, citing it, and accepts it with an edit (Proposed lessons)", async ({ page, db: _db }) => {
  await generate(page, { intent: "Review and release today's urgent payments before cut-off", personas: ["Maya Lindqvist"], variants: 2 });
  const second = page.locator("[data-prototype-variant]").nth(1);
  await second.getByLabel("Reason").fill("Bury the exceptions under a summary chart");
  await second.getByRole("button", { name: "Discard" }).click();
  await expect(second).toContainText("Discarded: Bury the exceptions");

  await page.goto("/prototypes/lessons");
  const proposed = page.getByRole("list", { name: "Lessons to review" });
  await expect(async () => {
    await page.reload();
    await expect(proposed).toContainText("For approval queues, bury the exceptions under a summary chart.", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(proposed.getByRole("link", { name: "A discard reason" })).toHaveAttribute("href", /\/prototypes\/generations\/gen_/);

  await proposed.getByText("Edit, then accept").click();
  await proposed.getByLabel("Lesson").fill("For approval queues, lead with the exceptions, not a summary chart.");
  await proposed.getByRole("button", { name: "Accept with edits" }).click();
  await expect(page.getByRole("list", { name: "Active lessons" })).toContainText("For approval queues, lead with the exceptions, not a summary chart.");
  await expect(page.getByRole("list", { name: "Lessons to review" })).toHaveCount(0);
});

test("runs a lesson check that generates six variants and reports the pairs, after saying it uses today's generations (Running a lesson check; Editing a benchmark intent)", async ({ page, db: _db }) => {
  await page.goto("/prototypes/lessons?view=check");
  const check = page.locator("#lesson-check");
  await expect(check.getByRole("button", { name: "Run lesson check" })).toBeDisabled();
  await expect(check).toContainText("Accept or add a lesson to check it.");
  await page.goto("/prototypes/lessons");
  await page.getByText("Write a lesson").click();
  await page.getByLabel("Lesson", { exact: true }).first().fill(LESSON);
  await page.getByRole("button", { name: "Add lesson" }).click();
  await expect(page.getByRole("list", { name: "Active lessons" })).toContainText(LESSON);
  await page.goto("/prototypes/lessons?view=check");

  await check.getByText("Benchmark intents").click();
  await check.getByLabel("Benchmark 1").fill("Approve a corporate card limit increase");
  await check.locator("[data-benchmark=benchmark-1]").getByRole("button", { name: "Save benchmark" }).click();
  await expect(check.locator("[data-benchmark=benchmark-1]")).toContainText("Saved. The next lesson check uses it.");

  await expect(check.locator("[data-lesson-check-cost]")).toContainText("A lesson check generates 6 variants, which uses 6 of today's generations. 30 are left.");
  await check.getByRole("button", { name: "Run lesson check" }).click();
  await expect(check.locator("[data-lesson-check]")).toHaveCount(1, { timeout: 90_000 });
  const result = check.locator("[data-lesson-check]").first();
  await expect(result).toContainText(/With lessons: won \d, lost \d, undecided \d/);
  await expect(result).toContainText("1 lesson checked");
  await expect(check.locator("[data-lesson-check-pair]")).toHaveCount(3);
  await expect(check.locator("[data-lesson-check-pair='1']")).toContainText("Approve a corporate card limit increase");
  await expect(check.locator("[data-lesson-check-pair='1']")).toContainText("Passed");
});
