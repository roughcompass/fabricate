import type { Page } from "@playwright/test";
import { findingsOf } from "../src/lib/evaluations/evaluation-records";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { evaluate, seedResults } from "./support/results";

test("renders the application shell with a skip link and current navigation", async ({ page, db: _db }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Initiatives · Fabricate");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
  await expect(page.getByRole("heading", { level: 1, name: "Initiatives" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(navigation.getByRole("link", { name: "Initiatives" })).toHaveAttribute("aria-current", "page");

  await navigation.getByRole("link", { name: "Sources" }).click();
  await expect(navigation.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "Initiatives" })).not.toHaveAttribute("aria-current", "page");
});

test("marks Initiatives current on a Finding, deep within its section", async ({ page, db }) => {
  const { initiative, assessment } = await seedResults(db);
  const evaluation = await evaluate(db, initiative.publicId, assessment.publicId);
  const finding = findingsOf(db, evaluation.id)[0]!;

  await page.goto(`/evaluations/${evaluation.publicId}/findings/${finding.publicId}`);
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(navigation.getByRole("link", { name: "Initiatives" })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "Standards" })).not.toHaveAttribute("aria-current", "page");
});

/** The header's items, left to right, do not overlap and fit inside the viewport. */
async function expectHeaderFits(page: Page) {
  const header = page.getByRole("banner");
  const items = [
    header.getByRole("link", { name: "Fabricate home" }),
    ...["Initiatives", "Sources", "Standards", "Templates"].map((section) => header.getByRole("link", { name: section })),
    header.getByRole("button", { name: "Theme" }),
  ];
  let previousRight = 0;
  for (const item of items) {
    await expect(item).toBeVisible();
    const box = (await item.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(previousRight - 0.5);
    previousRight = box.x + box.width;
  }
  expect(previousRight).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expectNoHorizontalOverflow(page);
}

// The browser-test server runs in the test environment, where the template demo is enabled.
test("fits the header at 375px: the mark, all four sections, and the theme control", async ({ page, db: _db }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expectHeaderFits(page);
});

test.describe("on a touch device", () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 812 } });

  test("still fits the header with 44px targets", async ({ page, db: _db }) => {
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("button", { name: "Theme" })).toBeVisible();
    await expectHeaderFits(page);
  });
});
