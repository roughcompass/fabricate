import type { Page } from "@playwright/test";
import { listAssessments } from "../src/lib/assessments/assessment-records";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { buildInitiative, buildSource } from "../test/support/builders";
import { seedAssessment } from "../test/support/scenarios";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { ORDERS, seedResults, serverConfig } from "./support/results";

const header = (page: Page) => page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });

test("starts a second Evaluation against the same Assessment after changing only the Release selection", async ({ page, db }) => {
  const { initiative, assessment } = await seedResults(db);
  const runJobs = () => drainJobs(db, jobHandlers(db, serverConfig()));

  await page.goto(`/initiatives/${initiative.publicId}`);
  const selected = page.getByRole("region", { name: "Standard Releases" });
  await expect(selected).toContainText("Engineering baseline v1");
  await expect(selected).toContainText("Service readiness v1");
  const assessments = page.getByRole("table", { name: "Assessment history" });
  await expect(assessments.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("Not evaluated yet")).toBeVisible();

  await assessments.getByRole("row").filter({ hasText: assessment.publicId }).getByRole("button", { name: "Start Evaluation" }).click();
  await expect(page.getByText("The Evaluation was started.", { exact: false })).toBeVisible();
  await expect(header(page)).toContainText("Queued");
  const first = page.url().split("/evaluations/")[1]!.split("?")[0]!;
  await runJobs(); // the page polls its status and refreshes when the Evaluation finishes
  await expect(header(page)).toContainText("Complete");
  await expect(page.getByRole("table", { name: "Summary by Release" }).locator("tbody tr")).toHaveCount(2);

  // Change only the Release selection.
  await page.goto(`/initiatives/${initiative.publicId}/edit`);
  await page.getByRole("group", { name: "Standard Releases" }).getByRole("checkbox", { name: "Service readiness v1" }).uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("The initiative was updated.", { exact: false })).toBeVisible();
  await expect(selected).not.toContainText("Service readiness v1");

  // The finished Assessment is reused, not repeated.
  await expect(assessments.locator("tbody tr")).toHaveCount(1);
  await assessments.getByRole("row").filter({ hasText: assessment.publicId }).getByRole("button", { name: "Start Evaluation" }).click();
  await expect(page.getByText("The Evaluation was started.", { exact: false })).toBeVisible();
  const second = page.url().split("/evaluations/")[1]!.split("?")[0]!;
  expect(second).not.toBe(first);
  await runJobs();
  await expect(header(page)).toContainText("Complete");
  const inputs = page.getByRole("region", { name: "Inputs" });
  await expect(inputs.getByRole("link", { name: assessment.publicId })).toBeVisible();
  await expect(inputs).toContainText("Engineering baseline v1");
  await expect(inputs).not.toContainText("Service readiness v1");

  // Both Evaluations are listed separately, against the one Assessment, each with the Releases it started with.
  await page.goto(`/initiatives/${initiative.publicId}`);
  const evaluations = page.getByRole("table", { name: "Evaluation history" });
  await expect(evaluations.locator("tbody tr")).toHaveCount(2);
  const newest = evaluations.getByRole("row").filter({ hasText: second });
  const earlier = evaluations.getByRole("row").filter({ hasText: first });
  await expect(newest).toContainText(assessment.publicId);
  await expect(newest).toContainText("Engineering baseline v1");
  await expect(newest).not.toContainText("Service readiness v1");
  await expect(earlier).toContainText(assessment.publicId);
  await expect(earlier).toContainText("Service readiness v1");
  expect(listAssessments(db, initiative.id)).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
});

test("offers Evaluation only for finished Assessments and explains what is missing", async ({ page, db }) => {
  const orders = buildSource(db, { name: "orders" });
  const initiative = buildInitiative(db, { name: "Unscored", sources: [orders] });
  const finished = await seedAssessment(db, initiative, [orders], [ORDERS]);
  const failed = await seedAssessment(db, initiative, [orders], ["failed"]);

  await page.goto(`/initiatives/${initiative.publicId}`);
  const assessments = page.getByRole("table", { name: "Assessment history" });
  await expect(assessments.getByRole("row").filter({ hasText: finished.publicId }).getByRole("link", { name: "Select a Release to evaluate" })).toBeVisible();
  await expect(assessments.getByRole("row").filter({ hasText: failed.publicId })).toContainText("No results to evaluate");
  await expect(page.getByRole("button", { name: "Start Evaluation" })).toHaveCount(0);
  await expect(page.getByText("Select a published Standard Release, then evaluate a finished Assessment.")).toBeVisible();
});
