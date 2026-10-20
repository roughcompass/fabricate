import type { Page } from "@playwright/test";
import { experienceVersions } from "../src/lib/experience/versions";
import { registerApplication } from "../test/support/applications";
import { onboardPortal } from "../test/support/onboarding";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

// web-onboarding/experience-editor spec: the per-Portal editor's shell, its
// pending changes, undo and redo, Change history, Save, and the preview.

const rail = (page: Page) => page.getByRole("navigation", { name: "Editor views" });
const topbar = (page: Page) => page.locator("[data-runtime-actions]");
const save = (page: Page) => topbar(page).getByRole("button", { name: "Save", exact: true });
const pending = (page: Page) => topbar(page).locator("[data-pending-count]");
const preview = (page: Page) => page.locator("[data-frame-preview]");
const editorOf = (portal: { publicId: string }, view = "frame-zones") => (view.startsWith("configuration/") ? `/portals/${portal.publicId}/${view}` : `/portals/${portal.publicId}/editor/${view}`);
const submenu = (page: Page) => page.getByRole("navigation", { name: "Primary" });

async function openEditor(page: Page, portal: { publicId: string }, view = "frame-zones") {
  await page.goto(editorOf(portal, view));
  await waitForHydration(page);
}

test.describe("opening the editor", () => {
  test("Opening the editor: Experience Editor in the Runtime Configuration sub-menu opens it inside the shell (Opening the editor)", async ({ page, db, baseURL }) => {
    const access = onboardPortal(db, "Access");
    await page.context().addCookies([{ name: "fabricate-portal", value: access.publicId, url: baseURL! }]);
    await page.goto("/");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Runtime Configuration" }).click();
    await expect(page).toHaveURL(new RegExp(`${editorOf(access)}$`));
    await expect(page).toHaveTitle("Access · Runtime Configuration · DE FabLab");
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Access" })).toBeVisible();
    await expect(submenu(page).getByRole("link", { name: "Experience Editor" })).toHaveAttribute("aria-current", "page");
    await expect(rail(page).getByRole("link", { name: "Frame Zones" })).toHaveAttribute("aria-current", "page");
    // The Portal page offers it too.
    await page.goto(`/portals/${access.publicId}`);
    await page.locator("[data-page-header]").getByRole("link", { name: "Open experience editor" }).click();
    await expect(page).toHaveURL(new RegExp(`${editorOf(access)}$`));
  });

  test("Header tabs switch between three views, kept across a reload, and the editor root opens Frame Zones (Switching views)", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await page.goto(`/portals/${access.publicId}/editor`);
    await expect(page).toHaveURL(new RegExp(`${editorOf(access)}$`));
    await waitForHydration(page);
    await expect(rail(page).getByRole("link")).toHaveText(["", "", ""]);
    await expect(rail(page).getByRole("link").first()).toHaveAttribute("title", "Frame Zones");
    for (const [name, view] of [["Frame Overlays", "frame-overlays"], ["Capability Toolkit", "capabilities"]] as const) {
      await rail(page).getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`${editorOf(access, view)}$`));
      await expect(rail(page).getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    }
    await page.reload();
    await expect(rail(page).getByRole("link", { name: "Capability Toolkit" })).toHaveAttribute("aria-current", "page");
    await expect(rail(page).getByRole("link", { name: "Portal Configuration" })).toHaveCount(0);
    // The view tabs sit in the app header, at its start.
    await expect(page.locator("[data-shell-header]").getByRole("navigation", { name: "Editor views" })).toBeVisible();
  });

  test("An unknown or claim-only Portal has no editor", async ({ page, db: _db }) => {
    const response = await page.goto("/portals/ptl_aaaaaaaaaaaaaaaa/editor/frame-zones");
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
    await submenu(page).getByRole("link", { name: "Experience Editor" }).click();
    await save(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "weren't saved" });
    await expect(alert).toBeVisible();
    await alert.getByRole("link", { name: "Favicon" }).click();
    await expect(page).toHaveURL(new RegExp(`${editorOf(access, "configuration/favicon")}$`));
    expect(experienceVersions(db, access.id)).toHaveLength(0);
  });

  test("Leaving with changes pending asks first, and moving between Runtime Configuration pages doesn't (Leaving with changes)", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access, "configuration/copyright");
    await page.getByLabel("Copyright information").fill("© Pending");
    await submenu(page).getByRole("link", { name: "Favicon" }).click();
    await expect(page).toHaveURL(new RegExp(`${editorOf(access, "configuration/favicon")}$`));
    await submenu(page).getByRole("link", { name: "Portal", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Leave with 1 unsaved change?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Stay" }).click();
    await expect(page).toHaveURL(new RegExp(`${editorOf(access, "configuration/favicon")}$`));
    await expect(pending(page)).toHaveText("1 unsaved change");
    await submenu(page).getByRole("link", { name: "Portal", exact: true }).click();
    await dialog.getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL(new RegExp(`/portals/${access.publicId}$`));
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

  test("Hiding a slot removes it from the preview before saving (Preview follows an edit)", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    await expect(preview(page).locator("[data-slot='feedback']")).toBeVisible();
    await page.locator("[data-slot-row='feedback']").getByRole("button", { name: "Show Feedback Slot" }).click();
    await expect(preview(page).locator("[data-slot='feedback']")).toHaveCount(0);
  });
});

