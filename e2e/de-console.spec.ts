import { recordFailedDeConsoleRead } from "../src/lib/ownership/de-console";
import { createApplication } from "../src/lib/ownership/records";
import { readDeConsole } from "../test/support/home";
import { E2E_DE_CONSOLE } from "./support/env";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";

// page-patterns spec: the DE Console import page shows reads and open
// conflicts. The browser-test server reads its export from E2E_DE_CONSOLE;
// the unconfigured and endpoint cases are in test/app/de-console-page.test.ts.

const DE_CONSOLE = "/repositories/de-console";
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

test("Failed latest read: one page alert with the recorded error, and the last success in the overview", async ({ page, db }) => {
  readDeConsole(db, [{ seal_id: "88001", name: "Access Shell" }], hoursAgo(5));
  recordFailedDeConsoleRead(db, { trigger: "schedule", error: "The DE Console didn't answer within 10 seconds", readAt: hoursAgo(1) });

  await page.goto(DE_CONSOLE);
  await expect(page).toHaveTitle("DE Console import · Repositories · DE FabLab");
  await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("DE Console import");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Repositories" })).toHaveAttribute("href", "/repositories");
  await expect(page.getByText("The DE Console couldn't be read")).toHaveCount(1);
  await expect(page.getByText(/didn't answer within 10 seconds/)).toBeVisible();
  await expect(page.getByText("Last successful read", { exact: true })).toBeVisible();
  await expect(page.getByText("1 application listed")).toBeVisible();
  // The sidebar marks Repositories, and the page never shows the source.
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Repositories", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.locator("body")).not.toContainText(E2E_DE_CONSOLE);
  await expect(page.getByRole("button", { name: /Resolve|Read/ })).toHaveCount(0);
});

test("Open conflicts: each with its reason in words and the applications it could describe", async ({ page, db }) => {
  createApplication(db, { sealId: "88002", name: "Access Shell" });
  createApplication(db, { sealId: "88002", name: "Access Settings" });
  readDeConsole(db, [{ seal_id: "88001", name: "Markets Hub" }, { seal_id: "88001", name: "Markets Admin" }, { seal_id: "88002" }], hoursAgo(2));

  await page.goto(`${DE_CONSOLE}#conflicts`);
  const rows = page.getByRole("table", { name: "Open DE Console conflicts" }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Listed twice in the export" })).toContainText("88001");
  const several = rows.filter({ hasText: "Matches several applications" });
  await expect(several).toContainText("Access Shell (88002)");
  await expect(several).toContainText("Access Settings (88002)");
  await expectNoHorizontalOverflow(page);
});

test.describe("on a narrow viewport", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("stacks the conflicts without overflowing", async ({ page, db }) => {
    createApplication(db, { sealId: "88002", name: "Access Shell" });
    createApplication(db, { sealId: "88002", name: "Access Settings" });
    readDeConsole(db, [{ seal_id: "88002" }], hoursAgo(2));
    await page.goto(DE_CONSOLE);
    await expect(page.getByText("Matches several applications")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
