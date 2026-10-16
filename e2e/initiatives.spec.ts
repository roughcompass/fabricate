import type { Page } from "@playwright/test";
import { listAssessments } from "../src/lib/assessments/assessment-records";
import { setSourceEnabled } from "../src/lib/catalog/source-records";
import { jobs } from "../src/lib/db/schema";
import { claimInitiative, deWebInitiative, listInitiatives, saltPatternsInitiative, selectedReleases, selectedSources } from "../src/lib/initiatives/initiative-records";
import { createStandard } from "../src/lib/standards/standard-records";
import { buildAssessment, buildInitiative, buildRelease, buildSource } from "../test/support/builders";
import { buildEvaluation, driveEvaluation, driveRun } from "../test/support/home";
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

// page-patterns spec: the Assessments list filters what Home counts.
test("DE Web: DE FabLab owns it, outside the main table and its tab counts", async ({ page, db }) => {
  buildInitiative(db, { name: "Orders review" });
  buildAssessment(db, { initiative: deWebInitiative(db), sources: [buildSource(db, { name: "payee-hub" })] });

  await page.goto(paths.assessments);
  const main = page.getByRole("table", { name: "Assessments", exact: true });
  await expect(main).toContainText("Orders review");
  await expect(main).not.toContainText("DE Web");
  await expect(page.getByRole("navigation", { name: "Filter Assessments" }).getByRole("link", { name: /^All/ })).toHaveText(/^All\s*1$/);
  const owned = page.getByRole("table", { name: "Assessments owned by DE FabLab" });
  await expect(owned.getByRole("row", { name: /DE Web/ })).toContainText("Each Application's repository");
});

test("Salt Patterns: DE FabLab owns it, and only its Releases can be selected (Releases selected)", async ({ page, db }) => {
  const exemplary = createStandard(db, { name: "Salt exemplary", purpose: "Exemplary Salt usage" }).standard;
  buildRelease(db, { standard: exemplary });
  buildSource(db, { name: "orders" });

  await page.goto(paths.assessments);
  const owned = page.getByRole("region", { name: "Owned by DE FabLab" });
  await expect(owned).toContainText("None selected");
  await owned.getByRole("link", { name: "Salt Patterns" }).click();

  await expect(page).toHaveTitle("Salt Patterns · DE FabLab");
  await expect(page.getByText("Owned by DE FabLab")).toBeVisible();
  await expect(overview(page)).toContainText("Template versions, added when one is accepted or re-checked");
  await expect(page.getByRole("button", { name: "Start Run" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Select Releases" }).click();
  await expect(page.getByRole("heading", { name: "Select Releases" })).toBeVisible();
  // No name, objective, or target to edit, and nothing to delete.
  await expect(page.getByLabel("Name")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Repository scope" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Selected Repositories" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Assessment" })).toHaveCount(0);
  await page.getByLabel("Salt exemplary v1").check();
  await page.getByRole("button", { name: "Save Releases" }).click();

  await expect(toast(page, "Salt Patterns was updated.")).toBeVisible();
  await expect(overview(page)).toContainText("Salt exemplary v1");
  const salt = saltPatternsInitiative(db);
  expect(selectedReleases(db, salt.id).map(({ standard }) => standard.name)).toEqual(["Salt exemplary"]);
  expect(selectedSources(db, salt.id)).toEqual([]);
  expect(salt).toMatchObject({ name: "Salt Patterns", selectionMode: "explicit" });

  await page.goto(paths.assessments);
  await expect(page.getByRole("region", { name: "Owned by DE FabLab" })).toContainText("Salt exemplary v1");
});

test.describe("conclusion tabs", () => {
  const rows = (page: Page) => page.getByRole("table", { name: "Assessments", exact: true }).locator("tbody tr");

  test("Gaps found tab lists only Assessments whose latest completed Evaluation found Gaps, and hides those created for claims", async ({ page, db }) => {
    const source = buildSource(db, { name: "orders" });
    const evaluated = (name: string, conclusion: "gaps" | "conforms") => {
      const initiative = buildInitiative(db, { name, sources: [source] });
      return driveEvaluation(db, buildEvaluation(db, initiative, driveRun(db, buildAssessment(db, { initiative }).assessment, "complete")), "complete", conclusion);
    };
    const gaps = evaluated("Checkout platform migration", "gaps");
    evaluated("Payments baseline", "conforms");
    claimInitiative(db, source);

    await page.goto(paths.assessments);
    await expect(page.getByText("Created for claims")).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Filter Assessments" });
    await expect(tabs.getByRole("link")).toHaveText([/^All\s*2$/, /^Gaps found\s*1$/, /^Undetermined\s*0$/, /^Conforms\s*1$/, /^Not evaluated\s*0$/]);
    await tabs.getByRole("link", { name: /Gaps found/ }).click();
    await expect(page).toHaveURL(/conclusion=gaps/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Checkout platform migration");
    await expect(rows(page).first().getByRole("link", { name: "Evaluation #1" })).toHaveAttribute("href", `/evaluations/${gaps.publicId}`);
    await expect(rows(page).first()).toContainText("Gaps found");
    await expect(page.getByText("Created for claims")).toHaveCount(0);
  });

  test("Not evaluated tab lists an Assessment with Runs but no completed Evaluation", async ({ page, db }) => {
    const initiative = buildInitiative(db, { name: "Checkout platform migration", sources: [buildSource(db)] });
    driveRun(db, buildAssessment(db, { initiative }).assessment, "complete");

    await page.goto(`${paths.assessments}?conclusion=none`);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator("td").last()).toHaveText("Not evaluated");

    await page.goto(`${paths.assessments}?conclusion=gaps`);
    await expect(page.getByText("No matching Assessments")).toBeVisible();
  });
});
