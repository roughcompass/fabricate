import type { JsonObject } from "@repo-facts/contract";
import type { Page } from "@playwright/test";
import { findingDocument, findingsOf } from "../src/lib/evaluations/evaluation-records";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, test } from "./support/fixtures";
import { evaluate, seedResults } from "./support/results";

const findingsTable = (page: Page, release: string) => page.getByRole("table", { name: `${release} Findings` });
const findingRows = (page: Page) => page.locator('table[aria-label$=" Findings"] tbody tr');
const status = (page: Page) => page.getByRole("status").filter({ hasText: "Finding" });

/** Clears the filters and waits for the unfiltered view, so the next selection is not lost to the form's reset. */
async function clearFilters(page: Page, total: number) {
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(status(page)).toHaveText(`${total} Findings`);
}

/** Applies one filter and waits for the filtered page, for the same reason. */
async function applyFilter(page: Page, label: string, value: string) {
  const form = page.getByRole("form", { name: "Filter Findings" });
  const select = form.getByLabel(label, { exact: true });
  const name = await select.getAttribute("name");
  await select.selectOption(value);
  await form.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]${name}=${encodeURIComponent(value)}(&|$)`));
}

test("summarizes each Release separately and filters Findings by Release, outcome, severity, Control, and subject", async ({ page, db }) => {
  const { initiative, assessment } = await seedResults(db);
  const evaluation = await evaluate(db, initiative.publicId, assessment.publicId);
  await page.goto(`/evaluations/${evaluation.publicId}`);
  await expect(page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) })).toContainText("Complete");
  await expect(page.getByText("1 repository in the Assessment had no Profile")).toBeVisible();

  const summary = page.getByRole("table", { name: "Summary by Release" });
  await expect(summary.getByRole("row").filter({ hasText: "Engineering baseline v1" })).toContainText("Gaps found");
  await expect(summary.getByRole("row").filter({ hasText: "Service readiness v1" })).toContainText("Gaps found");
  await expect(page.getByRole("heading", { level: 2, name: "Engineering baseline v1", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Service readiness v1", exact: true })).toBeVisible();

  // 5 repository Controls x 2 repositories, then 1 repository Control x 2 and 1 map Control.
  const total = 13;
  await expect(status(page)).toHaveText(`${total} Findings`);
  await expect(findingsTable(page, "Engineering baseline v1").locator("tbody tr")).toHaveCount(10);
  await expect(findingsTable(page, "Service readiness v1").locator("tbody tr")).toHaveCount(3);

  await applyFilter(page, "Outcome", "indeterminate");
  await expect(page).toHaveURL(/outcome=indeterminate/);
  const indeterminate = await findingRows(page).count();
  await expect(status(page)).toHaveText(`Showing ${indeterminate} of ${total} Findings`);
  for (const row of await findingRows(page).all()) await expect(row).toContainText("Indeterminate");

  await clearFilters(page, total);
  await applyFilter(page, "Severity", "critical");
  await expect(findingRows(page)).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 2, name: "Engineering baseline v1", exact: true })).toHaveCount(0);

  await clearFilters(page, total);
  await applyFilter(page, "Control", "verified-runtime");
  const billing = await page.getByLabel("Subject", { exact: true }).locator("option", { hasText: "billing" }).getAttribute("value");
  await applyFilter(page, "Subject", billing!);
  await expect(findingRows(page)).toHaveCount(1);
  await expect(findingRows(page)).toContainText("Verified on a current runtime");
  await expect(findingRows(page)).toContainText("billing");

  await clearFilters(page, total);
  await applyFilter(page, "Release", "1");
  await expect(findingRows(page)).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 2, name: "Service readiness v1", exact: true })).toBeVisible();
});

test("explains a Gap: expected state, observed facts, evidence, reasoning, and guidance that is not an action", async ({ page, db }) => {
  const { initiative, assessment } = await seedResults(db);
  const evaluation = await evaluate(db, initiative.publicId, assessment.publicId);
  await page.goto(`/evaluations/${evaluation.publicId}?control=services-configurable`);
  await findingsTable(page, "Service readiness v1").getByRole("row").filter({ hasText: "orders" }).getByRole("link", { name: "Service destinations are configurable or contracted" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Service destinations are configurable or contracted" })).toBeVisible();
  const result = page.getByRole("region", { name: "Result" });
  await expect(result).toContainText("The Control applies, and the evidence shows the expected condition does not hold.");
  await expect(result).toContainText("Gap");
  await expect(result.getByRole("link", { name: "orders Profile" })).toBeVisible();

  const expected = page.getByRole("region", { name: "Expected state" });
  await expect(expected).toContainText("Every item in Service Dependencies");
  await expect(expected).toContainText("Endpoint derivation");
  await expect(expected).toContainText("Migrations need to point services at test doubles without code changes.");

  const observed = page.getByRole("region", { name: "What was observed" });
  const condition = observed.getByRole("list", { name: "Condition trace" });
  await expect(condition).toContainText("https://payments.invalid");
  await expect(condition).toContainText("Observed: literal");
  await expect(condition.getByText("Does not hold").first()).toBeVisible();

  const guidance = page.getByRole("region", { name: "Diagnostic guidance" });
  await expect(guidance).toContainText("Read the base URL from configuration, or commit the service's OpenAPI document.");
  await expect(guidance).toContainText("This guidance is diagnostic.");
  await expect(guidance.getByRole("button")).toHaveCount(0);
  await expect(guidance.getByRole("link")).toHaveCount(0);
  await expect(guidance.getByRole("checkbox")).toHaveCount(0);

  await page.getByRole("region", { name: "Evidence" }).getByRole("link", { name: "src/payments.ts:2" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "src/payments.ts:2" })).toBeVisible();
  await expect(page.getByText("services.fetch").first()).toBeVisible();
});

test("lists every Indeterminate cause, including a missing Profile", async ({ page, db }) => {
  const { initiative, assessment } = await seedResults(db);
  const evaluation = await evaluate(db, initiative.publicId, assessment.publicId);
  const all = findingsOf(db, evaluation.id, { controlKey: "verified-runtime" }).map((finding) => ({ finding, document: findingDocument(finding) }));

  for (const { finding, document } of all) {
    const causes = document.causes as JsonObject[];
    expect(finding.outcome).toBe("indeterminate");
    await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);
    const list = page.getByRole("list", { name: "Indeterminate causes" });
    await expect(list.getByRole("listitem")).toHaveCount(causes.length);
    for (const cause of causes) await expect(list).toContainText(String(cause.reason));
  }
  const orders = all.find(({ document }) => (document.subject as JsonObject).name === "orders")!;
  expect((orders.document.causes as JsonObject[]).length).toBeGreaterThanOrEqual(2);
  const billing = all.find(({ document }) => (document.subject as JsonObject).name === "billing")!;
  expect(String((billing.document.causes as JsonObject[])[0]!.reason)).toContain("billing has no Profile");
  await page.goto(`/evaluations/${evaluation.publicId}/findings/${billing.finding.publicId}`);
  await expect(page.getByRole("region", { name: "Result" })).toContainText("billing (no Profile)");
});

test("Evaluation pages stay readable at mobile width", async ({ page, db }) => {
  const { initiative, assessment } = await seedResults(db);
  const evaluation = await evaluate(db, initiative.publicId, assessment.publicId);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/evaluations/${evaluation.publicId}`);
  await expect(page.getByRole("table", { name: "Summary by Release" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoOverlappingContent(page);

  const gap = findingsOf(db, evaluation.id, { controlKey: "services-configurable" })[0]!;
  await page.goto(`/evaluations/${evaluation.publicId}/findings/${gap.publicId}`);
  await expect(page.getByRole("region", { name: "What was observed" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoOverlappingContent(page);
});
