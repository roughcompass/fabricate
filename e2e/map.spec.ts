import type { Page } from "@playwright/test";
import { buildInitiative, buildSource } from "../test/support/builders";
import { seedMapWorld } from "../test/support/map-world";
import { manifest } from "../test/support/profiles";
import { seedAssessment, seedMapStates } from "../test/support/scenarios";
import type { Db } from "../src/lib/db/client";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { pageHeader } from "./support/shell";

/** One repository with 64 third-party dependencies: more relationships than one page holds. */
async function seedWide(db: Db) {
  const source = buildSource(db, { name: "wide-app" });
  const dependencies = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`lib-${String(index).padStart(2, "0")}`, "^1.0.0"]));
  return seedAssessment(db, buildInitiative(db, { sources: [source] }), [source], [{ "package.json": manifest({ name: "wide-app", version: "1.0.0", dependencies }) }]);
}

/** The node ID of the repository named +label+, which is also the ID of the runtime system it names. */
const nodeOf = (db: Db, label: string) => (db.$client.prepare("select node_id from graph_nodes where kind = 'repository' and label = ?").get(label) as { node_id: string }).node_id;
const systemPath = (db: Db, assessmentId: string, label: string) => `${paths.runMap(assessmentId)}/systems/${nodeOf(db, label)}`;

const table = (page: Page, name: string) => page.getByRole("table", { name, exact: true });
const relationships = (page: Page) => table(page, "Relationships");
const relationshipRow = (page: Page, text: string) => relationships(page).getByRole("row").filter({ hasText: text });
const groupRow = (page: Page, name: string, text: string) => table(page, name).getByRole("row").filter({ hasText: text });
const breadcrumbs = (page: Page) => pageHeader(page).getByRole("navigation", { name: "Breadcrumb" });
const focus = (page: Page) => page.getByRole("complementary", { name: /^Focus: / });

