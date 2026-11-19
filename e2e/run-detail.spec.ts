import type { Page } from "@playwright/test";
import { buildRun, buildAssessment, buildRepository } from "../test/support/builders";
import { manifest } from "../test/support/profiles";
import { seedRun } from "../test/support/scenarios";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { pageHeader } from "./support/shell";

const files = (name: string) => ({ "package.json": manifest({ name, version: "1.0.0" }) });

// The page header: status, meta, and actions; the title is in the shell header.
const scope = (page: Page) => page.getByRole("table", { name: "Run scope" });

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
    const orders = buildRepository(db, { name: "orders" });
    const billing = buildRepository(db, { name: "billing" });
    const assessment = buildAssessment(db, { name: "Fleet assessment", repositories: [orders, billing] });
    const repositories = [orders, billing];

    const complete = await seedRun(db, assessment, repositories, [files("orders"), files("billing")]);
    await page.goto(paths.run(complete.publicId));
    await expect(pageHeader(page)).toContainText("Complete");
    await expect(page.getByRole("heading", { level: 1, name: "Run #1" })).toBeVisible();
    await expect(page).toHaveTitle("Run #1 · Fleet assessment · Frontend Registry");
    // The status says it; no alert restates it.
    await expect(page.locator("#page-alerts")).toBeEmpty();
    await expect(scope(page).getByRole("row").filter({ hasText: "Complete" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "orders Profile" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Review the Relationship Map/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel Run" })).toHaveCount(0);
    await expectLaidOut(page);

    const partial = await seedRun(db, assessment, repositories, [files("orders"), "failed"]);
    await page.goto(paths.run(partial.publicId));
    await expect(pageHeader(page)).toContainText("Complete with issues");
    await expect(page.getByText("1 of 2 repositories could not be assessed")).toBeVisible();
    const failedRow = scope(page).getByRole("row").filter({ hasText: "billing" });
    await expect(failedRow).toContainText("source_unavailable");
    await expect(failedRow).toContainText("The repository could not be reached");
    await expect(page.getByLabel("Run results")).toContainText("Coverage gaps1");
    await expect(page.getByRole("link", { name: "orders Profile" })).toBeVisible();
    await expectLaidOut(page);

    const failed = await seedRun(db, assessment, repositories, ["failed", "failed"]);
    await page.goto(paths.run(failed.publicId));
    await expect(pageHeader(page)).toContainText("Failed");
    await expect(page.getByText("No repository could be assessed")).toBeVisible();
    await expect(scope(page).getByRole("row").filter({ hasText: "source_unavailable" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: /Profile$/ })).toHaveCount(0);
    await expectLaidOut(page);

    const canceled = await seedRun(db, assessment, repositories, [files("orders"), "canceled"], { cancel: true });
    await page.goto(paths.run(canceled.publicId));
    await expect(pageHeader(page)).toContainText("Canceled");
    await expect(page.getByText("1 completed Profile remains reviewable.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "orders Profile" })).toBeVisible();
    await expect(scope(page).getByRole("row").filter({ hasText: "billing" })).toContainText("Canceled");
    await expectLaidOut(page);

    // Every Assessment of the Initiative stays reachable from it.
    await page.goto(paths.assessment(assessment.publicId));
    for (const [index, run] of [complete, partial, failed, canceled].entries()) {
      await expect(page.getByRole("link", { name: `Run #${index + 1}` })).toHaveAttribute("href", paths.run(run.publicId));
    }
  });
}

test("records a cancellation request for an active Assessment and keeps its scope frozen", async ({ page, db }) => {
  const orders = buildRepository(db, { name: "orders" });
  const { run } = buildRun(db, { repositories: [orders] });

  await page.goto(paths.run(run.publicId));
  await expect(scope(page)).toContainText("orders");
  await expect(scope(page)).toContainText("https://git.example.com/acme/orders.git");
  await page.getByRole("button", { name: "Cancel Run" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel Run #1?" });
  await expect(dialog).toContainText("Completed Profiles are kept.");
  await dialog.getByRole("button", { name: "Cancel Run" }).click();

  // One message: the toast. The status shows Canceling, and no alert repeats the request.
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Cancellation was requested.")).toBeVisible();
  await expect(pageHeader(page)).toContainText("Canceling");
  await expect(page.locator("main").getByText(/[Cc]ancellation (was )?requested/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel Run" })).toHaveCount(0);
});
