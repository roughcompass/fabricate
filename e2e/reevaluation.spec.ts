import type { Page } from "@playwright/test";
import { listAssessments } from "../src/lib/assessments/assessment-records";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { buildInitiative, buildSource } from "../test/support/builders";
import { seedAssessment } from "../test/support/scenarios";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { ORDERS, seedResults, serverConfig } from "./support/results";
import { paths } from "./support/paths";

// The page header: status, meta, and actions; the title is in the shell header.
const header = (page: Page) => page.locator("[data-page-header]");

test("starts a second Evaluation against the same Assessment after changing only the Release selection", async ({ page, db }) => {
  const { initiative, assessment } = await seedResults(db);
  const runJobs = () => drainJobs(db, jobHandlers(db, serverConfig()));

  await page.goto(paths.assessment(initiative.publicId));
  const selected = page.getByRole("region", { name: "Overview" });
  await expect(selected).toContainText("Engineering baseline v1");
  await expect(selected).toContainText("Service readiness v1");
  const assessments = page.getByRole("table", { name: "Run history" });
  await expect(assessments.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("No Evaluations yet")).toBeVisible();

  await assessments.getByRole("button", { name: "Start Evaluation of Run #1" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Evaluation #1 was started.")).toBeVisible();
  await expect(header(page)).toContainText("Queued");
  const first = page.url().split("/evaluations/")[1]!.split("?")[0]!;
  await runJobs(); // the page polls its status and refreshes when the Evaluation finishes
  await expect(header(page)).toContainText("Complete");
  await expect(page.getByRole("table", { name: "Summary by Release" }).locator("tbody tr")).toHaveCount(2);

  // Change only the Release selection.
  await page.goto(paths.assessmentEdit(initiative.publicId));
  await page.getByRole("group", { name: "Standard Releases" }).getByRole("checkbox", { name: "Service readiness v1" }).uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Fleet assessment was updated.")).toBeVisible();
  await expect(selected).not.toContainText("Service readiness v1");

  // The finished Assessment is reused, not repeated.
  await expect(assessments.locator("tbody tr")).toHaveCount(1);
  await assessments.getByRole("button", { name: "Start Evaluation of Run #1" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Evaluation #2 was started.")).toBeVisible();
  const second = page.url().split("/evaluations/")[1]!.split("?")[0]!;
  expect(second).not.toBe(first);
  await runJobs();
  await expect(header(page)).toContainText("Complete");
  await expect(header(page).getByRole("link", { name: "Run #1" })).toHaveAttribute("href", paths.run(assessment.publicId));
  const findings = page.getByRole("region", { name: "Findings", exact: true });
  await expect(findings).toContainText("Engineering baseline v1");
  await expect(findings).not.toContainText("Service readiness v1");

  // Both Evaluations are listed separately, against the one Assessment, each with the Releases it started with.
  await page.goto(paths.assessment(initiative.publicId));
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
  expect(listAssessments(db, initiative.id)).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
});

test("offers Evaluation only for finished Assessments and explains what is missing", async ({ page, db }) => {
  const orders = buildSource(db, { name: "orders" });
  const initiative = buildInitiative(db, { name: "Unscored", sources: [orders] });
  const finished = await seedAssessment(db, initiative, [orders], [ORDERS]);
  const failed = await seedAssessment(db, initiative, [orders], ["failed"]);

  await page.goto(paths.assessment(initiative.publicId));
  const assessments = page.getByRole("table", { name: "Run history" });
  await expect(assessments.getByRole("row").filter({ hasText: "Run #1" }).getByRole("link", { name: "Select a Release to evaluate" })).toBeVisible();
  await expect(assessments.getByRole("row").filter({ hasText: "Run #2" })).toContainText("No results to evaluate");
  expect([finished.publicId, failed.publicId]).toHaveLength(2);
  await expect(page.getByRole("button", { name: "Start Evaluation" })).toHaveCount(0);
  await expect(page.getByText("Select a published Standard Release, then evaluate a finished Run.")).toBeVisible();
});