test("opens on the Run's runtime systems, and descends to one whose address can be shared (Opening the map, Shared level address)", async ({ page, db }) => {
  const world = await seedMapWorld(db);
  await page.goto(paths.run(world.assessment.publicId));
  await page.getByRole("link", { name: /Review the Relationship Map/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Relationship Map" })).toBeVisible();
  await expect(table(page, "Runtime system").locator("tbody tr")).toHaveCount(5);
  await expect(groupRow(page, "Runtime system", "access-shell")).toContainText("5");
  await expect(groupRow(page, "Runtime system", "orphan-shell")).toContainText("2");
  await expect(groupRow(page, "Between groups", "access-shell")).toContainText("design-tokens");
  await expect(page.locator('dl[aria-label="This Run"]')).toContainText(/Runtime systems\s*2/);

  await table(page, "Runtime system").getByRole("link", { name: "access-shell" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "access-shell" })).toBeVisible();
  await expect(breadcrumbs(page).getByRole("link")).toHaveText(["Assessments", "Fleet assessment", "Run #1", "Relationship Map"]);

  const address = page.url();
  await page.goto(address);
  await expect(page.getByRole("heading", { level: 1, name: "access-shell" })).toBeVisible();
  await breadcrumbs(page).getByRole("link", { name: "Relationship Map" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Relationship Map" })).toBeVisible();
});

test("opens a former Nodes or filter address at the Run level, and a removed level as not found (Map tabs)", async ({ page, db }) => {
  const world = await seedMapWorld(db);
  await page.goto(`${paths.runMap(world.assessment.publicId)}?view=nodes&direction=incoming&type=composition&state=ambiguous`);

  await expect(page.getByRole("heading", { level: 1, name: "Relationship Map" })).toBeVisible();
  await expect(table(page, "Runtime system")).toBeVisible();
  await expect(table(page, "Nodes")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Relationship Map views" })).toHaveCount(0);

  for (const removed of ["unassigned", "portal/ptl_aaaaaaaaaaaaaaaa", "applications/wap_aaaaaaaaaaaaaaaa", "lob/lob_aaaaaaaaaaaaaaaa", "systems/missing"]) {
    const response = await page.goto(`${paths.runMap(world.assessment.publicId)}/${removed}`);
    expect(response?.status(), removed).toBe(404);
  }
});

test("draws a runtime system's host above what it loads, with one arrow for two signals and the third-party packages left out (Host above the repositories it loads, Two rules, one arrow, Third-party packages omitted)", async ({ page, db }) => {
  const world = await seedMapWorld(db);
  await page.goto(systemPath(db, world.assessment.publicId, "access-shell"));

  const diagram = page.locator('svg[data-diagram="system-diagram"]');
  await expect(diagram).toHaveAttribute("role", "img");
  await expect(diagram).toHaveAttribute("aria-describedby", "system-diagram-description");
  const host = await diagram.locator('[data-box="access-shell"]').boundingBox();
  for (const loaded of ["fx-board", "rates", "payee-hub", "legacy-tool"]) expect((await diagram.locator(`[data-box="${loaded}"]`).boundingBox())!.y).toBeGreaterThan(host!.y + host!.height);
  await expect(diagram.locator('[data-arrow="access-shell→fx-board"]')).toHaveCount(1);
  await expect(diagram.locator('[data-arrow="access-shell→fx-board"] title')).toHaveText(/composition, 2 signals/);
  await expect(page.getByText("Leaves out 2 third-party packages")).toBeVisible();
  await expect(diagram.locator('[data-box="react"]')).toHaveCount(0);
});

test("lists the library a runtime system's repositories share (Shared library in a runtime system)", async ({ page, db }) => {
  const world = await seedMapWorld(db);
  await page.goto(systemPath(db, world.assessment.publicId, "access-shell"));

  await expect(groupRow(page, "Shared libraries and services", "design-tokens")).toContainText("3");
});

test("leads a focus with what a change affects, keeps it in the address, and opens each relationship's evidence (Leading count, Shared focus address, Evidence one step away)", async ({ page, db }) => {
  const world = await seedMapWorld(db);
  await page.goto(paths.runMap(world.assessment.publicId));
  await table(page, "Shared libraries and services").getByRole("link", { name: "design-tokens" }).click();

  await expect(page).toHaveURL(/focus=node_/);
  await expect(focus(page).locator("[data-focus-sentence]")).toHaveText("Changing design-tokens directly affects 3 repositories in 1 runtime system; 1 more depends on it through them.");
  const affected = focus(page).getByRole("region", { name: "Affected if it changes" });
  await expect(affected.getByRole("heading", { level: 4 })).toHaveText(["access-shell"]);

  await page.reload();
  await expect(focus(page).locator("[data-focus-sentence]")).toContainText("Changing design-tokens");

  const row = affected.locator("details").filter({ hasText: "fx-board" });
  await row.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(row.getByText("package.exact-name")).toBeVisible();
  await expect(row.getByRole("link", { name: /^package\.json / }).first()).toBeVisible();
});

test("lists a runtime contract among both a repository's dependents and its dependencies (Runtime contract both ways)", async ({ page, db }) => {
  const world = await seedMapWorld(db, { runtimeContract: true });
  await page.goto(paths.runMap(world.assessment.publicId));
  await page.getByRole("search", { name: "Search the map" }).getByLabel("Search the map").fill("payee-hub");
  await page.keyboard.press("Enter");

  await expect(focus(page)).toBeVisible();
  await expect(focus(page).getByRole("region", { name: "Affected if it changes" }).getByRole("link", { name: "access-shell" })).toBeVisible();
  await expect(focus(page).getByRole("region", { name: "Depends on" }).getByRole("link", { name: "access-shell" })).toBeVisible();
});

test("focuses a package by search: a third-party package with its declared ranges, and a package built in the Run (Searching for a package, Third-party package, Package built in the Run)", async ({ page, db }) => {
  const world = await seedMapWorld(db);
  await page.goto(paths.runMap(world.assessment.publicId));
  const search = page.getByRole("search", { name: "Search the map" }).getByLabel("Search the map");
  await search.fill("react");
  await page.keyboard.press("Enter");

  await expect(focus(page).locator("[data-focus-sentence]")).toHaveText("react is third-party: no repository in this Run produces it. 6 repositories declare it in 3 runtime systems.");
  await expect(focus(page).getByRole("region", { name: "Declared by" }).getByRole("listitem").filter({ hasText: "fx-board" })).toContainText("^18.3.1");

  await page.getByRole("search", { name: "Search the map" }).getByLabel("Search the map").fill("@acme/design-tokens");
  await page.keyboard.press("Enter");
  await expect(focus(page)).toContainText("Built by design-tokens");
  await focus(page).getByRole("link", { name: "design-tokens" }).click();
  await expect(focus(page).locator("[data-focus-sentence]")).toContainText("Changing design-tokens");
});

test("pages the relationships of a runtime system, and of a focus (Paged relationships, Long relationship list)", async ({ page, db }) => {
  const assessment = await seedWide(db);
  await page.goto(systemPath(db, assessment.publicId, "wide-app"));
  const status = page.getByRole("status").filter({ hasText: "relationships" });

  await expect(status).toHaveText(/^1–50 of 6\d relationships$/);
  await expect(relationships(page).locator("tbody tr")).toHaveCount(50);
  await page.getByRole("navigation", { name: "Relationships pages" }).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(status).toHaveText(/^51–6\d of 6\d relationships$/);

  await relationships(page).getByRole("link", { name: "wide-app" }).first().click();
  await expect(page).toHaveURL(/focus=node_/);
  await expect(status).toHaveText(/^1–50 of 6\d relationships$/);
  await page.getByRole("navigation", { name: "Relationships pages" }).getByRole("link", { name: "Page 2" }).click();
  await expect(page).toHaveURL(/focus=node_.*page=2|page=2.*focus=node_/);
  await expect(focus(page)).toBeVisible();
});

test("reviews every resolution state and the coverage gap", async ({ page, db }) => {
  const { assessment } = await seedMapStates(db);
  await page.goto(paths.runMap(assessment.publicId));
  const coverage = page.locator("#page-alerts");
  await expect(coverage).toContainText("1 repository did not contribute");
  await expect(coverage.getByRole("listitem").filter({ hasText: "billing" })).toContainText("Failed");
  await expect(coverage.getByRole("listitem").filter({ hasText: "billing" })).toContainText("source_unavailable");

  const resolved = relationshipRow(page, "depends on").filter({ has: page.getByRole("link", { name: "client", exact: true }) });
  await expect(resolved).toContainText("Package dependency, observed in source");
  await expect(resolved.getByText("Resolved")).toBeVisible();
  await expect(relationshipRow(page, "produces").filter({ hasText: "@acme/client" })).toContainText("Resolved");

  const ambiguous = relationshipRow(page, "@acme/ui").filter({ hasText: "Ambiguous" });
  await expect(ambiguous.getByRole("list", { name: "Candidates" }).getByRole("listitem")).toHaveText(["ui-a", "ui-b"]);
  await expect(ambiguous).toContainText("2 repositories in this Run declare a package named @acme/ui");

  await expect(relationshipRow(page, "left-pad")).toContainText("Unresolved");
  await expect(relationshipRow(page, "left-pad")).toContainText("No repository in this Run produces left-pad");
  await expect(relationshipRow(page, "left-pad")).toContainText("A repository that was not assessed might resolve it.");

  await expect(relationshipRow(page, "legacy-ui")).toContainText("Out of scope");
  await expect(relationshipRow(page, "legacy-ui")).toContainText("it was not analyzed");

  await expect(relationshipRow(page, "https://payments.invalid")).toContainText("calls");
  await expect(relationshipRow(page, "https://payments.invalid")).toContainText("Resolved");
});

test("navigates from a relationship to its evidence with the keyboard", async ({ page, db }) => {
  const { assessment } = await seedMapStates(db);
  await page.goto(paths.runMap(assessment.publicId));
  const evidence = relationshipRow(page, "legacy-ui").getByRole("link", { name: /^package\.json / });
  await evidence.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: /^package\.json \/dependencies\/legacy-ui$/ })).toBeVisible();
  await expect(page.getByText("packages.consumed")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "web" })).toBeVisible();
});

