import type { Page } from "@playwright/test";
import { buildAssessment, buildSource } from "../test/support/builders";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";

const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });
const rowMenu = async (page: Page, name: string) => {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  return page.locator("[popover]:popover-open");
};

test("adds, edits, disables, and re-enables a Source with validation feedback", async ({ page, db: _db }) => {
  await page.goto("/sources");
  await expect(page.getByText("No Sources yet")).toBeVisible();
  await page.getByRole("link", { name: "New Source" }).first().click();

  await page.getByLabel("Name").fill("orders");
  await page.getByLabel("Clone URL").fill("git@github.com:acme/orders.git");
  await page.getByRole("button", { name: "Create Source" }).click();
  // Once, under the field, which takes focus.
  await expect(page.locator("#source-clone-url-error")).toContainText("scp-style shorthand");
  await expect(page.getByText("scp-style shorthand")).toHaveCount(1);
  await expect(page.getByLabel("Clone URL")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Clone URL")).toBeFocused();
  await expect(page.getByLabel("Name")).toHaveValue("orders");

  await page.getByLabel("Clone URL").fill("https://user:hunter2@git.example.com/acme/orders.git");
  await page.getByRole("button", { name: "Create Source" }).click();
  await expect(page.locator("#source-clone-url-error")).toContainText("configure a credential helper");
  await expect(page.locator("body")).not.toContainText("hunter2");
  await expect(page.getByLabel("Clone URL")).not.toHaveValue(/hunter2/);

  await page.getByLabel("Clone URL").fill("https://git.example.com/acme/orders.git");
  await page.getByLabel("Reference").fill("main");
  await page.getByRole("button", { name: "Create Source" }).click();
  await expect(toasts(page).getByText("orders was added.")).toBeVisible();

  await page.getByRole("link", { name: "New Source" }).first().click();
  await page.getByLabel("Name").fill("duplicate");
  await page.getByLabel("Clone URL").fill("https://GIT.example.com/acme/orders");
  await page.getByRole("button", { name: "Create Source" }).click();
  await expect(page.locator("#source-clone-url-error")).toContainText("already registered as orders (src_");
  await page.getByRole("link", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "orders", exact: true }).click();
  await page.getByLabel("Reference").fill("release");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toasts(page).getByText("Running and past Assessments keep the configuration they started with.")).toBeVisible();
  await expect(page.getByRole("row", { name: /orders/ })).toContainText("release");

  await (await rowMenu(page, "orders")).getByRole("button", { name: "Disable" }).click();
  await expect(toasts(page).getByText("orders is disabled.")).toBeVisible();
  await expect(page.getByRole("row", { name: /orders/ })).toContainText("Disabled");

  await (await rowMenu(page, "orders")).getByRole("button", { name: "Enable" }).click();
  await expect(toasts(page).getByText("orders is enabled for future Assessments.")).toBeVisible();
});

test("keeps Assessment history visible for a disabled Source", async ({ page, db }) => {
  const source = buildSource(db, { name: "legacy-ui" });
  buildAssessment(db, { sources: [source] });

  await page.goto("/sources");
  await (await rowMenu(page, "legacy-ui")).getByRole("button", { name: "Disable" }).click();
  await expect(toasts(page).getByText("legacy-ui is disabled.")).toBeVisible();

  await page.getByRole("link", { name: /^Disabled/ }).click();
  const row = page.getByRole("row", { name: /legacy-ui/ });
  await expect(row).toContainText("Disabled");
  await expect(row).toContainText("1 Assessment");
});

test("searches Sources by name or clone URL, keeping the search in the address", async ({ page, db }) => {
  buildSource(db, { name: "orders" });
  buildSource(db, { name: "billing", cloneUrl: "https://git.example.com/acme/ledger-ordinals.git" });
  buildSource(db, { name: "accounts" });

  await page.goto("/sources");
  const search = page.getByRole("searchbox", { name: "Search Sources" });
  await search.fill("ord");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=ord/);
  const rows = page.getByRole("table", { name: "Repository Sources" }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "accounts" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Filter Sources" }).getByRole("link", { name: /^All/ })).toContainText("2");

  await search.fill("nothing-matches");
  await search.press("Enter");
  await expect(page.getByText("No matching Sources")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(rows).toHaveCount(3);
});

test("keeps every row one height, with or without a Reference", async ({ page, db }) => {
  buildSource(db, { name: "orders", gitRef: "main" });
  buildSource(db, { name: "billing" });
  await page.goto("/sources");
  const heights = await page.locator("tbody tr").evaluateAll((rows) => rows.map((row) => row.querySelector("td")!.clientHeight));
  expect(new Set(heights).size).toBe(1);
});

test("keeps a conflict error until it is dismissed", async ({ page, db }) => {
  buildSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git" });
  buildSource(db, { name: "orders-copy", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders", enabled: false });
  await page.clock.install();
  await page.goto("/sources");

  await (await rowMenu(page, "orders-copy")).getByRole("button", { name: "Enable" }).click();
  const error = toasts(page).getByRole("listitem").filter({ hasText: "orders-copy could not be enabled." });
  await expect(error).toContainText("already registered as orders");
  await page.clock.runFor(30_000);
  await expect(error).toBeVisible();
  await error.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(error).toBeHidden();
});

test("the catalog stays usable at mobile width", async ({ page, db }) => {
  buildSource(db, { name: "orders-with-a-long-name", cloneUrl: "https://git.example.com/acme/orders-with-a-very-long-repository-name-for-testing.git" });
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto("/sources");
  await expect(page.getByText("orders-with-a-long-name")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole("link", { name: "New Source" })).toBeVisible();
});
