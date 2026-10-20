import type { Page } from "@playwright/test";
import { onboardPortal } from "../test/support/onboarding";
import { editorOf, openEditor, options, preview, saveDirectly } from "./support/experience";
import { expect, test } from "./support/fixtures";

// web-onboarding/capability-toolkits spec: installing, configuring, and removing toolkits.

const toolkits = (page: Page) => page.getByRole("list", { name: "Toolkits" });
const toolkit = (page: Page, name: string) => toolkits(page).getByRole("button", { name: new RegExp(`^${name}`) });

test("The catalog lists every toolkit with its state, and search narrows it", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await openEditor(page, access, "capabilities");
  await expect(toolkits(page).getByRole("button")).toHaveText(["Global SearchAvailable", "NotificationsAvailable", "System MessagesInstalled", "Menu ManagementInstalled", "Session ManagementInstalled"]);
  await page.getByRole("searchbox", { name: "Search capability toolkit" }).fill("search");
  await expect(toolkits(page).getByRole("button")).toHaveText(["Global SearchAvailable"]);
});

test("Installing Global Search: its prerequisites are checked, its slot shows, and its module is required", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await openEditor(page, access, "capabilities");
  await toolkit(page, "Global Search").click();
  await expect(options(page)).toContainText("Header Zone → Global Search Slot");
  await expect(options(page)).toContainText("@deweb/global-search");
  await options(page).getByRole("button", { name: "Install" }).click();
  const dialog = page.getByRole("dialog", { name: "Install Global Search" });
  await expect(dialog).toContainText("One-click install");
  await expect(dialog.getByRole("list", { name: "Prerequisites" }).locator("li").first()).toHaveAttribute("data-met", "true");
  await dialog.getByRole("button", { name: "Install" }).click();
  await expect(toolkit(page, "Global Search")).toContainText("Installed");
  await expect(preview(page).locator("[data-slot='global-search']")).toContainText("Search");

  await page.goto(editorOf(access, "configuration/runtime-modules"));
  await expect(page.locator("[data-module='@deweb/global-search']")).toContainText("Required by Global Search");
  await page.goto(editorOf(access));
  await expect(page.locator("[data-slot-row='global-search']")).not.toContainText("Needs Global Search");
});

test("A required prerequisite that isn't met blocks the install", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  saveDirectly(db, access, (draft) => draft.toolkits.globalSearch.sources.forEach((source) => void (source.enabled = false)));
  await openEditor(page, access, "capabilities");
  await toolkit(page, "Global Search").click();
  await options(page).getByRole("button", { name: "Install" }).click();
  const dialog = page.getByRole("dialog", { name: "Install Global Search" });
  await expect(dialog.getByRole("list", { name: "Prerequisites" }).locator("li").first()).toHaveAttribute("data-met", "false");
  await expect(dialog.getByRole("button", { name: "Install" })).toBeDisabled();
});

test("Removing Notifications hides its slot and keeps its configuration", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  saveDirectly(db, access, (draft) => {
    draft.toolkits.installed.push("notifications");
    draft.toolkits.notifications.title = "Alerts";
  });
  await openEditor(page, access, "capabilities");
  await expect(preview(page).locator("[data-slot='notifications']")).toBeVisible();
  await toolkit(page, "Notifications").click();
  await expect(options(page).getByLabel("Panel title")).toHaveValue("Alerts");
  await options(page).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog", { name: "Remove Notifications?" }).getByRole("button", { name: "Remove toolkit" }).click();
  await expect(toolkit(page, "Notifications")).toContainText("Available");
  await expect(preview(page).locator("[data-slot='notifications']")).toHaveCount(0);
  await options(page).getByRole("button", { name: "Install" }).click();
  await page.getByRole("dialog", { name: "Install Notifications" }).getByRole("button", { name: "Install" }).click();
  await expect(options(page).getByLabel("Panel title")).toHaveValue("Alerts");
});

test("Global Search's configuration: the placeholder shows in the preview, a taken shortcut is refused, and sources reorder", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  saveDirectly(db, access, (draft) => draft.toolkits.installed.push("global-search"));
  await openEditor(page, access, "capabilities");
  await toolkit(page, "Global Search").click();
  await options(page).getByLabel("Placeholder").fill("Search payments");
  await expect(preview(page).locator("[data-slot='global-search']")).toContainText("Search payments");
  await options(page).getByLabel("Keyboard shortcut").fill("s");
  await expect(options(page).getByText("s is taken by another shortcut. Choose another")).toBeVisible();
  await page.locator("[data-experience-editor]").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "weren't saved" })).toBeVisible();
  await options(page).getByLabel("Keyboard shortcut").fill("ctrl+k");
  const sources = options(page).getByRole("list", { name: "Data sources" }).locator("li");
  await expect(sources.first()).toContainText("Applications");
  await options(page).getByRole("button", { name: "Move Accounts up" }).click();
  await expect(sources.first()).toContainText("Accounts");
});
