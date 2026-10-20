import type { Page } from "@playwright/test";
import { onboardPortal } from "../test/support/onboarding";
import { editorOf, openEditor, options, pendingCount, preview, saveDirectly } from "./support/experience";
import { expect, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

// web-onboarding/experience-frame spec: frame zones and slots, external
// modules, the banner's options, and the System messages editor.

const zoneRow = (page: Page, zone: string) => page.locator(`[data-zone-row='${zone}']`);
const slotRow = (page: Page, slot: string) => page.locator(`[data-slot-row='${slot}']`);

test.describe("frame zones", () => {
  test("The frame lists four zones with 1, 7, 3, and 3 slots, which collapse and expand", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    for (const [zone, count] of [["banner", "1 slot"], ["header", "7 slots"], ["sidebar", "3 slots"], ["footer", "3 slots"]] as const) await expect(zoneRow(page, zone)).toContainText(count);
    await zoneRow(page, "header").getByRole("button", { name: "Collapse Header Zone" }).click();
    await expect(slotRow(page, "brand")).toHaveCount(0);
    await zoneRow(page, "header").getByRole("button", { name: "Expand Header Zone" }).click();
    await expect(slotRow(page, "brand")).toBeVisible();
  });

  test("Hiding the footer removes it from the preview, and the zone's Enabled option is the same setting", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    await zoneRow(page, "footer").getByRole("button", { name: "Show Footer Zone" }).click();
    await expect(preview(page).locator("[data-zone='footer']")).toHaveCount(0);
    await zoneRow(page, "footer").getByRole("button", { name: "Footer Zone", exact: true }).click();
    await expect(options(page).getByLabel("Enabled")).not.toBeChecked();
    await options(page).getByLabel("Enabled").check();
    await expect(preview(page).locator("[data-zone='footer']")).toBeVisible();
  });

  test("Global Search needs its toolkit; once Notifications is installed it moves above Actions", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    saveDirectly(db, access, (draft) => draft.toolkits.installed.push("notifications"));
    await openEditor(page, access);
    await expect(slotRow(page, "global-search")).toContainText("Needs Global Search");
    await expect(slotRow(page, "global-search").getByRole("button", { name: "Show Global Search Slot" })).toBeDisabled();
    const order = () => preview(page).locator("[data-zone='header'] [data-slot]").evaluateAll((slots) => slots.map((slot) => slot.getAttribute("data-slot")));
    expect(await order()).toEqual(["toggle", "brand", "actions", "notifications", "feedback", "user-menu"]);
    await slotRow(page, "notifications").getByRole("button", { name: "Move Notifications Slot up" }).click();
    expect(await order()).toEqual(["toggle", "brand", "notifications", "actions", "feedback", "user-menu"]);
    await expect(slotRow(page, "toggle").getByRole("button", { name: "Move Toggle Slot up" })).toBeDisabled();
  });

  test("Replacing the banner with an external module resolves its range and labels the preview", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access);
    await zoneRow(page, "banner").getByRole("button", { name: "Banner Zone", exact: true }).click();
    await options(page).getByLabel("Replace with external module").check();
    await options(page).getByLabel("Module", { exact: true }).selectOption("@deweb/alert-strip");
    await options(page).getByLabel("Version range").fill("^9.0.0");
    await expect(options(page).getByText("No published version of @deweb/alert-strip matches ^9.0.0")).toBeVisible();
    await options(page).getByLabel("Version range").fill("^2.0.0");
    await expect(options(page).getByText("Resolves to 2.4.1")).toBeVisible();
    await expect(preview(page).locator("[data-zone='banner']")).toContainText("@deweb/alert-strip 2.4.1");
  });
});

test.describe("system messages", () => {
  test("An active Warning shows in the preview banner; the banner's status and dismiss options override it", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await openEditor(page, access, "messages");
    await page.getByRole("button", { name: "Add message" }).click();
    const panel = page.getByRole("complementary", { name: "Edit message" });
    await panel.getByLabel("Title").fill("Scheduled maintenance");
    await panel.getByLabel("Description").fill("Access will be unavailable on Sunday from 2:00 AM to 6:00 AM ET.");
    await panel.getByLabel("Severity").selectOption("warning");
    await panel.getByLabel("Enabled").check();
    const row = page.locator("[data-message]").filter({ hasText: "Scheduled maintenance" });
    await expect(row).toContainText("Active");
    await expect(page.locator("[data-messages-summary]")).toHaveText("1 message · Scheduled maintenance is live");
    await page.getByRole("link", { name: "Back to workspace" }).click();
    await expect(preview(page).locator("[data-zone='banner']")).toHaveAttribute("data-severity", "warning");
    await expect(preview(page).locator("[data-zone='banner']")).toContainText("Scheduled maintenance");
    await preview(page).locator("[data-zone='banner']").click({ position: { x: 4, y: 4 } });
    await expect(page.getByText(/^Editing Banner Zone/)).toBeVisible();
    await zoneRow(page, "banner").getByRole("button", { name: "Banner Zone", exact: true }).click();
    await options(page).getByLabel("Banner status").selectOption("error");
    await expect(preview(page).locator("[data-zone='banner']")).toHaveAttribute("data-severity", "error");
  });

  test("A message scheduled for tomorrow counts as scheduled with no banner, and an end before the start is refused", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
    saveDirectly(db, access, (draft) => draft.messages.push({ id: "msg_tomorrow", title: "Upgrade window", description: "", severity: "info", dismissible: true, enabled: true, startsAt: tomorrow, endsAt: null }));
    await openEditor(page, access);
    await slotRow(page, "message").getByRole("button", { name: "Message Slot", exact: true }).click();
    await expect(options(page).locator("[data-message-counts]")).toHaveText(/0 active.*1 scheduled.*0 off or expired/);
    await expect(preview(page).locator("[data-zone='banner']")).toHaveCount(0);
    await options(page).getByRole("link", { name: "Manage messages" }).click();
    await waitForHydration(page);
    await page.getByRole("button", { name: "Edit Upgrade window" }).click();
    const panel = page.getByRole("complementary", { name: "Edit message" });
    await panel.getByLabel("Starts").fill(later);
    await panel.getByLabel("Ends").fill(tomorrow);
    await expect(panel.getByText("End after the start")).toBeVisible();
    await panel.getByRole("button", { name: "Clear schedule" }).click();
    await expect(page.locator("[data-message]")).toContainText("Always on");
  });

  test("Reordering decides which active message shows, and deleting asks first", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    saveDirectly(db, access, (draft) => {
      draft.messages.push({ id: "msg_one", title: "First notice", description: "", severity: "info", dismissible: true, enabled: true, startsAt: null, endsAt: null });
      draft.messages.push({ id: "msg_two", title: "Second notice", description: "", severity: "warning", dismissible: false, enabled: true, startsAt: null, endsAt: null });
    });
    await openEditor(page, access, "messages");
    await expect(page.locator("[data-messages-summary]")).toContainText("First notice is live");
    await page.getByRole("button", { name: "Move Second notice up" }).click();
    await expect(page.locator("[data-messages-summary]")).toContainText("Second notice is live");
    await page.getByRole("button", { name: "Delete First notice" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete First notice?" });
    await dialog.getByRole("button", { name: "Delete message" }).click();
    await expect(page.locator("[data-message]")).toHaveCount(1);
    // The surviving message keeps its place among the saved ones, so the delete is the one change.
    await expect(pendingCount(page)).toHaveText("1 unsaved change");
    await page.goto(editorOf(access, "change-history"));
    await expect(page.getByRole("table", { name: "Pending changes" })).toContainText("System message");
  });
});
