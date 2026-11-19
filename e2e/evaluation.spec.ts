import type { JsonObject } from "@repo-facts/contract";
import type { Page } from "@playwright/test";
import { findingDocument, findingsOf } from "../src/lib/evaluations/evaluation-records";
import { runById } from "../src/lib/runs/lookups";
import { buildAssessment, buildRepository } from "../test/support/builders";
import { manifest } from "../test/support/profiles";
import { publishStandard, seedRun } from "../test/support/scenarios";
import { targetsOf } from "../src/lib/runs/run-records";
import { selectReleases } from "../test/support/scenarios";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, test } from "./support/fixtures";
import { BASELINE_CONTROLS, evaluate, seedResults, seedEvaluation } from "./support/results";
import { pageHeader } from "./support/shell";

const releaseGroup = (page: Page, release: string) => page.getByRole("region", { name: release, exact: true });
// The page header: status, meta, and actions; the title is in the shell header.
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
  // Choosing a value applies it; there is no Apply button to press.
  await select.selectOption(value);
  await expect(page).toHaveURL(new RegExp(`[?&]${name}=${encodeURIComponent(value)}(&|$)`));
}

test("summarizes each Release separately and filters Findings by Release, outcome, severity, Control, and subject", async ({ page, db }) => {
  const { evaluation } = await seedEvaluation(db);
  await page.goto(`/evaluations/${evaluation.publicId}`);
  await expect(pageHeader(page)).toContainText("Complete");
  await expect(page.getByText("1 repository in the Run had no Profile")).toBeVisible();

  const summary = page.getByRole("table", { name: "Summary by Release" });
  await expect(summary.getByRole("row").filter({ hasText: "Engineering baseline v1" })).toContainText("Gaps found");
  await expect(summary.getByRole("row").filter({ hasText: "Service readiness v1" })).toContainText("Gaps found");
  await expect(page.getByRole("heading", { level: 3, name: "Engineering baseline v1", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Service readiness v1", exact: true })).toBeVisible();

  // 5 repository Controls x 2 repositories, then 1 repository Control x 2 and 1 map Control.
  const total = 13;
  await expect(status(page)).toHaveText(`${total} Findings`);
  await expect(releaseGroup(page, "Engineering baseline v1").locator("tbody tr")).toHaveCount(10);
  await expect(releaseGroup(page, "Service readiness v1").locator("tbody tr")).toHaveCount(3);

  await applyFilter(page, "Outcome", "indeterminate");
  await expect(page).toHaveURL(/outcome=indeterminate/);
  const indeterminate = await findingRows(page).count();
  await expect(status(page)).toHaveText(`Showing ${indeterminate} of ${total} Findings`);
  for (const row of await findingRows(page).all()) await expect(row).toContainText("Indeterminate");

  await clearFilters(page, total);
  await applyFilter(page, "Severity", "critical");
  await expect(findingRows(page)).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 3, name: "Engineering baseline v1", exact: true })).toHaveCount(0);

  await clearFilters(page, total);
  await applyFilter(page, "Control", "verified-runtime");
  const billing = await page.getByLabel("Subject", { exact: true }).locator("option", { hasText: "billing" }).getAttribute("value");
  await applyFilter(page, "Subject", billing!);
  await expect(findingRows(page)).toHaveCount(1);
  await expect(page.getByRole("table", { name: "Verified on a current runtime Findings" })).toBeVisible();
  await expect(findingRows(page)).toContainText("billing");

  await clearFilters(page, total);
  await applyFilter(page, "Release", "1");
  await expect(findingRows(page)).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 3, name: "Service readiness v1", exact: true })).toBeVisible();
});

test("groups Findings under their Control, and a Gap filter shows only Controls with Gaps", async ({ page, db }) => {
  const { evaluation } = await seedEvaluation(db);
  await page.goto(`/evaluations/${evaluation.publicId}`);

  // One row per Control summarizes its outcomes; expanding it lists the Finding for each repository.
  const baseline = releaseGroup(page, "Engineering baseline v1");
  const control = baseline.locator("details").filter({ hasText: "Declares no submodules" });
  await expect(control.locator("summary")).toContainText("no-submodules");
  await expect(control.getByRole("table")).toBeHidden();
  await control.locator("summary").click();
  await expect(control.getByRole("table").locator("tbody tr")).toHaveCount(2);

  await page.getByRole("form", { name: "Filter Findings" }).getByLabel("Outcome").selectOption("gap");
  await expect(page).toHaveURL(/outcome=gap/);
  const gaps = findingRows(page);
  const count = await gaps.count();
  await expect(status(page)).toHaveText(`Showing ${count} of 13 Findings`);
  for (const row of await gaps.all()) await expect(row).toContainText("Gap");
  // Filtered Controls are open, and each summary counts only its Gaps.
  for (const summary of await page.locator("details[open] > summary").all()) await expect(summary).toContainText("Gap");
  await expect(page.getByRole("region", { name: "Findings", exact: true }).locator("details:not([open])")).toHaveCount(0);
});

