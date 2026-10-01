import type { Page } from "@playwright/test";
import { createProfile } from "../src/lib/demo/profiles";
import { WORKSPACE_COOKIE } from "../src/lib/demo/workspace-key";
import { ensureWorkspace } from "../src/lib/demo/workspaces";
import { openTool, waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** Session profiles: who is using a running application (template-demo/toolbar spec). */

const panel = (page: Page) => page.getByRole("dialog", { name: "Session" });
const profileRadio = (page: Page, name: string) => panel(page).getByRole("radio", { name: new RegExp(`^${name}\\b`) });
const shell = (page: Page) => page.locator('[data-demo-anchor="portal-session"]');
const approve = (page: Page) => page.locator('[data-demo-mfe="payment-activity"]').getByRole("button", { name: /^Approve / });

async function openSession(page: Page) {
  await openTool(page, "session");
  await expect(panel(page)).toBeVisible();
  return panel(page);
}

async function createPriya(page: Page, persona = "Approver") {
  const session = panel(page);
  await session.getByRole("button", { name: "New profile" }).click();
  const form = session.getByRole("form", { name: "New profile" });
  await expect(form.getByLabel("Name")).toBeFocused();
  await form.getByLabel("Name").fill("Priya Shah");
  await form.getByLabel("Persona").selectOption(persona);
  await form.getByLabel("Region").fill("Mumbai");
  await form.getByRole("button", { name: "Create profile" }).click();
  await expect(form).toBeHidden();
  await expect(session.getByRole("list", { name: "Your profiles" })).toContainText("Priya Shah");
}

/** Marks the page, so a test can tell it was not reloaded. */
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __marker: boolean }).__marker = true));
const marked = (page: Page) => page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker === true);

async function workspaceId(page: Page, db: Parameters<typeof ensureWorkspace>[0]) {
  const key = (await page.context().cookies()).find((cookie) => cookie.name === WORKSPACE_COOKIE)!.value;
  return ensureWorkspace(db, key).id;
}

test.beforeEach(async ({ page, db: _db }) => {
  await page.goto("/run/ref-payments-workspace");
  await waitForRegions(page);
});

test("lists the built-in profiles in a new workspace, with Jordan Lee active and none editable", async ({ page }) => {
  const session = await openSession(page);
  const radios = session.getByRole("radiogroup", { name: "Signed in as" }).or(session.getByRole("group", { name: "Signed in as" })).getByRole("radio");
  await expect(radios).toHaveCount(3);
  expect(await radios.evaluateAll((inputs) => inputs.map((input) => input.closest("label")?.textContent?.trim()))).toEqual([
    "Jordan LeeAnalyst · London · Built-in",
    "Sam RiveraApprover · New York · Built-in",
    "Alex MorganAdministrator · Singapore · Built-in",
  ]);
  await expect(profileRadio(page, "Jordan Lee")).toBeChecked();
  await expect(session.getByRole("button", { name: /^(Edit|Delete) / })).toHaveCount(0);
  await expect(session.getByRole("list", { name: "Your profiles" })).toHaveCount(0);
});

test("creates a profile and signs it in, updating the portal without a reload", async ({ page }) => {
  await mark(page);
  await expect(approve(page)).toHaveCount(0);
  await openSession(page);
  await createPriya(page);
  await profileRadio(page, "Priya Shah").check();
  await expect(shell(page)).toContainText("Priya Shah");
  await expect(shell(page)).toContainText("Approver · Mumbai");
  await expect(approve(page).first()).toBeVisible();
  expect(await marked(page)).toBe(true);

  // The shell keeps the profile after a reload.
  await page.reload();
  await waitForRegions(page);
  await expect(shell(page)).toContainText("Priya Shah");
});

test("offers a visitor's profiles in every application, after the built-in profiles", async ({ page }) => {
  await openSession(page);
  await createPriya(page);
  await page.goto("/run/ref-market-watch");
  await waitForRegions(page);
  const session = await openSession(page);
  const names = await session.getByRole("radio").evaluateAll((inputs) => inputs.map((input) => input.closest("label")?.querySelector("span span")?.textContent));
  expect(names).toEqual(["Jordan Lee", "Sam Rivera", "Alex Morgan", "Priya Shah"]);
});

test("applies an edit to the active profile at once", async ({ page }) => {
  await mark(page);
  await openSession(page);
  await createPriya(page);
  await profileRadio(page, "Priya Shah").check();
  await expect(approve(page).first()).toBeVisible();

  await panel(page).getByRole("button", { name: "Edit Priya Shah" }).click();
  const form = panel(page).getByRole("form", { name: "Edit Priya Shah" });
  await expect(form.getByLabel("Name")).toHaveValue("Priya Shah");
  await form.getByLabel("Persona").selectOption("Analyst");
  await form.getByRole("button", { name: "Save profile" }).click();
  await expect(form).toBeHidden();
  await expect(approve(page)).toHaveCount(0);
  await expect(shell(page)).toContainText("Analyst · Mumbai");
  expect(await marked(page)).toBe(true);
});

