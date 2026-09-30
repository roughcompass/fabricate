import type { Page } from "@playwright/test";
import { buildAssessment, buildInitiative, buildSource } from "../test/support/builders";
import { manifest } from "../test/support/profiles";
import { seedAssessment } from "../test/support/scenarios";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, test } from "./support/fixtures";

const files = (name: string) => ({ "package.json": manifest({ name, version: "1.0.0" }) });

const header = (page: Page) => page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
const scope = (page: Page) => page.getByRole("table", { name: "Assessment scope" });

async function expectLaidOut(page: Page) {
  await expectNoHorizontalOverflow(page);
  await expectNoOverlappingContent(page);
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
]) {
  test(`shows complete, partial, failed, and canceled Assessments at ${viewport.name} width without overlapping content`, async ({ page, db }) => {
    await page.setViewportSize(viewport);
    const orders = buildSource(db, { name: "orders" });
    const billing = buildSource(db, { name: "billing" });
    const initiative = buildInitiative(db, { name: "Fleet assessment", sources: [orders, billing] });
    const sources = [orders, billing];

    const complete = await seedAssessment(db, initiative, sources, [files("orders"), files("billing")]);
    await page.goto(`/assessments/${complete.publicId}`);
    await expect(header(page)).toContainText("Complete");
    await expect(page.getByText("Every scoped repository was assessed.")).toBeVisible();
    await expect(scope(page).getByRole("row").filter({ hasText: "Complete" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "View orders Profile" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review the Relationship Map" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel assessment" })).toHaveCount(0);
    await expectLaidOut(page);

    const partial = await seedAssessment(db, initiative, sources, [files("orders"), "failed"]);
    await page.goto(`/assessments/${partial.publicId}`);
    await expect(header(page)).toContainText("Complete with issues");
    await expect(page.getByText("1 of 2 repositories could not be assessed")).toBeVisible();
    const failedRow = scope(page).getByRole("row").filter({ hasText: "billing" });
    await expect(failedRow).toContainText("source_unavailable");
    await expect(failedRow).toContainText("The repository could not be reached");
    await expect(page.getByText("1 coverage gap")).toBeVisible();
    await expect(page.getByRole("link", { name: "View orders Profile" })).toBeVisible();
    await expectLaidOut(page);

    const failed = await seedAssessment(db, initiative, sources, ["failed", "failed"]);
    await page.goto(`/assessments/${failed.publicId}`);
    await expect(header(page)).toContainText("Failed");
    await expect(page.getByText("No repository could be assessed")).toBeVisible();
    await expect(scope(page).getByRole("row").filter({ hasText: "source_unavailable" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: /Profile$/ })).toHaveCount(0);
    await expectLaidOut(page);

    const canceled = await seedAssessment(db, initiative, sources, [files("orders"), "canceled"], { cancel: true });
    await page.goto(`/assessments/${canceled.publicId}`);
    await expect(header(page)).toContainText("Canceled");
    await expect(page.getByText("1 completed Profile remains reviewable.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "View orders Profile" })).toBeVisible();
    await expect(scope(page).getByRole("row").filter({ hasText: "billing" })).toContainText("Canceled");
    await expectLaidOut(page);

    // Every Assessment of the Initiative stays reachable from it.
    await page.goto(`/initiatives/${initiative.publicId}`);
    for (const assessment of [complete, partial, failed, canceled]) await expect(page.getByRole("link", { name: assessment.publicId })).toBeVisible();
  });
}

test("records a cancellation request for an active Assessment and keeps its scope frozen", async ({ page, db }) => {
  const orders = buildSource(db, { name: "orders" });
  const { assessment } = buildAssessment(db, { sources: [orders] });

  await page.goto(`/assessments/${assessment.publicId}`);
  await expect(scope(page)).toContainText("orders");
  await expect(scope(page)).toContainText("https://git.example.com/acme/orders.git");
  let confirmation = "";
  page.once("dialog", (dialog) => {
    confirmation = dialog.message();
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Cancel assessment" }).click();
  await expect(page.getByText("Cancellation was requested.", { exact: false })).toBeVisible();
  expect(confirmation).toContain("completed Profiles are kept");
  await expect(page.getByRole("button", { name: "Cancel assessment" })).toHaveCount(0);
  await expect(page.getByText("Cancellation requested. Unfinished repositories stop at their next check.")).toBeVisible();
});