test("shows one Release's conclusion with the combined counts and no per-Release table", async ({ page, db }) => {
  const { assessment, run, baseline } = await seedResults(db);
  selectReleases(db, assessment, [baseline]);
  const evaluation = await evaluate(db, assessment.publicId, run.publicId);
  await page.goto(`/evaluations/${evaluation.publicId}`);

  const outcomes = page.getByLabel("Outcomes", { exact: true });
  await expect(outcomes).toContainText("Conclusion");
  await expect(outcomes).toContainText("Gaps found");
  await expect(page.getByRole("table", { name: "Summary by Release" })).toHaveCount(0);
});

test("explains a Gap: expected state, observed facts, evidence, reasoning, and guidance that is not an action", async ({ page, db }) => {
  const { assessment, evaluation } = await seedEvaluation(db);
  await page.goto(`/evaluations/${evaluation.publicId}?control=services-configurable`);
  await page.getByRole("table", { name: "Service destinations are configurable or contracted Findings" }).getByRole("link", { name: "orders" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Service destinations are configurable or contracted" })).toBeVisible();
  // The outcome appears once, in the header.
  await expect(pageHeader(page)).toContainText("Gap");
  await expect(page.locator("main").getByText("Gap", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link")).toHaveText(["Assessments", assessment.name, "Run #1", "Evaluation #1"]);
  const result = page.getByRole("region", { name: "Result" });
  await expect(result).toContainText("The Control applies, and the evidence shows the expected condition does not hold.");
  // A Control that reads only Service Dependencies links to the top of the Profile.
  await expect(result.getByRole("link", { name: "orders Profile" })).toBeVisible();
  await expect(result.getByRole("link", { name: "orders Profile" })).not.toHaveAttribute("href", /#/);

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
  await expect(guidance).toContainText("This guidance is diagnostic");
  await expect(guidance.getByRole("button")).toHaveCount(0);
  await expect(guidance.getByRole("link")).toHaveCount(0);
  await expect(guidance.getByRole("checkbox")).toHaveCount(0);

  await page.getByRole("region", { name: "Evidence" }).getByRole("link", { name: "src/payments.ts:2" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "src/payments.ts:2" })).toBeVisible();
  await expect(page.getByText("services.fetch").first()).toBeVisible();
});

// page-patterns spec, "Breadcrumbs on Evidence": evidence reached from a Run's results leads back through the Run.
test("Breadcrumbs on Evidence: Assessments / the Assessment / Run #1 / orders, with no other back link", async ({ page, db }) => {
  const { evaluation, assessment } = await seedEvaluation(db);
  const run = runById(db, evaluation.runId);
  const finding = findingsOf(db, evaluation.id, { controlKey: "services-configurable" }).find((candidate) => (findingDocument(candidate).subject as JsonObject).name === "orders")!;
  await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);
  await page.getByRole("region", { name: "Evidence" }).getByRole("link", { name: "src/payments.ts:2" }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${run.publicId}/evidence/`));

  const breadcrumbs = pageHeader(page).getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumbs.getByRole("link")).toHaveText(["Assessments", "Fleet assessment", "Run #1", "orders"]);
  const hrefs = await breadcrumbs.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs.slice(0, 3)).toEqual(["/assessments", `/assessments/${assessment.publicId}`, `/runs/${run.publicId}`]);
  // The repository's crumb opens its Profile at the category that cites the evidence.
  expect(hrefs[3]).toMatch(/^\/profiles\/prf_\w+\?tab=services#/);
  // The breadcrumbs are the only way back: the page itself links nowhere else.
  await expect(page.getByRole("main").getByRole("link")).toHaveCount(4);
});

test("lists every Indeterminate cause, including a missing Profile", async ({ page, db }) => {
  const { evaluation } = await seedEvaluation(db);
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
  await expect(page.getByRole("region", { name: "Result" })).toContainText("None; billing had no Profile in this Run");
});

test("opens the Profile at the category a Finding's Control reads", async ({ page, db }) => {
  const { evaluation } = await seedEvaluation(db);
  const finding = findingsOf(db, evaluation.id, { controlKey: "has-ci" }).find((candidate) => (findingDocument(candidate).subject as JsonObject).name === "orders")!;
  await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);

  await page.getByRole("region", { name: "Result" }).getByRole("link", { name: "CI systems in the orders Profile" }).click();
  // The link names the view that holds CI systems, so the Profile opens there.
  await expect(page).toHaveURL(/\/profiles\/prf_\w+\?tab=tooling#ci_systems$/);
  await expect(page.locator("#ci_systems")).toBeInViewport();
  await expect(page.getByRole("navigation", { name: "Tooling sections" }).getByRole("link", { name: /^CI systems/ })).toHaveAttribute("aria-current", "location");
});

test("Evaluation pages stay readable at mobile width", async ({ page, db }) => {
  const { evaluation } = await seedEvaluation(db);
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

// page-patterns spec, content standard "Two layers" and "Outcomes and conclusions".
test("Two layers on a Finding: it leads with the outcome and the observed value in words, and the field path waits in a disclosure", async ({ page, db }) => {
  const { evaluation } = await seedEvaluation(db);
  const finding = findingsOf(db, evaluation.id, { controlKey: "has-ci" })[0]!;
  await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);
  await expect(pageHeader(page).locator("[data-header-status]")).toBeVisible();
  await expect(page.getByLabel("Condition trace")).toContainText("Observed:");
  const path = page.getByText("repository.ci_systems", { exact: true });
  await expect(path).toBeHidden();
  await expect(page.getByText("has-ci", { exact: true })).toBeHidden();
  await page.getByText("Field paths and Control key").click();
  await expect(path.first()).toBeVisible();
  await expect(page.getByText("has-ci", { exact: true })).toBeVisible();
});

test("Conclusion and outcomes on an Evaluation: the conclusion is labeled Conclusion, and the Findings' filter Outcome", async ({ page, db }) => {
  const { evaluation } = await seedEvaluation(db);
  await page.goto(`/evaluations/${evaluation.publicId}`);
  // Against two Releases, each Release's conclusion is in its own row, under the column Conclusion.
  const summary = page.getByRole("table", { name: "Summary by Release" });
  await expect(summary.getByRole("columnheader", { name: "Conclusion" })).toBeVisible();
  await expect(summary.getByRole("cell").filter({ hasText: "Gaps found" }).first()).toBeVisible();
  const outcome = page.getByRole("form", { name: "Filter Findings" }).getByLabel("Outcome", { exact: true });
  const options = await outcome.locator("option").allTextContents();
  for (const label of ["Meets", "Gap", "Indeterminate"]) expect(options).toContain(label);
});

// page-patterns spec, "Record mentions".
test("Record mentions: the Run's repositories and a Finding's subject link to their Repository pages", async ({ page, db }) => {
  const { evaluation } = await seedEvaluation(db);
  const finding = findingsOf(db, evaluation.id, { controlKey: "has-ci" }).find((candidate) => (findingDocument(candidate).subject as JsonObject).name === "orders")!;
  const run = runById(db, evaluation.runId);
  await page.goto(`/runs/${run.publicId}`);
  const scope = page.getByRole("table", { name: "Run scope" });
  for (const target of targetsOf(db, run.id)) await expect(scope.getByRole("link", { name: target.repositoryName, exact: true })).toHaveAttribute("href", `/repositories/${target.repositoryPublicId}`);

  await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);
  const orders = targetsOf(db, run.id).find((target) => target.repositoryName === "orders")!;
  await expect(page.getByRole("region", { name: "Result" }).getByRole("link", { name: "orders", exact: true })).toHaveAttribute("href", `/repositories/${orders.repositoryPublicId}`);
  await pageHeader(page).getByRole("link", { name: "orders", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "orders" })).toBeVisible();
});


// page-patterns spec, "Long lists are paged": each Control pages its own Findings, with its page in the address.
test("pages a Control's Findings fifty at a time, keeps the page in the address, and a filter returns to the first page", async ({ page, db }) => {
  const repositories = Array.from({ length: 51 }, (_, index) => buildRepository(db, { name: `app-${String(index).padStart(2, "0")}` }));
  const assessment = buildAssessment(db, { name: "Fleet-wide baseline", repositories });
  const run = await seedRun(db, assessment, repositories, repositories.map((repository) => ({ "package.json": manifest({ name: repository.name, version: "1.0.0" }) })));
  const release = publishStandard(db, "Engineering baseline", BASELINE_CONTROLS.filter((candidate) => candidate.key === "has-ci"));
  selectReleases(db, assessment, [release]);
  const evaluation = await evaluate(db, assessment.publicId, run.publicId);

  await page.goto(`/evaluations/${evaluation.publicId}`);
  const control = page.locator("#control-0-has-ci");
  await control.locator("summary").click();
  const rows = page.getByRole("table", { name: "Runs continuous integration Findings" }).locator("tbody tr");
  await expect(rows).toHaveCount(50);
  const pages = page.getByRole("navigation", { name: "Runs continuous integration Findings pages" });
  await expect(pages).toContainText("Page 1 of 2");

  await pages.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/[?&]page_0_has-ci=2#control-0-has-ci$/);
  // The address opens the Control at its page.
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("app-50");
  await page.reload();
  await expect(rows).toHaveCount(1);

  // Changing a filter returns to the first page.
  await page.getByRole("form", { name: "Filter Findings" }).getByLabel("Outcome", { exact: true }).selectOption("gap");
  await expect(page).toHaveURL(/[?&]outcome=gap(&|$)/);
  expect(page.url()).not.toContain("page_0_has-ci");
  await expect(rows).toHaveCount(50);
  await expect(pages).toContainText("Page 1 of 2");
});
