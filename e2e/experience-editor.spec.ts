import type { Page } from "@playwright/test";
import { experienceVersions } from "../src/lib/experience/versions";
import { registerApplication } from "../test/support/applications";
import { onboardPortal } from "../test/support/onboarding";
import { expect, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

// web-onboarding/experience-editor spec: the per-Portal editor's shell, its
// pending changes, undo and redo, Change history, Save, and the preview.

const rail = (page: Page) => page.getByRole("navigation", { name: "Editor views" });
const topbar = (page: Page) => page.locator("[data-experience-editor]");
const save = (page: Page) => topbar(page).getByRole("button", { name: "Save", exact: true });
const pending = (page: Page) => topbar(page).locator("[data-pending-count]");
const preview = (page: Page) => page.locator("[data-frame-preview]");
const editorOf = (portal: { publicId: string }, view = "frame-zones") => `/navigation/${portal.publicId}/editor/${view}`;

async function openEditor(page: Page, portal: { publicId: string }, view = "frame-zones") {
  await page.goto(editorOf(portal, view));
  await waitForHydration(page);
}

test.describe("opening the editor", () => {
  test("Opening from the Navigation page: a focused page with no sidebar, and Back returns", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await page.goto(`/navigation/${access.publicId}`);
    await page.locator("[data-page-header]").getByRole("link", { name: "Open experience editor" }).click();
    await expect(page).toHaveURL(new RegExp(`${editorOf(access)}$`));
    await expect(page).toHaveTitle("Access · Experience editor · DE FabLab");
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(rail(page).getByRole("link", { name: "Frame Zones" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Back to Access" }).click();
    await expect(page).toHaveURL(new RegExp(`/navigation/${access.publicId}$`));
  });

  test("The rail switches views, kept across a reload, and the editor root opens Frame Zones", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await page.goto(`/navigation/${access.publicId}/editor`);
    await expect(page).toHaveURL(new RegExp(`${editorOf(access)}$`));
    await waitForHydration(page);
    for (const [name, view] of [["Frame Overlays", "frame-overlays"], ["Capability Toolkit", "capabilities"], ["Portal Configuration", "configuration/brand"]] as const) {
      await rail(page).getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`${editorOf(access, view)}$`));
      await expect(rail(page).getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    }
    await page.reload();
    await expect(rail(page).getByRole("link", { name: "Portal Configuration" })).toHaveAttribute("aria-current", "page");
  });

  test("An unknown or claim-only Portal has no editor", async ({ page, db: _db }) => {
    const response = await page.goto("/navigation/ptl_aaaaaaaaaaaaaaaa/editor/frame-zones");
    expect(response?.status()).toBe(404);
  });
});

test.describe("pending changes and saving", () => {
  test("Save is unavailable until an edit; an edit enables it, and saving records a version", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access, "configuration/copyright");
    await expect(save(page)).toBeDisabled();
    await page.getByLabel("Copyright information").fill("© 2026 JPMorgan Chase & Co.");
    await expect(pending(page)).toHaveText("1 unsaved change");
    await expect(save(page)).toBeEnabled();
    await save(page).click();
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Version 1 is saved.");
    await expect(pending(page)).toHaveCount(0);
    expect(experienceVersions(db, access.id).map((version) => version.number)).toEqual([1]);
    await page.goto(editorOf(access, "change-history"));
    await expect(page.getByRole("table", { name: "Saved versions" })).toContainText("Version 1");
    await expect(page.getByRole("table", { name: "Saved versions" })).toContainText("Unverified");
  });

  test("Change history lists each pending change with its original marked Default, and Revert drops one", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access, "configuration/session");
    await page.getByLabel("Configure logout redirect URL").check();
    await page.getByLabel("Logout redirect URL", { exact: true }).fill("/login");
    await expect(pending(page)).toHaveText("2 unsaved changes");
    await pending(page).click();
    await expect(page).toHaveURL(new RegExp(`${editorOf(access, "change-history")}$`));
    const rows = page.getByRole("table", { name: "Pending changes" }).locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Logout redirect enabled" })).toContainText("Off");
    await expect(rows.filter({ hasText: "Logout redirect enabled" })).toContainText("Default");
    await rows.filter({ hasText: "Logout redirect URL" }).getByRole("button", { name: /^Revert/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(pending(page)).toHaveText("1 unsaved change");
  });

  test("Undo and Redo step through edits, and pending changes survive a reload", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access, "configuration/copyright");
    const field = page.getByLabel("Copyright information");
    const original = await field.inputValue();
    await field.fill("© Changed");
    await field.blur();
    await topbar(page).getByRole("button", { name: "Undo" }).click();
    await expect(field).toHaveValue(original);
    await expect(topbar(page).getByRole("button", { name: "Redo" })).toBeEnabled();
    await topbar(page).getByRole("button", { name: "Redo" }).click();
    await expect(field).toHaveValue("© Changed");
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByLabel("Copyright information")).toHaveValue("© Changed");
    await expect(pending(page)).toHaveText("1 unsaved change");
  });

  test("Two editors: the second save is refused, says Access changed, and keeps its changes", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    const other = await page.context().newPage();
    await openEditor(page, access, "configuration/copyright");
    await openEditor(other, access, "configuration/copyright");
    await page.getByLabel("Copyright information").fill("© First");
    await save(page).click();
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Version 1 is saved.");
    await other.getByLabel("Copyright information").fill("© Second");
    await save(other).click();
    await expect(other.getByRole("alert").filter({ hasText: "Access changed since you opened it" })).toBeVisible();
    await expect(other.getByLabel("Copyright information")).toHaveValue("© Second");
    await expect(pending(other)).toHaveText("1 unsaved change");
    expect(experienceVersions(db, access.id)).toHaveLength(1);
  });

  test("An invalid save is refused, and its problem links to the Favicon section", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access, "configuration/favicon");
    await page.getByLabel("Favicon data URL").fill("https://example.com/icon.png");
    await expect(page.getByText("Only data URLs of an SVG, PNG, or ICO image are accepted")).toBeVisible();
    await rail(page).getByRole("link", { name: "Frame Zones" }).click();
    await save(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "weren't saved" });
    await expect(alert).toBeVisible();
    await alert.getByRole("link", { name: /Portal Configuration · favicon/ }).click();
    await expect(page).toHaveURL(new RegExp(`${editorOf(access, "configuration/favicon")}$`));
    expect(experienceVersions(db, access.id)).toHaveLength(0);
  });

  test("Leaving with changes pending asks first", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access, "configuration/copyright");
    await page.getByLabel("Copyright information").fill("© Pending");
    await page.getByRole("link", { name: "Back to Access" }).click();
    const dialog = page.getByRole("dialog", { name: "Leave with 1 unsaved change?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Stay" }).click();
    await expect(page).toHaveURL(new RegExp(`${editorOf(access, "configuration/copyright")}$`));
    await page.getByRole("link", { name: "Back to Access" }).click();
    await dialog.getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL(new RegExp(`/navigation/${access.publicId}$`));
  });
});

