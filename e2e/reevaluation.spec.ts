import { listRuns } from "../src/lib/runs/run-records";
import { buildAssessment, buildRepository } from "../test/support/builders";
import { ORDERS, seedRun } from "../test/support/scenarios";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { seedResults, runJobs } from "./support/results";
import { paths } from "./support/paths";
import { pageHeader } from "./support/shell";

// The page header: status, meta, and actions; the title is in the shell header.

test("starts a second Evaluation against the same Assessment after changing only the Release selection", async ({ page, db }) => {
  const { assessment, run } = await seedResults(db);

  await page.goto(paths.assessment(assessment.publicId));
  const selected = page.getByRole("region", { name: "Overview" });
  await expect(selected).toContainText("Engineering baseline v1");
  await expect(selected).toContainText("Service readiness v1");
  const runs = page.getByRole("table", { name: "Run history" });
  await expect(runs.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("No Evaluations yet")).toBeVisible();

  await runs.getByRole("button", { name: "Actions for Run #1" }).click();
  await runs.getByRole("button", { name: "Start Evaluation" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Evaluation #1 was started.")).toBeVisible();
  await expect(pageHeader(page)).toContainText("Queued");
  const first = page.url().split("/evaluations/")[1]!.split("?")[0]!;
  await runJobs(db); // the page polls its status and refreshes when the Evaluation finishes
  await expect(pageHeader(page)).toContainText("Complete");
  await expect(page.getByRole("table", { name: "Summary by Release" }).locator("tbody tr")).toHaveCount(2);

  // Change only the Release selection.
  await page.goto(paths.assessmentEdit(assessment.publicId));
  await page.getByRole("group", { name: "Standard Releases" }).getByRole("checkbox", { name: "Service readiness v1" }).uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Fleet assessment was updated.")).toBeVisible();
  await expect(selected).not.toContainText("Service readiness v1");

  // The finished Assessment is reused, not repeated.
  await expect(runs.locator("tbody tr")).toHaveCount(1);
  await runs.getByRole("button", { name: "Actions for Run #1" }).click();
  await runs.getByRole("button", { name: "Start Evaluation" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Evaluation #2 was started.")).toBeVisible();
  const second = page.url().split("/evaluations/")[1]!.split("?")[0]!;
  expect(second).not.toBe(first);
  await runJobs(db);
  await expect(pageHeader(page)).toContainText("Complete");
  await expect(pageHeader(page).getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Run #1" })).toHaveAttribute("href", paths.run(run.publicId));
  const findings = page.getByRole("region", { name: "Findings", exact: true });
  await expect(findings).toContainText("Engineering baseline v1");
  await expect(findings).not.toContainText("Service readiness v1");

  // Both Evaluations are listed separately, against the one Assessment, each with the Releases it started with.
  await page.goto(paths.assessment(assessment.publicId));
  const evaluations = page.getByRole("table", { name: "Evaluation history" });
  await expect(evaluations.locator("tbody tr")).toHaveCount(2);
  const newest = evaluations.getByRole("row").filter({ hasText: "Evaluation #2" });
  const earlier = evaluations.getByRole("row").filter({ hasText: "Evaluation #1" });
  await expect(newest.getByRole("link", { name: "Evaluation #2" })).toHaveAttribute("href", `/evaluations/${second}`);
  await expect(earlier.getByRole("link", { name: "Evaluation #1" })).toHaveAttribute("href", `/evaluations/${first}`);
  await expect(newest).toContainText("Run #1");
  await expect(newest).toContainText("Engineering baseline v1");
  await expect(newest).not.toContainText("Service readiness v1");
  await expect(earlier).toContainText("Run #1");
  await expect(earlier).toContainText("Service readiness v1");
  expect(listRuns(db, assessment.id)).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
});

test("offers Evaluation only for finished Assessments and explains what is missing", async ({ page, db }) => {
  const orders = buildRepository(db, { name: "orders" });
  const assessment = buildAssessment(db, { name: "Unscored", repositories: [orders] });
  const finished = await seedRun(db, assessment, [orders], [ORDERS]);
  const failed = await seedRun(db, assessment, [orders], ["failed"]);

  await page.goto(paths.assessment(assessment.publicId));
  const runs = page.getByRole("table", { name: "Run history" });
  // A row's actions are in its overflow menu.
  const first = runs.getByRole("row").filter({ hasText: "Run #1" });
  await first.getByRole("button", { name: "Actions for Run #1" }).click();
  await expect(first.getByRole("link", { name: "Select a Release to evaluate" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(runs.getByRole("row").filter({ hasText: "Run #2" })).toContainText("No results to evaluate");
  expect([finished.publicId, failed.publicId]).toHaveLength(2);
  await expect(page.getByRole("button", { name: "Start Evaluation" })).toHaveCount(0);
  await expect(page.getByText("Select a published Standard Release, then evaluate a finished Run.")).toBeVisible();
});
