import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { addGroup, addItem, setDefault } from "../src/lib/onboarding/navigation";
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
const actions = (page: Page, label: string) => menuSection(page).getByRole("button", { name: `Actions for ${label}` });
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

  test("Adding an item: Payees under Payments shows at once and persists across reloads", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    registerApplication(db, { name: "Payee Hub", portal: access });
    await page.goto(navigationOf(access));
    await waitForHydration(page);

    await menuSection(page).getByRole("button", { name: "Add group" }).click();
    const groupDialog = page.getByRole("dialog", { name: "Add a menu group to Access" });
    await groupDialog.getByLabel("Label").fill("Payments");
    await groupDialog.getByRole("button", { name: "Add group" }).click();
    await expect(row(page, "Payments")).toBeVisible();

    await menuSection(page).getByRole("button", { name: "Add item" }).click();
    const itemDialog = page.getByRole("dialog", { name: "Add a menu item to Access" });
    await itemDialog.getByLabel("Label").fill("Payees");
    await itemDialog.getByLabel("Route").fill("/payees");
    await itemDialog.getByLabel("Application", { exact: true }).selectOption({ label: "Payee Hub (payee-hub)" });
    await itemDialog.getByLabel("Group").selectOption({ label: "Payments" });
    await itemDialog.getByRole("button", { name: "Add item" }).click();

    const payments = group(page, "Payments");
    await expect(payments.getByText("Payees", { exact: true })).toBeVisible();
    await page.reload();
    await expect(payments.getByText("Payees", { exact: true })).toBeVisible();
    await expect(row(page, "Payees")).toContainText("/payees");
    await expect(row(page, "Payees")).toContainText("Payee Hub");
  });

  test("Route collision: the save is refused at the route, naming the item that uses it", async ({ page, db }) => {
    const { access } = accessWithMenu(db);
    await page.goto(navigationOf(access));
    await waitForHydration(page);
    await menuSection(page).getByRole("button", { name: "Add item" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a menu item to Access" });
    await dialog.getByLabel("Label").fill("Payees again");
    await dialog.getByLabel("Route").fill("/payees");
    await dialog.getByLabel("Application", { exact: true }).selectOption({ label: "Payee Hub (payee-hub)" });
    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect(dialog.getByText("/payees is already used by Payees")).toBeVisible();
    await expect(dialog.getByLabel("Route")).toHaveAttribute("aria-invalid", "true");
    await expect(menuSection(page).locator("[data-kind]")).toHaveCount(2);
  });

  test("Application from another Portal: only the Portal's Applications are offered", async ({ page, db }) => {
    const markets = onboardPortal(db, "Markets");
    const access = onboardPortal(db, "Access");
    registerApplication(db, { name: "Ledger", portal: markets });
    registerApplication(db, { name: "Payroll", portal: access });
    await page.goto(navigationOf(markets));
    await waitForHydration(page);
    await menuSection(page).getByRole("button", { name: "Add item" }).click();
    const options = page.getByRole("dialog", { name: "Add a menu item to Markets" }).getByLabel("Application", { exact: true }).locator("option");
    await expect(options).toHaveText(["Choose an Application", "Ledger (ledger)"]);
  });

  test("Unplaced application: it's listed with Add to menu, which starts an item for it", async ({ page, db }) => {
    const markets = onboardPortal(db, "Markets");
    const ledger = registerApplication(db, { name: "Ledger", portal: markets });
    await page.goto(navigationOf(markets));
    await waitForHydration(page);
    const unplaced = page.getByRole("list", { name: "Applications not in the menu" });
    await expect(unplaced.getByRole("listitem")).toHaveText([/Ledger/]);
    await unplaced.getByRole("button", { name: "Add to menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a menu item to Markets" });
    await expect(dialog.getByLabel("Application", { exact: true })).toHaveValue(ledger.publicId);
    await dialog.getByLabel("Label").fill("Ledger");
    await dialog.getByLabel("Route").fill("/ledger");
    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect(row(page, "Ledger")).toContainText("/ledger");
    await expect(page.getByText("Every Application is in the menu")).toBeVisible();
  });

  test("Changing the default: the new item is marked Default and the old one isn't", async ({ page, db }) => {
    const { access } = accessWithMenu(db);
    await page.goto(navigationOf(access));
    await waitForHydration(page);
    await expect(row(page, "Payees")).toContainText("Default");
    await actions(page, "Activity").click();
    await menuSection(page).getByRole("button", { name: "Make default" }).click();
    await expect(row(page, "Activity")).toContainText("Default");
    await expect(row(page, "Payees")).not.toContainText("Default");
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

  test("History: changes are listed newest first, with the stated name marked Unverified", async ({ page, db, baseURL }) => {
    const access = onboardPortal(db, "Access");
    registerApplication(db, { name: "Payee Hub", portal: access });
    await page.context().addCookies([{ name: "fabricate-actor", value: "Ana", url: baseURL! }]);
    await page.goto(navigationOf(access));
    await waitForHydration(page);
    await menuSection(page).getByRole("button", { name: "Add item" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a menu item to Access" });
    await dialog.getByLabel("Label").fill("Payees");
    await dialog.getByLabel("Route").fill("/payees");
    await dialog.getByLabel("Application", { exact: true }).selectOption({ label: "Payee Hub (payee-hub)" });
    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect(row(page, "Payees")).toBeVisible();
    await actions(page, "Payees").click();
    await menuSection(page).getByRole("button", { name: "Make default" }).click();
    await expect(row(page, "Payees")).toContainText("Default");
    await header(page).getByRole("button", { name: "Promote to Production" }).click();
    await page.getByRole("dialog", { name: "Promote Access to Production?" }).getByRole("button", { name: "Promote to Production" }).click();
    await expect(header(page)).toContainText("Production");

    const rows = history(page).getByRole("row");
    await expect(rows.nth(1)).toContainText("Promoted to Production");
    await expect(rows.nth(2)).toContainText("Made Payees the default route");
    await expect(rows.nth(3)).toContainText("Added Payees at /payees");
    for (const index of [1, 2, 3]) {
      await expect(rows.nth(index)).toContainText("Ana");
      await expect(rows.nth(index)).toContainText("Unverified");
    }
  });

  test("Two editors: a rename based on an older version is refused, and the current menu shows", async ({ page, db }) => {
    const { access } = accessWithMenu(db, { defaultItem: false });
    const other = await page.context().newPage();
    await page.goto(navigationOf(access));
    await other.goto(navigationOf(access));
    await waitForHydration(page);
    await waitForHydration(other);

    await actions(other, "Payees").click();
    await menuSection(other).getByRole("link", { name: "Rename" }).click();
    const rename = other.locator("#menu-form");
    await expect(rename.getByLabel("Label")).toHaveValue("Payees");

    await actions(page, "Payees").click();
    await menuSection(page).getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog", { name: "Remove Payees?" }).getByRole("button", { name: "Remove" }).click();
    await expect(row(page, "Payees")).toHaveCount(0);

    await rename.getByLabel("Label").fill("Payees list");
    await rename.getByRole("button", { name: "Rename" }).click();
    await expect(other.getByText("Access changed since you opened it")).toBeVisible();
    await expect(row(other, "Payees")).toHaveCount(0);
    await expect(row(other, "Payees list")).toHaveCount(0);
    await expect(row(other, "Activity")).toBeVisible();
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

  test("Moving Payees: the page reloads with Activity moved up", async ({ page, db }) => {
    const { access } = accessWithMenu(db);
    await page.goto(navigationOf(access));
    const top = tree(page).locator(":scope > li");
    await expect(top.nth(0)).toContainText("Payees");
    await actions(page, "Activity").click();
    await menuSection(page).getByRole("button", { name: "Move up" }).click();
    await expect(page).toHaveURL(/notice=moved/);
    await expect(top.nth(0)).toContainText("Activity");
    await expect(top.nth(1)).toContainText("Payees");
  });

  test("Adding a group: Add group opens the form on the page", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    addGroup(db, access.publicId, { lockVersion: version(db, access), label: "Payments", parent: null }, ana);
    await page.goto(navigationOf(access));
    await menuSection(page).getByRole("link", { name: "Add group" }).click();
    const form = page.locator("#menu-form");
    await form.getByLabel("Label").fill("Cards");
    await form.getByLabel("Inside").selectOption({ label: "Payments" });
    await form.getByRole("button", { name: "Add group" }).click();
    const payments = group(page, "Payments");
    await expect(payments.getByText("Cards", { exact: true })).toBeVisible();
  });
});
