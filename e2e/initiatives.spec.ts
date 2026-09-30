import { listAssessments } from "../src/lib/assessments/assessment-records";
import { setSourceEnabled } from "../src/lib/catalog/source-records";
import { jobs } from "../src/lib/db/schema";
import { listInitiatives, selectedReleases, selectedSources } from "../src/lib/initiatives/initiative-records";
import { createStandard } from "../src/lib/standards/standard-records";
import { buildInitiative, buildRelease, buildSource } from "../test/support/builders";
import { errorSummary, expect, expectNoHorizontalOverflow, test } from "./support/fixtures";

test("creates an all-enabled initiative with two Releases, then narrows it to an explicit subset", async ({ page, db }) => {
  for (const name of ["orders", "billing", "accounts"]) buildSource(db, { name });
  const frontend = createStandard(db, { name: "Frontend baseline", purpose: "Consistent builds" }).standard;
  const security = createStandard(db, { name: "Security baseline", purpose: "Safe defaults" }).standard;
  buildRelease(db, { standard: frontend });
  buildRelease(db, { standard: security });

  await page.goto("/");
  await page.getByRole("link", { name: "New initiative" }).first().click();
  await page.getByLabel("Name").fill("Modernize the fleet");
  await page.getByLabel("Objective").fill("Find what blocks the framework upgrade");
  await expect(page.getByRole("group", { name: "Selected sources" })).toBeHidden();
  await page.getByLabel("Frontend baseline v1").check();
  await page.getByLabel("Security baseline v1").check();
  await page.getByRole("button", { name: "Create initiative" }).click();

  await expect(page.getByText("The initiative was created.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Scope" })).toContainText("All enabled sources (3 now)");
  await expect(page.getByRole("region", { name: "Standard Releases" })).toContainText("Frontend baseline v1");
  await expect(page.getByRole("region", { name: "Standard Releases" })).toContainText("Security baseline v1");
  const [initiative] = listInitiatives(db);
  expect(selectedReleases(db, initiative!.id)).toHaveLength(2);
  expect(selectedSources(db, initiative!.id)).toEqual([]);

  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Selected sources").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(errorSummary(page)).toContainText("Select at least one repository source");

  await page.getByRole("group", { name: "Selected sources" }).getByLabel("orders").check();
  await page.getByRole("group", { name: "Selected sources" }).getByLabel("accounts").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("The initiative was updated.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Scope" })).toContainText("2 selected sources");
  expect(selectedSources(db, initiative!.id).map((source) => source.name)).toEqual(["accounts", "orders"]);
});

test("refuses a draft Standard submitted as a Release selection", async ({ page, db }) => {
  const { standard } = createStandard(db, { name: "Unpublished", purpose: "Still a draft" });
  buildRelease(db);

  await page.goto("/initiatives/new");
  await page.getByLabel("Name").fill("Tampered");
  const release = page.getByRole("group", { name: "Standard Releases" }).getByRole("checkbox").first();
  await release.check();
  await release.evaluate((input, value) => ((input as HTMLInputElement).value = value), standard.publicId);
  await page.getByRole("button", { name: "Create initiative" }).click();

  await expect(errorSummary(page)).toContainText("Unpublished is a draft Standard; select one of its published Releases");
  expect(listInitiatives(db)).toEqual([]);
});

test("starts an assessment once and lists it in the initiative's history", async ({ page, db }) => {
  buildSource(db, { name: "orders", gitRef: "main" });
  buildSource(db, { name: "billing" });
  const initiative = buildInitiative(db, { name: "Assess me" });

  await page.goto(`/initiatives/${initiative.publicId}`);
  await expect(page.getByRole("region", { name: "Standard Releases" })).toContainText("None selected");
  await page.getByRole("button", { name: "Start assessment" }).dblclick();

  await expect(page.getByRole("heading", { name: /^Assessment asm_/ })).toBeVisible();
  const scope = page.getByRole("table", { name: "Assessment scope" });
  await expect(scope.getByRole("row").nth(1)).toContainText("billing");
  await expect(scope.getByRole("row").nth(2)).toContainText("orders");
  await expect(scope).toContainText("main");
  expect(listAssessments(db, initiative.id)).toHaveLength(1);
  expect(db.select().from(jobs).all().map((job) => job.kind)).toEqual(["assessment.coordinate"]);

  await page.getByRole("link", { name: "Assess me" }).click();
  const [assessment] = listAssessments(db, initiative.id);
  await expect(page.getByRole("table", { name: "Assessment history" })).toContainText(assessment!.publicId);
  await expect(page.getByRole("table", { name: "Assessment history" })).toContainText("2 sources");
});

test("explains each disabled source that blocks an assessment", async ({ page, db }) => {
  const [orders, billing] = [buildSource(db, { name: "orders" }), buildSource(db, { name: "billing" })];
  const initiative = buildInitiative(db, { sources: [orders, billing] });
  setSourceEnabled(db, orders.publicId, false);
  setSourceEnabled(db, billing.publicId, false);

  await page.goto(`/initiatives/${initiative.publicId}`);
  await page.getByRole("button", { name: "Start assessment" }).click();

  const problems = page.getByRole("alert").filter({ hasText: "scope could not be resolved" });
  await expect(problems.getByRole("listitem")).toHaveCount(2);
  await expect(problems).toContainText(`billing (${billing.publicId}) is disabled`);
  await expect(problems).toContainText(`orders (${orders.publicId}) is disabled`);
  expect(listAssessments(db, initiative.id)).toEqual([]);
});

test("initiative pages stay usable at mobile width", async ({ page, db }) => {
  buildSource(db, { name: "a-source-with-a-long-name-for-layout-testing" });
  buildRelease(db);
  const initiative = buildInitiative(db, { name: "An initiative with a long descriptive name for layout" });
  await page.setViewportSize({ width: 375, height: 812 });

  for (const path of ["/", `/initiatives/${initiative.publicId}`, "/initiatives/new"]) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
});
