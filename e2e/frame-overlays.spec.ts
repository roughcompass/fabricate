import { onboardPortal } from "../test/support/onboarding";
import { openEditor, options, preview } from "./support/experience";
import { expect, test } from "./support/fixtures";

// web-onboarding/experience-frame spec, "Frame overlays are configured and previewed".

test("The Session Timeout Dialog previews over the frame with its copy and actions, and its copy is the session language", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await openEditor(page, access, "frame-overlays");
  await expect(page.getByRole("list", { name: "Frame overlays" })).toContainText("Session Overlay");
  await page.locator("[data-overlay-row='sessionTimeout']").getByRole("button", { name: "Session Timeout Dialog", exact: true }).click();
  const dialog = preview(page).locator("[data-select='overlay:sessionTimeout']");
  await expect(dialog).toContainText("Session Expiring");
  await expect(dialog).toContainText("Extend Session");
  await expect(dialog).toContainText("Sign Out");
  await expect(dialog).toHaveAttribute("data-selected", "");
  await options(page).getByLabel("Custom language").check();
  await options(page).getByLabel("Dialog title").fill("Still there?");
  await expect(dialog).toContainText("Still there?");
  await page.goto(`/portals/${access.publicId}/configuration/session-language`);
  await expect(page.getByLabel("Dialog title")).toHaveValue("Still there?");
});

test("A toast's auto-dismiss outside 3 to 10 seconds is refused, and hiding the System Error dialog removes it from the preview", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await openEditor(page, access, "frame-overlays");
  await page.locator("[data-overlay-row='successToast']").getByRole("button", { name: "Success Toast", exact: true }).click();
  await options(page).getByLabel("Dismiss after (seconds)").fill("30");
  await expect(options(page).getByText("Dismiss after 3 to 10 seconds")).toBeVisible();
  await options(page).getByLabel("Dismiss after (seconds)").fill("8");
  await expect(preview(page).locator("[data-select='overlay:successToast']")).toContainText("Dismisses after 8 seconds");
  await expect(preview(page).locator("[data-select='overlay:systemError']")).toBeVisible();
  await page.locator("[data-overlay-row='systemError']").getByRole("button", { name: "Show System Error Dialog" }).click();
  await expect(preview(page).locator("[data-select='overlay:systemError']")).toHaveCount(0);
});