test("opens a repository's focus from its Profile (From a Profile to its focus)", async ({ page, db }) => {
  const world = await seedMapWorld(db);
  const profile = (db.$client.prepare("select profile.public_id from repository_profiles profile join assessment_targets target on target.id = profile.assessment_target_id where target.source_name = 'fx-board'").get() as { public_id: string }).public_id;
  await page.goto(`/profiles/${profile}`);
  await pageHeader(page).getByRole("link", { name: "Relationship Map" }).click();

  await expect(page).toHaveURL(new RegExp(`/runs/${world.assessment.publicId}/map\\?focus=node_`));
  await expect(focus(page)).toHaveAttribute("aria-label", "Focus: fx-board");
});

test("the map stays readable at mobile width, with each diagram's text equivalent in place of the drawing (Narrow content area)", async ({ page, db }) => {
  const world = await seedMapWorld(db);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(systemPath(db, world.assessment.publicId, "access-shell"));

  await expect(page.locator('svg[data-diagram="system-diagram"]')).toBeHidden();
  await expect(page.getByRole("list", { name: "Diagram as a list" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Diagram as a list" }).getByRole("link", { name: "access-shell" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoOverlappingContent(page);

  for (const address of [paths.runMap(world.assessment.publicId), `${paths.runMap(world.assessment.publicId)}?focus=package%3Areact`, systemPath(db, world.assessment.publicId, "orphan-shell")]) {
    await page.goto(address);
    await expectNoHorizontalOverflow(page);
    await expectNoOverlappingContent(page);
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("searches for repositories and opens one in its runtime system (Searching without JavaScript)", async ({ page, db }) => {
    const world = await seedMapWorld(db);
    await page.goto(paths.runMap(world.assessment.publicId));
    await page.getByRole("search", { name: "Search the map" }).getByLabel("Search the map").fill("shell");
    await page.keyboard.press("Enter");

    const results = page.getByRole("region", { name: "Repositories" });
    await expect(results.getByRole("link")).toHaveText(["access-shell", "orphan-shell"]);
    await results.getByRole("link", { name: "orphan-shell" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "orphan-shell" })).toBeVisible();
    await expect(focus(page)).toHaveAttribute("aria-label", "Focus: orphan-shell");
  });
});
