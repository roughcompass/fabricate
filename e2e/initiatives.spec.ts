import type { Page } from "@playwright/test";
import { listAssessments } from "../src/lib/assessments/assessment-records";
import { setSourceEnabled } from "../src/lib/catalog/source-records";
import { jobs } from "../src/lib/db/schema";
import { listInitiatives, selectedReleases, selectedSources } from "../src/lib/initiatives/initiative-records";
import { createStandard } from "../src/lib/standards/standard-records";
import { buildInitiative, buildRelease, buildSource } from "../test/support/builders";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { paths } from "./support/paths";

const toast = (page: Page, text: string) => page.getByRole("region", { name: "Notifications" }).getByText(text);
const overview = (page: Page) => page.getByRole("region", { name: "Overview" });

test("creates an all-enabled Initiative with two Releases, then narrows it to an explicit subset", async ({ page, db }) => {
  for (const name of ["orders", "billing", "accounts"]) buildSource(db, { name });
  const frontend = createStandard(db, { name: "Frontend baseline", purpose: "Consistent builds" }).standard;
  const security = createStandard(db, { name: "Security baseline", purpose: "Safe defaults" }).standard;
  buildRelease(db, { standard: frontend });
  buildRelease(db, { standard: security });

  await page.goto(paths.assessments);
  await page.getByRole("link", { name: "New Assessment" }).first().click();
  await page.getByLabel("Name").fill("Modernize the fleet");
  await page.getByLabel("Objective").fill("Find what blocks the framework upgrade");
  await expect(page.getByRole("group", { name: "Selected Repositories" })).toBeHidden();
  await page.getByLabel("Frontend baseline v1").check();
  await page.getByLabel("Security baseline v1").check();
  await page.getByRole("button", { name: "Create Assessment" }).click();

  await expect(toast(page, "Modernize the fleet was created.")).toBeVisible();
  await expect(page).toHaveTitle("Modernize the fleet · DE FabLab");
  await expect(overview(page)).toContainText("All enabled Repositories (3 now)");
  await expect(overview(page)).toContainText("Frontend baseline v1");
  await expect(overview(page)).toContainText("Security baseline v1");
  const [initiative] = listInitiatives(db);
  expect(selectedReleases(db, initiative!.id)).toHaveLength(2);
  expect(selectedSources(db, initiative!.id)).toEqual([]);

  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByRole("radio", { name: /Selected Repositories/ }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  // The error appears once, under its field, and the field takes focus.
  await expect(page.getByText("Select at least one repository source")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Selected Repositories" }).getByRole("checkbox").first()).toBeFocused();

  await page.getByRole("group", { name: "Selected Repositories" }).getByLabel("orders").check();
  await page.getByRole("group", { name: "Selected Repositories" }).getByLabel("accounts").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page, "Modernize the fleet was updated.")).toBeVisible();
  await expect(overview(page)).toContainText("2 selected Repositories");
  expect(selectedSources(db, initiative!.id).map((source) => source.name)).toEqual(["accounts", "orders"]);
});

test("shows a rejected field once and focuses it", async ({ page, db: _db }) => {
  await page.goto(paths.newAssessment);
  await page.getByRole("button", { name: "Create Assessment" }).click();
  const name = page.getByLabel("Name");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  const message = await page.locator("#initiative-name-error").textContent();
  await expect(page.getByText(message!)).toHaveCount(1);
});

test("offers the Release field, marked optional, even when nothing is published", async ({ page, db: _db }) => {
  await page.goto(paths.newAssessment);
  const releases = page.getByRole("group", { name: "Standard Releases (optional)" });
  await expect(releases).toContainText("No Release is published yet.");
  await expect(releases.getByRole("link", { name: "Standard Library" })).toHaveAttribute("href", "/standards");
  await expect(releases.getByRole("checkbox")).toHaveCount(0);
});

test("refuses a draft Standard submitted as a Release selection", async ({ page, db }) => {
  const { standard } = createStandard(db, { name: "Unpublished", purpose: "Still a draft" });
  buildRelease(db);

  await page.goto(paths.newAssessment);
  await page.getByLabel("Name").fill("Tampered");
  const release = page.getByRole("group", { name: "Standard Releases" }).getByRole("checkbox").first();
  await release.check();
  await release.evaluate((input, value) => ((input as HTMLInputElement).value = value), standard.publicId);
  await page.getByRole("button", { name: "Create Assessment" }).click();

  await expect(page.getByRole("group", { name: "Standard Releases" })).toContainText("Unpublished is a draft Standard; select one of its published Releases");
  expect(listInitiatives(db)).toEqual([]);
});

