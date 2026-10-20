import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { addItem, setDefault } from "../src/lib/onboarding/navigation";
import { type Portal, getPortal, promotePortal } from "../src/lib/onboarding/portals";
import { registerApplication } from "../test/support/applications";
import { ana, onboardPortal } from "../test/support/onboarding";
import { expect, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

// web-onboarding/navigation spec: the Navigation list and a Portal's Navigation page.

const heading = (page: Page, name: string) => page.locator("[data-shell-header]").getByRole("heading", { level: 1, name });
const header = (page: Page) => page.locator("[data-page-header]");
const menuSection = (page: Page) => page.locator("#menu");
const tree = (page: Page) => menuSection(page).getByRole("list", { name: "Menu" });
/** A menu entry's own row: its label, route, Application, and actions, without what a group holds. */
const row = (page: Page, label: string) => menuSection(page).locator("[data-kind]").filter({ has: page.getByText(label, { exact: true }) });
/** A group's list item, holding what's in it. */
const group = (page: Page, label: string) => tree(page).locator("li").filter({ has: page.locator("[data-kind]").filter({ has: page.getByText(label, { exact: true }) }) });
/** An entry's row in the editor's menu page. */
const editorEntry = (page: Page, label: string) => page.locator(`[data-entry="${label}"]`);
const pending = (page: Page) => page.locator("[data-pending-count]");
async function saveEditor(page: Page) {
  await page.locator("[data-experience-editor]").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText(/Version \d+ is saved\./);
}
const history = (page: Page) => page.getByRole("table", { name: "History" });

const version = (db: Db, portal: Portal) => getPortal(db, portal.publicId).lockVersion;

/** Access with Payee Hub and Activity Feed registered, and a top-level item for each. */
function accessWithMenu(db: Db, { defaultItem = true } = {}) {
  const access = onboardPortal(db, "Access");
  const payeeHub = registerApplication(db, { name: "Payee Hub", portal: access });
  const activityFeed = registerApplication(db, { name: "Activity Feed", portal: access });
  const payees = addItem(db, access.publicId, { lockVersion: version(db, access), label: "Payees", route: "/payees", application: payeeHub.publicId, parent: null }, ana);
  addItem(db, access.publicId, { lockVersion: version(db, access), label: "Activity", route: "/activity", application: activityFeed.publicId, parent: null }, ana);
  if (defaultItem) setDefault(db, access.publicId, { lockVersion: version(db, access), entry: payees.publicId }, ana);
  return { access, payeeHub, activityFeed };
}

const navigationOf = (portal: Portal) => `/navigation/${portal.publicId}`;
const menuEditorOf = (portal: Portal) => `/navigation/${portal.publicId}/editor/menu`;

test.describe("the Navigation list", () => {
  test("Portal current: Navigation opens the current Portal's page", async ({ page, db, baseURL }) => {
    const access = onboardPortal(db, "Access");
    onboardPortal(db, "Markets");
    await page.context().addCookies([{ name: "fabricate-portal", value: access.publicId, url: baseURL! }]);
    await page.goto("/navigation");
    await expect(page).toHaveURL(navigationOf(access));
    await expect(heading(page, "Access")).toBeVisible();
  });

  test("All Portals: every Portal is listed with its badge, and choosing one opens its page", async ({ page, db }) => {
    onboardPortal(db, "Access");
    const markets = onboardPortal(db, "Markets");
    await page.goto("/navigation");
    const table = page.getByRole("table", { name: "Portals" });
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table.getByRole("row", { name: /Access/ })).toContainText("Prototype");
    await table.getByRole("link", { name: "Markets" }).click();
    await expect(page).toHaveURL(navigationOf(markets));
  });

  test("Production tab: only Portals in Production are listed, and the address records the tab", async ({ page, db }) => {
    const { access } = accessWithMenu(db);
    promotePortal(db, access.publicId, { lockVersion: version(db, access) }, ana);
    onboardPortal(db, "Markets");
    await page.goto("/navigation?portal=all");
    await page.getByRole("link", { name: /^Production/ }).click();
    await expect(page).toHaveURL(/tab=production/);
    const table = page.getByRole("table", { name: "Portals" });
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table.getByRole("row", { name: /Access/ })).toContainText("Production");
  });

  test("portal=all lists every Portal even with one current", async ({ page, db, baseURL }) => {
    const access = onboardPortal(db, "Access");
    onboardPortal(db, "Markets");
    await page.context().addCookies([{ name: "fabricate-portal", value: access.publicId, url: baseURL! }]);
    await page.goto("/navigation?portal=all");
    await expect(page).toHaveURL(/\/navigation\?portal=all$/);
    await expect(page.getByRole("table", { name: "Portals" }).getByRole("row")).toHaveCount(3);
  });
});