test("falls back to Jordan Lee when the active profile is deleted, and undoes the deletion", async ({ page }) => {
  await openSession(page);
  await createPriya(page);
  await profileRadio(page, "Priya Shah").check();
  await expect(shell(page)).toContainText("Priya Shah");

  await panel(page).getByRole("button", { name: "Delete Priya Shah" }).click();
  await expect(profileRadio(page, "Jordan Lee")).toBeChecked();
  await expect(profileRadio(page, "Priya Shah")).toHaveCount(0);
  await expect(panel(page).getByRole("list", { name: "Your profiles" })).toHaveCount(0);
  await expect(shell(page)).toContainText("Jordan Lee");
  const toast = page.getByRole("region", { name: "Notifications" }).getByRole("listitem").filter({ hasText: "Deleted Priya Shah" });
  await expect(toast).toBeVisible();

  // Undo brings the profile back, still signed in.
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(shell(page)).toContainText("Priya Shah");
  await expect(profileRadio(page, "Priya Shah")).toBeChecked();
});

test("refuses a name another profile has, ignoring case", async ({ page }) => {
  const session = await openSession(page);
  await session.getByRole("button", { name: "New profile" }).click();
  const form = session.getByRole("form", { name: "New profile" });
  await form.getByLabel("Name").fill("sam rivera");
  await form.getByLabel("Region").fill("Lisbon");
  await form.getByRole("button", { name: "Create profile" }).click();
  await expect(form.getByLabel("Name")).toHaveAccessibleDescription("A profile with that name already exists");
  await expect(form.getByLabel("Name")).toBeFocused();
  await expect(session.getByRole("list", { name: "Your profiles" })).toHaveCount(0);

  // Empty fields are explained beside each field.
  await form.getByLabel("Name").fill("");
  await form.getByLabel("Region").fill(" ");
  await form.getByRole("button", { name: "Create profile" }).click();
  await expect(form.getByLabel("Name")).toHaveAccessibleDescription("Enter a name");
  await expect(form.getByLabel("Region")).toHaveAccessibleDescription("Enter a region");
});

test("refuses a 21st profile with a message suggesting a deletion", async ({ page, db }) => {
  const workspace = await workspaceId(page, db);
  for (let index = 0; index < 20; index++) createProfile(db, workspace, { name: `Visitor ${index + 1}`, persona: "Analyst", region: "London" });
  await page.reload();
  await waitForRegions(page);
  const session = await openSession(page);
  await expect(session.getByRole("list", { name: "Your profiles" }).getByRole("listitem")).toHaveCount(20);
  await session.getByRole("button", { name: "New profile" }).click();
  const form = session.getByRole("form", { name: "New profile" });
  await form.getByLabel("Name").fill("Priya Shah");
  await form.getByLabel("Region").fill("Mumbai");
  await form.getByRole("button", { name: "Create profile" }).click();
  await expect(form.getByRole("alert")).toContainText("You have 20 custom profiles, the most a demo workspace can hold. Delete a profile to create another.");
  await expect(form.getByRole("alert")).toBeFocused();
});

test("opens Session with the P key, with focus inside", async ({ page }) => {
  await page.keyboard.press("p");
  await expect(panel(page)).toBeVisible();
  expect(await panel(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
});

test("shows the visitor's profile in the shell with its persona and region", async ({ page, db }) => {
  const priya = createProfile(db, await workspaceId(page, db), { name: "Priya Shah", persona: "Approver", region: "Mumbai" });
  const key = await page.locator("[data-demo-view-key]").getAttribute("data-demo-view-key");
  await page.evaluate(([storageKey, value]) => window.localStorage.setItem(storageKey!, value!), [`fabricate-demo:${key}:view`, JSON.stringify({ theme: "light", profileId: priya.id, overrides: {} })]);
  await page.reload();
  await waitForRegions(page);
  // The descriptor carries the visitor's profiles, so the profile shows once the stored view applies, without a fetch.
  await expect(shell(page)).toContainText("Priya Shah");
  await expect(shell(page)).toContainText("Approver · Mumbai");
  await shell(page).getByRole("button", { name: "Priya Shah Approver · Mumbai" }).click();
  await expect(shell(page)).toContainText("Change it in the toolbar's Session tool.");
});

test("leaves Settings with the theme and the event bus only", async ({ page }) => {
  await openTool(page, "settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("radio", { name: "Dark" })).toBeVisible();
  await expect(settings.getByText("Event bus")).toBeVisible();
  await expect(settings.getByRole("radio", { name: /Sam Rivera/ })).toHaveCount(0);
});

test("removes custom profiles when the demo is reset", async ({ page }) => {
  await openSession(page);
  await createPriya(page);
  await profileRadio(page, "Priya Shah").check();

  await page.goto("/new");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset the demo?" });
  await expect(dialog).toContainText("session profiles");
  await dialog.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("The demo was reset.")).toBeVisible();

  await page.goto("/run/ref-payments-workspace");
  await waitForRegions(page);
  const session = await openSession(page);
  await expect(session.getByRole("radio")).toHaveCount(3);
  await expect(profileRadio(page, "Jordan Lee")).toBeChecked();
  await expect(shell(page)).toContainText("Jordan Lee");
});