test.describe("the preview", () => {
  test("Selecting from the list or the preview selects in both and shows the options", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    registerApplication(db, { name: "Payee Hub", portal: access });
    await openEditor(page, access);
    await page.locator("[data-slot-row='message']").getByRole("button", { name: "Message Slot", exact: true }).click();
    await expect(page.getByRole("region", { name: "Options", exact: true })).toContainText("Manage messages");
    await page.locator("[data-zone-row='header']").getByRole("button", { name: "Header Zone", exact: true }).click();
    await expect(page.getByText("Editing Header Zone")).toBeVisible();
    await preview(page).locator("[data-slot='brand']").click();
    await expect(page.getByText("Editing Header Zone → Brand Slot")).toBeVisible();
    await expect(page.locator("[data-slot-row='brand']")).toHaveAttribute("data-selected", "");
    await expect(preview(page).locator("[data-slot='brand'] img")).toHaveAttribute("alt", "J.P. Morgan");
    await expect(preview(page)).toContainText("Access");
  });

  test("Hiding a slot removes it from the preview before saving, and the device toggle scales it", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    await expect(preview(page).locator("[data-slot='feedback']")).toBeVisible();
    await page.locator("[data-slot-row='feedback']").getByRole("button", { name: "Show Feedback Slot" }).click();
    await expect(preview(page).locator("[data-slot='feedback']")).toHaveCount(0);
    await expect(page.locator("[data-preview-scale]")).toContainText(/^1440px @ \d+%$/);
    await page.getByRole("button", { name: "Phone, 375 pixels" }).click();
    await expect(page.locator("[data-preview-scale]")).toContainText(/^375px @ \d+%$/);
  });
});