test.describe("a Portal's Navigation page", () => {
  test("Details: the header shows the lifecycle badge, and the details its identity", async ({ page, db }) => {
    const access = onboardPortal(db, "Access", { sealId: "1042", ownerTeam: "Access Platform", description: "Sign-in and entitlements" });
    await page.goto(navigationOf(access));
    await expect(heading(page, "Access")).toBeVisible();
    await expect(header(page)).toContainText("Prototype");
    const details = page.getByRole("definition");
    await expect(details).toContainText(["1042", "Web", "access", "Access Platform", "Sign-in and entitlements"]);
  });

  test("Adding an item: Payees under Payments is pending in the menu editor, and saving shows it on the Navigation page", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    registerApplication(db, { name: "Payee Hub", portal: access });
    await page.goto(navigationOf(access));
    await menuSection(page).getByRole("link", { name: "Edit menu" }).click();
    await expect(page).toHaveURL(new RegExp(`${menuEditorOf(access)}$`));
    await waitForHydration(page);

    await page.getByRole("button", { name: "Add group" }).click();
    const groupPanel = page.getByRole("complementary", { name: "Add a menu group" });
    await groupPanel.getByLabel("Label").fill("Payments");
    await groupPanel.getByRole("button", { name: "Add group" }).click();
    await page.getByRole("button", { name: "Add item" }).click();
    const itemPanel = page.getByRole("complementary", { name: "Add a menu item" });
    await itemPanel.getByLabel("Label").fill("Payees");
    await itemPanel.getByLabel("Route").fill("/payees");
    await itemPanel.getByLabel("Application", { exact: true }).selectOption({ label: "Payee Hub (payee-hub)" });
    await itemPanel.getByLabel("Group").selectOption({ label: "Payments" });
    await itemPanel.getByRole("button", { name: "Add item" }).click();
    await expect(editorEntry(page, "Payees")).toBeVisible();
    await expect(pending(page)).toHaveText("2 unsaved changes");
    await saveEditor(page);

    await page.goto(navigationOf(access));
    await expect(group(page, "Payments").getByText("Payees", { exact: true })).toBeVisible();
    await page.reload();
    await expect(row(page, "Payees")).toContainText("/payees");
    await expect(row(page, "Payees")).toContainText("Payee Hub");
  });

  test("Route collision: the new item is refused at its route, naming the item that uses it", async ({ page, db }) => {
    const { access } = accessWithMenu(db);
    await page.goto(menuEditorOf(access));
    await waitForHydration(page);
    await page.getByRole("button", { name: "Add item" }).click();
    const panel = page.getByRole("complementary", { name: "Add a menu item" });
    await panel.getByLabel("Label").fill("Payees again");
    await panel.getByLabel("Route").fill("/payees");
    await panel.getByLabel("Application", { exact: true }).selectOption({ label: "Payee Hub (payee-hub)" });
    await panel.getByRole("button", { name: "Add item" }).click();
    await expect(panel.getByText("/payees is already used by Payees")).toBeVisible();
    await expect(panel.getByLabel("Route")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("[data-entry]")).toHaveCount(2);
    await expect(pending(page)).toHaveCount(0);
  });

  test("Application from another Portal: only the Portal's Applications are offered", async ({ page, db }) => {
    const markets = onboardPortal(db, "Markets");
    const access = onboardPortal(db, "Access");
    registerApplication(db, { name: "Ledger", portal: markets });
    registerApplication(db, { name: "Payroll", portal: access });
    await page.goto(menuEditorOf(markets));
    await waitForHydration(page);
    await page.getByRole("button", { name: "Add item" }).click();
    const options = page.getByRole("complementary", { name: "Add a menu item" }).getByLabel("Application", { exact: true }).locator("option");
    await expect(options).toHaveText(["Choose an Application", "Ledger (ledger)"]);
  });

  test("Unplaced application: Add to menu opens the menu editor with an item started for it", async ({ page, db }) => {
    const markets = onboardPortal(db, "Markets");
    const ledger = registerApplication(db, { name: "Ledger", portal: markets });
    await page.goto(navigationOf(markets));
    const unplaced = page.getByRole("list", { name: "Applications not in the menu" });
    await expect(unplaced.getByRole("listitem")).toHaveText([/Ledger/]);
    await unplaced.getByRole("link", { name: "Add to menu" }).click();
    await waitForHydration(page);
    const panel = page.getByRole("complementary", { name: "Add a menu item" });
    await expect(panel.getByLabel("Application", { exact: true })).toHaveValue(ledger.publicId);
    await expect(panel.getByLabel("Route")).toHaveValue("/ledger");
    await panel.getByRole("button", { name: "Add item" }).click();
    await saveEditor(page);
    await page.goto(navigationOf(markets));
    await expect(row(page, "Ledger")).toContainText("/ledger");
    await expect(page.getByText("Every Application is in the menu")).toBeVisible();
  });

  test("Changing the default: the new item is marked Default and the old one isn't, once saved", async ({ page, db }) => {
    const { access } = accessWithMenu(db);
    await page.goto(menuEditorOf(access));
    await waitForHydration(page);
    await expect(editorEntry(page, "Payees")).toContainText("Default");
    await editorEntry(page, "Activity").getByRole("button", { name: "Make default" }).click();
    await expect(editorEntry(page, "Activity")).toContainText("Default");
    await expect(editorEntry(page, "Payees")).not.toContainText("Default");
    await saveEditor(page);
    await page.goto(navigationOf(access));
    await expect(row(page, "Activity")).toContainText("Default");
    await expect(row(page, "Payees")).not.toContainText("Default");
  });

  test("Flyout menu: the menu type moves the menu out of the sidebar in the preview", async ({ page, db }) => {
    const { access } = accessWithMenu(db);
    await page.goto(`/navigation/${access.publicId}/editor/frame-zones`);
    await waitForHydration(page);
    await page.locator("[data-zone-row='sidebar'] [data-slot-row='main']").getByRole("button", { name: "Main Slot", exact: true }).click();
    const options = page.getByRole("region", { name: "Options", exact: true });
    await expect(options.locator("[data-menu-count]")).toHaveText("2 top-level items configured");
    await expect(page.locator("[data-frame-preview] [data-zone='sidebar']")).toBeVisible();
    await options.getByLabel("Menu type").selectOption("flyout");
    await expect(page.locator("[data-frame-preview] [data-zone='sidebar']")).toHaveCount(0);
  });

  test("Promoting: the Production badge shows in the header, the switcher, and Applications cards", async ({ page, db, baseURL }) => {
    const { access } = accessWithMenu(db);
    await page.context().addCookies([{ name: "fabricate-portal", value: access.publicId, url: baseURL! }]);
    await page.goto(navigationOf(access));
    await waitForHydration(page);
    await header(page).getByRole("button", { name: "Promote to Production" }).click();
    const confirm = page.getByRole("dialog", { name: "Promote Access to Production?" });
    await confirm.getByRole("button", { name: "Promote to Production" }).click();
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("Access is in Production.")).toBeVisible();
    await expect(header(page)).toContainText("Production");
    await expect(page.locator("#sidebar").getByRole("button", { name: /^Switch Portal, current: / })).toHaveAccessibleName("Switch Portal, current: Access, Production");
    await expect(header(page).getByRole("button", { name: "Return to Prototype" })).toBeVisible();

    await page.goto("/applications");
    await expect(page.locator("article", { has: page.getByRole("link", { name: "Payee Hub" }) })).toContainText("Production");
  });

  test("No default route: Promote to Production is unavailable, and the page says why", async ({ page, db }) => {
    const { access } = accessWithMenu(db, { defaultItem: false });
    await page.goto(navigationOf(access));
    await expect(header(page).getByRole("button", { name: "Promote to Production" })).toBeDisabled();
    await expect(header(page)).toContainText("Needs a default route first");
    await expect(page.getByText("Access has no default route")).toBeVisible();
  });

  test("History: a saved version and a promotion are listed newest first, with the stated name marked Unverified", async ({ page, db, baseURL }) => {
    const access = onboardPortal(db, "Access");
    registerApplication(db, { name: "Payee Hub", portal: access });
    await page.context().addCookies([{ name: "fabricate-actor", value: "Ana", url: baseURL! }]);
    await page.goto(menuEditorOf(access));
    await waitForHydration(page);
    await page.getByRole("button", { name: "Add item" }).click();
    const panel = page.getByRole("complementary", { name: "Add a menu item" });
    await panel.getByLabel("Label").fill("Payees");
    await panel.getByLabel("Route").fill("/payees");
    await panel.getByLabel("Application", { exact: true }).selectOption({ label: "Payee Hub (payee-hub)" });
    await panel.getByRole("button", { name: "Add item" }).click();
    await editorEntry(page, "Payees").getByRole("button", { name: "Make default" }).click();
    await saveEditor(page);
    await page.goto(navigationOf(access));
    await waitForHydration(page);
    await header(page).getByRole("button", { name: "Promote to Production" }).click();
    await page.getByRole("dialog", { name: "Promote Access to Production?" }).getByRole("button", { name: "Promote to Production" }).click();
    await expect(header(page)).toContainText("Production");

    const rows = history(page).getByRole("row");
    await expect(rows.nth(1)).toContainText("Promoted to Production");
    await expect(rows.nth(2)).toContainText("Experience saved");
    await expect(rows.nth(2)).toContainText("Saved version 1");
    await expect(rows.nth(2)).toContainText("added Payees /payees");
    for (const index of [1, 2]) {
      await expect(rows.nth(index)).toContainText("Ana");
      await expect(rows.nth(index)).toContainText("Unverified");
    }
  });

  test("Two editors: a rename saved after another save is refused, and the second editor's changes are kept", async ({ page, db }) => {
    const { access } = accessWithMenu(db, { defaultItem: false });
    const other = await page.context().newPage();
    await page.goto(menuEditorOf(access));
    await other.goto(menuEditorOf(access));
    await waitForHydration(page);
    await waitForHydration(other);

    await editorEntry(page, "Payees").getByRole("button", { name: "Remove Payees" }).click();
    await saveEditor(page);

    await editorEntry(other, "Payees").getByRole("button", { name: "Edit Payees" }).click();
    await other.getByRole("complementary", { name: "Edit Payees" }).getByLabel("Label").fill("Payees list");
    await other.locator("[data-experience-editor]").getByRole("button", { name: "Save", exact: true }).click();
    await expect(other.getByRole("alert").filter({ hasText: "Access changed since you opened it" })).toBeVisible();
    await expect(pending(other)).toHaveText("1 unsaved change");
    await page.goto(navigationOf(access));
    await expect(row(page, "Payees")).toHaveCount(0);
    await expect(row(page, "Activity")).toBeVisible();
  });

  test("Edit details: the owning team and description are saved in place", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await page.goto(navigationOf(access));
    await page.getByRole("link", { name: "Edit details" }).click();
    await expect(heading(page, "Edit details")).toBeVisible();
    await expect(page.getByText("The platform Web and the slug access don't change.")).toBeVisible();
    await page.getByLabel("Owning team").fill("Identity Platform");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(new RegExp(`${navigationOf(access)}`));
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("The details are saved.")).toBeVisible();
    await expect(page.getByRole("definition")).toContainText(["Identity Platform"]);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("The Navigation page shows the saved menu, and the experience editor says it needs JavaScript", async ({ page, db }) => {
    const { access } = accessWithMenu(db);
    await page.goto(navigationOf(access));
    const top = tree(page).locator(":scope > li");
    await expect(top.nth(0)).toContainText("Payees");
    await expect(top.nth(1)).toContainText("Activity");
    await page.goto(menuEditorOf(access));
    expect(await page.content()).toContain("The experience editor needs JavaScript.");
  });
});
