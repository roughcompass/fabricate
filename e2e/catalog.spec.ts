import { buildAssessment, buildSource } from "../test/support/builders";
import { errorSummary, expect, expectNoHorizontalOverflow, test } from "./support/fixtures";

test("adds, edits, disables, and re-enables a source with validation feedback", async ({ page, db: _db }) => {
  await page.goto("/sources");
  await expect(page.getByRole("heading", { name: "No sources yet" })).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).first().click();

  await page.getByLabel("Name").fill("orders");
  await page.getByLabel("Clone URL").fill("git@github.com:acme/orders.git");
  await page.getByRole("button", { name: "Add source" }).click();
  await expect(errorSummary(page)).toContainText("scp-style shorthand");
  await expect(page.getByLabel("Clone URL")).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("Clone URL").fill("https://user:hunter2@git.example.com/acme/orders.git");
  await page.getByRole("button", { name: "Add source" }).click();
  await expect(errorSummary(page)).toContainText("configure a credential helper");
  await expect(page.locator("body")).not.toContainText("hunter2");
  await expect(page.getByLabel("Clone URL")).not.toHaveValue(/hunter2/);

  await page.getByLabel("Clone URL").fill("https://git.example.com/acme/orders.git");
  await page.getByLabel("Reference").fill("main");
  await page.getByRole("button", { name: "Add source" }).click();
  await expect(page.getByText("orders was added to the catalog.")).toBeVisible();

  await page.getByRole("link", { name: "Add source" }).first().click();
  await page.getByLabel("Name").fill("duplicate");
  await page.getByLabel("Clone URL").fill("https://GIT.example.com/acme/orders");
  await page.getByRole("button", { name: "Add source" }).click();
  await expect(errorSummary(page)).toContainText("already registered as orders (src_");
  await page.getByRole("link", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "Edit orders" }).click();
  await page.getByLabel("Reference").fill("release");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Running and past assessments keep their original configuration.")).toBeVisible();
  await expect(page.getByRole("row", { name: /orders/ })).toContainText("release");

  await page.getByRole("button", { name: "Disable orders" }).click();
  await expect(page.getByText("Past assessments that included it are unchanged.")).toBeVisible();
  await expect(page.getByRole("row", { name: /orders/ })).toContainText("Disabled");

  await page.getByRole("button", { name: "Enable orders" }).click();
  await expect(page.getByText("is enabled for future assessments.")).toBeVisible();
});

test("keeps assessment history visible for a disabled source", async ({ page, db }) => {
  const source = buildSource(db, { name: "legacy-ui" });
  buildAssessment(db, { sources: [source] });

  await page.goto("/sources");
  await page.getByRole("button", { name: "Disable legacy-ui" }).click();

  await page.getByRole("link", { name: /^Disabled/ }).click();
  const row = page.getByRole("row", { name: /legacy-ui/ });
  await expect(row).toContainText("Disabled");
  await expect(row).toContainText("1 assessment");
});

test("the catalog stays usable at mobile width", async ({ page, db }) => {
  buildSource(db, { name: "orders-with-a-long-name", cloneUrl: "https://git.example.com/acme/orders-with-a-very-long-repository-name-for-testing.git" });
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto("/sources");
  await expect(page.getByText("orders-with-a-long-name")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