test.describe("the device toolbar", () => {
  const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Device toolbar" });
  const device = (page: Page) => toolbar(page).getByLabel("Device", { exact: true });
  const width = (page: Page) => toolbar(page).getByLabel("Width");
  const height = (page: Page) => toolbar(page).getByLabel("Height");

  test("Starts Responsive at 1440 × 900, and choosing iPhone 14 renders the frame 390 pixels wide in its phone layout (Choosing a phone)", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    await expect(device(page)).toHaveValue("responsive");
    await expect(width(page)).toHaveValue("1440");
    await expect(height(page)).toHaveValue("900");
    await expect(device(page).locator("option")).toHaveText(["Responsive", "Desktop (1440 × 900)", "Laptop (1280 × 800)", "Tablet (768 × 1024)", "iPad Pro (1024 × 1366)", "iPhone 14 (390 × 844)", "Pixel 7 (412 × 915)"]);
    await device(page).selectOption("iphone-14");
    await expect(width(page)).toHaveValue("390");
    await expect(height(page)).toHaveValue("844");
    await expect(preview(page)).toHaveAttribute("data-width", "390");
    await expect(preview(page)).toHaveAttribute("data-device", "phone");
  });

  test("Rotate swaps the size for landscape, says so, and adds no pending change (Landscape phone, Not a change)", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    await device(page).selectOption("iphone-14");
    await toolbar(page).getByRole("button", { name: /^Rotate/ }).click();
    await expect(width(page)).toHaveValue("844");
    await expect(height(page)).toHaveValue("390");
    await expect(toolbar(page).getByRole("button", { name: "Rotate, now Landscape" })).toBeVisible();
    await expect(toolbar(page).getByRole("status")).toHaveText("Landscape");
    await expect(preview(page)).toHaveAttribute("data-height", "390");
    await expect(pending(page)).toHaveCount(0);
    await expect(save(page)).toBeDisabled();
  });

  test("Dragging the right edge resizes the frame in Responsive, and an out-of-range width is clamped (Dragging the edge, Out of range)", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    // iPhone 14 at Fit draws at full size, so the pointer moves the edge pixel for pixel.
    await device(page).selectOption("iphone-14");
    await expect(preview(page)).toHaveAttribute("data-width", "390");
    // The scale settles after the frame redraws, and can move the frame; measure the handle once it has.
    await expect(toolbar(page).locator("[data-preview-scale]")).toHaveText("100%");
    const handle = preview(page).locator("[data-resize-handle='right']");
    await handle.hover();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 510, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(device(page)).toHaveValue("responsive");
    await expect(width(page)).toHaveValue("900");
    await expect(preview(page)).toHaveAttribute("data-width", "900");
    await width(page).fill("100");
    await width(page).blur();
    await expect(width(page)).toHaveValue("320");
  });

  test("At 100% a frame wider than the pane scrolls within it, and the page doesn't (Actual size)", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    await device(page).selectOption("desktop");
    await toolbar(page).getByLabel("Zoom").selectOption("100");
    await expect(toolbar(page).locator("[data-preview-scale]")).toHaveText("100%");
    await expect(preview(page)).toHaveAttribute("data-width", "1440");
    await expect.poll(() => preview(page).evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expectNoHorizontalOverflow(page);
    await toolbar(page).getByLabel("Zoom").selectOption("fit");
    await expect(toolbar(page).locator("[data-preview-scale]")).not.toHaveText("100%");
  });

  test("The toolbar is kept for the tab across Runtime Configuration pages and a reload", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    await device(page).selectOption("pixel-7");
    await submenu(page).getByRole("link", { name: "Copyright Information" }).click();
    await expect(device(page)).toHaveValue("pixel-7");
    await page.reload();
    await waitForHydration(page);
    await expect(device(page)).toHaveValue("pixel-7");
    await expect(width(page)).toHaveValue("412");
  });
});
