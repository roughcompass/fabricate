import type { Page } from "@playwright/test";
import { experienceVersions } from "../src/lib/experience/versions";
import { onboardPortal } from "../test/support/onboarding";
import { editorOf, headerActions, openEditor, pendingCount, saveEditor } from "./support/experience";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

// web-onboarding/runtime-configuration spec: the sub-menu on every page of a
// Portal, one set of pending changes across the Experience Editor and the
// configuration pages, the header's actions, and the switcher on them.

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const header = (page: Page) => page.locator("[data-shell-header]");

test("Deep editor page: System messages and Change history mark Experience Editor (Deep editor page)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  for (const view of ["messages", "change-history", "menu"]) {
    await page.goto(editorOf(access, view));
    await expect(primary(page).getByRole("link", { name: "Experience Editor" })).toHaveAttribute("aria-current", "page");
  }
});

test("Pending across pages: a copyright edit and a hidden slot save as one version (Pending across pages)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await openEditor(page, access, "configuration/copyright");
  await page.getByLabel("Copyright information").fill("© 2026 JPMorgan Chase & Co. Access.");
  await primary(page).getByRole("link", { name: "Experience Editor" }).click();
  await page.locator("[data-slot-row='feedback']").getByRole("button", { name: "Show Feedback Slot" }).click();
  await expect(pendingCount(page)).toHaveText("2 unsaved changes");
  await saveEditor(page);
  const versions = experienceVersions(db, access.id);
  expect(versions).toHaveLength(1);
  expect(versions[0]!.changeCount).toBe(2);
});

test("Undo across pages: Undo in the Experience Editor takes back a copyright edit made on its page, and changes survive a reload (Undo across pages)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await openEditor(page, access, "configuration/copyright");
  const original = await page.getByLabel("Copyright information").inputValue();
  await page.getByLabel("Copyright information").fill("© Changed");
  await page.getByLabel("Copyright information").blur();
  await primary(page).getByRole("link", { name: "Experience Editor" }).click();
  await page.reload();
  await waitForHydration(page);
  await expect(pendingCount(page)).toHaveText("1 unsaved change");
  await headerActions(page).getByRole("button", { name: "Undo" }).click();
  await expect(pendingCount(page)).toHaveCount(0);
  await primary(page).getByRole("link", { name: "Copyright Information" }).click();
  await expect(page.getByLabel("Copyright information")).toHaveValue(original);
});

test("Header on a configuration page: Undo, Redo, Change history, the unsaved count, Open running portal, and Save, each named, and no view tabs (Header on a configuration page)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await openEditor(page, access, "configuration/favicon");
  await page.getByLabel("Enabled").uncheck();
  const actions = headerActions(page);
  await expect(header(page)).toContainText("Favicon");
  for (const name of ["Undo", "Redo"]) await expect(actions.getByRole("button", { name })).toHaveAttribute("title", name);
  await expect(actions.getByRole("link", { name: /^Change history/ })).toHaveAttribute("title", "Change history");
  await expect(actions.locator("[data-pending-count]")).toHaveText("1 unsaved change");
  await expect(actions.getByRole("link", { name: /Open running portal/ })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect(header(page).getByRole("navigation", { name: "Editor views" })).toHaveCount(0);
});

test("Narrow header: at 375px the controls stay inside the viewport, the title truncates, and the count is a badge (Narrow header)", async ({ page, db }) => {
  const access = onboardPortal(db, "Global Corporate Treasury Operations Portal");
  await page.setViewportSize({ width: 375, height: 812 });
  await openEditor(page, access);
  await page.locator("[data-slot-row='feedback']").getByRole("button", { name: "Show Feedback Slot" }).click();
  await expect(headerActions(page).getByRole("link", { name: "Change history, 1 unsaved change" })).toBeVisible();
  for (const control of await headerActions(page).locator("a:visible, button:visible").all()) {
    const box = (await control.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  await expectNoHorizontalOverflow(page);
});

test("Switching on a Runtime Configuration page: choosing Markets on Access's Favicon page opens Markets' Favicon page, and All Portals the Portals page (Switching on a Runtime Configuration page)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const markets = onboardPortal(db, "Markets");
  await openEditor(page, access, "configuration/favicon");
  const sidebar = page.locator("#sidebar");
  await sidebar.getByRole("button", { name: /^Switch Portal/ }).click();
  await sidebar.locator("[popover]").getByRole("button", { name: /^Markets/ }).click();
  await expect(page).toHaveURL(new RegExp(`/portals/${markets.publicId}/configuration/favicon$`));
  await waitForHydration(page);
  await sidebar.getByRole("button", { name: /^Switch Portal/ }).click();
  await sidebar.locator("[popover]").getByRole("button", { name: /^All Portals/ }).click();
  await expect(page).toHaveURL(/\/portals$/);
});