test("starts an Assessment once and lists it in the Initiative's history", async ({ page, db }) => {
  buildSource(db, { name: "orders", gitRef: "main" });
  buildSource(db, { name: "billing" });
  const initiative = buildInitiative(db, { name: "Assess me" });

  await page.goto(paths.assessment(initiative.publicId));
  await expect(overview(page)).toContainText("None selected");
  await page.getByRole("button", { name: "Start Run" }).dblclick();

  await expect(page.getByRole("heading", { level: 1, name: "Run #1" })).toBeVisible();
  await expect(page.getByText("billing").first()).toBeVisible();
  expect(listAssessments(db, initiative.id)).toHaveLength(1);
  expect(db.select().from(jobs).all().map((job) => job.kind)).toEqual(["assessment.coordinate"]);

  await page.goto(paths.assessment(initiative.publicId));
  const history = page.getByRole("table", { name: "Run history" });
  await expect(history.getByRole("link", { name: "Run #1" })).toBeVisible();
  await expect(history).toContainText("2 Repositories");
});

test("explains each disabled Source that blocks an Assessment, below the header", async ({ page, db }) => {
  const [orders, billing] = [buildSource(db, { name: "orders" }), buildSource(db, { name: "billing" })];
  const initiative = buildInitiative(db, { sources: [orders, billing] });
  setSourceEnabled(db, orders.publicId, false);
  setSourceEnabled(db, billing.publicId, false);

  await page.goto(paths.assessment(initiative.publicId));
  await page.getByRole("button", { name: "Start Run" }).click();

  const problems = page.locator("#page-alerts").getByRole("alert");
  await expect(problems).toContainText("scope could not be resolved");
  await expect(problems.getByRole("listitem")).toHaveCount(2);
  await expect(problems).toContainText(`billing (${billing.publicId}) is disabled`);
  await expect(problems).toContainText(`orders (${orders.publicId}) is disabled`);
  await expect(page.locator("header").getByRole("alert")).toHaveCount(0);
  expect(listAssessments(db, initiative.id)).toEqual([]);
});

test("deletes an Initiative without Assessments through a confirmation dialog", async ({ page, db }) => {
  const initiative = buildInitiative(db, { name: "Short-lived" });
  await page.goto(paths.assessmentEdit(initiative.publicId));

  const danger = page.getByRole("region", { name: "Delete Assessment" });
  await danger.getByRole("button", { name: "Delete Assessment" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Short-lived?" });
  await expect(dialog).toContainText("This cannot be undone.");
  await dialog.getByRole("button", { name: "Delete Assessment" }).click();

  await expect(page).toHaveURL(/\/assessments$/);
  await expect(toast(page, "The Assessment was deleted.")).toBeVisible();
  expect(listInitiatives(db)).toEqual([]);
});

test("Link to a field: Select a Release opens the edit form at its Standard Releases field", async ({ page, db }) => {
  const initiative = buildInitiative(db, { name: "No Releases yet" });
  await page.goto(paths.assessment(initiative.publicId));
  await page.getByRole("link", { name: "Select a Release" }).click();
  await expect(page).toHaveURL(new RegExp(`${paths.assessmentEdit(initiative.publicId)}#initiative-releases$`));
  await expect(page.getByRole("group", { name: /Standard Releases/ })).toBeInViewport();
});

test("Initiative pages stay usable at mobile width", async ({ page, db }) => {
  buildSource(db, { name: "a-source-with-a-long-name-for-layout-testing" });
  buildRelease(db);
  const initiative = buildInitiative(db, { name: "An initiative with a long descriptive name for layout" });
  await page.setViewportSize({ width: 375, height: 812 });

  for (const path of [paths.assessments, paths.assessment(initiative.publicId), paths.newAssessment, paths.assessmentEdit(initiative.publicId)]) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
  await page.goto(paths.assessment(initiative.publicId));
  await expect(page.getByRole("button", { name: "Start Run" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toBeHidden();
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.locator("[popover]:popover-open").getByRole("link", { name: "Edit" })).toBeVisible();
});
