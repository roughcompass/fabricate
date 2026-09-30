import type { Page } from "@playwright/test";
import { buildInitiative, buildSource } from "../test/support/builders";
import { manifest } from "../test/support/profiles";
import { seedAssessment } from "../test/support/scenarios";
import type { Db } from "../src/lib/db/client";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, test } from "./support/fixtures";

/** A map with resolved, ambiguous, unresolved, and out-of-scope edges, and one coverage gap. */
async function seedMap(db: Db) {
  const names = ["web", "client", "ui-a", "ui-b", "billing"];
  const sources = names.map((name) => buildSource(db, { name }));
  buildSource(db, { name: "legacy-ui" }); // in the catalog, outside the scope
  const initiative = buildInitiative(db, { name: "Fleet assessment", sources });
  return seedAssessment(db, initiative, sources, [
    {
      "package.json": manifest({ name: "web", version: "1.0.0", private: true, dependencies: { "@acme/client": "^1.0.0", "@acme/ui": "^2.0.0", "left-pad": "^1.3.0", "legacy-ui": "^0.1.0" } }),
      "src/payments.ts": 'export const charge = () => fetch("https://payments.invalid/v1/charges", { method: "POST" });\n',
    },
    { "package.json": manifest({ name: "@acme/client", version: "1.0.0" }) },
    { "package.json": manifest({ name: "@acme/ui", version: "2.0.0" }) },
    { "package.json": manifest({ name: "@acme/ui", version: "2.1.0" }) },
    "failed",
  ]);
}

const relationships = (page: Page) => page.getByRole("table", { name: "Relationships" });
const row = (page: Page, text: string) => relationships(page).getByRole("row").filter({ hasText: text });

test("reviews every resolution state and the coverage gap", async ({ page, db }) => {
  const assessment = await seedMap(db);
  await page.goto(`/assessments/${assessment.publicId}`);
  await page.getByRole("link", { name: "Review the Relationship Map" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Relationship Map" })).toBeVisible();
  await expect(page.getByText("1 repository did not contribute")).toBeVisible();

  const gaps = page.getByRole("table", { name: "Coverage gaps" });
  await expect(gaps.getByRole("row").filter({ hasText: "billing" })).toContainText("Failed");
  await expect(gaps.getByRole("row").filter({ hasText: "billing" })).toContainText("source_unavailable");

  const resolved = row(page, "depends on").filter({ has: page.getByRole("link", { name: "client", exact: true }) });
  await expect(resolved).toContainText("Package dependency, observed");
  await expect(resolved.getByText("Resolved")).toBeVisible();
  await expect(row(page, "produces").filter({ hasText: "@acme/client" })).toContainText("Resolved");

  const ambiguous = row(page, "@acme/ui").filter({ hasText: "Ambiguous" });
  await expect(ambiguous.getByRole("list", { name: "Candidates" }).getByRole("listitem")).toHaveText(["ui-a", "ui-b"]);
  await expect(ambiguous).toContainText("2 repositories in this Assessment declare a package named @acme/ui");

  await expect(row(page, "left-pad")).toContainText("Unresolved");
  await expect(row(page, "left-pad")).toContainText("No repository in this Assessment produces left-pad");
  await expect(row(page, "left-pad")).toContainText("A repository that was not assessed might resolve it.");

  await expect(row(page, "legacy-ui")).toContainText("Out of scope");
  await expect(row(page, "legacy-ui")).toContainText("it was not analyzed");

  await expect(row(page, "https://payments.invalid")).toContainText("calls");
  await expect(row(page, "https://payments.invalid")).toContainText("Resolved");
});

test("filters relationships with the keyboard and announces the result", async ({ page, db }) => {
  const assessment = await seedMap(db);
  await page.goto(`/assessments/${assessment.publicId}/map`);
  const form = page.getByRole("form", { name: "Filter relationships" });
  const status = page.getByRole("status").filter({ hasText: "relationship" });
  const total = await relationships(page).locator("tbody tr").count();
  await expect(status).toHaveText(`${total} relationships`);

  // Every control is labeled and reachable in order; Enter on the button submits.
  await form.getByLabel("Node").focus();
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Direction")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Relationship type")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Resolution state")).toBeFocused();
  await form.getByLabel("Resolution state").selectOption("ambiguous");
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Apply filters" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/state=ambiguous/);
  await expect(status).toHaveText(`Showing 1 of ${total} relationships`);
  await expect(relationships(page).locator("tbody tr")).toHaveCount(1);
  await expect(form.getByLabel("Resolution state")).toHaveValue("ambiguous");

  // Direction: what depends on the client repository, from the node summary.
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(status).toHaveText(`${total} relationships`);
  await page.getByRole("table", { name: "Nodes" }).getByRole("link", { name: "1 incoming to client" }).click();
  await expect(form.getByLabel("Direction")).toHaveValue("incoming");
  await expect(relationships(page).locator("tbody tr")).toHaveCount(1);
  await expect(row(page, "web")).toContainText("depends on");

  await form.getByLabel("Direction").selectOption("outgoing");
  await form.getByRole("button", { name: "Apply filters" }).click();
  await expect(relationships(page).locator("tbody tr")).toHaveCount(1);
  await expect(relationships(page)).toContainText("produces");

  await form.getByLabel("Relationship type").selectOption("service_call");
  await form.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No relationship matches these filters.")).toBeVisible();
});

test("navigates from a relationship to its evidence with the keyboard", async ({ page, db }) => {
  const assessment = await seedMap(db);
  await page.goto(`/assessments/${assessment.publicId}/map?state=out_of_scope`);
  const evidence = row(page, "legacy-ui").getByRole("link", { name: /^package\.json / });
  await evidence.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: /^package\.json \/dependencies\/legacy-ui$/ })).toBeVisible();
  await expect(page.getByText("packages.consumed")).toBeVisible();
  await expect(page.getByRole("link", { name: "web Profile" })).toBeVisible();
});

test("the map stays readable at mobile width", async ({ page, db }) => {
  const assessment = await seedMap(db);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/assessments/${assessment.publicId}/map`);
  await expect(relationships(page)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoOverlappingContent(page);
});
