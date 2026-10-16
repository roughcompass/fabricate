import type { BrowserContext, Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { demoApplications, demoThreads } from "../src/lib/db/schema";
import { templateBySlug } from "../src/lib/demo/catalog";
import { createApplication, validateDeployInput } from "../src/lib/demo/deployments";
import { createShare, findShare } from "../src/lib/demo/shares";
import { WORKSPACE_COOKIE } from "../src/lib/demo/workspace-key";
import { ensureWorkspace } from "../src/lib/demo/workspaces";
import { determineRendering, registerApplication } from "../test/support/applications";
import { onboardPortal } from "../test/support/onboarding";
import { expect, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

// web-onboarding/application-catalog spec: the Applications page and the
// header's application switcher; template-demo/deployments spec: the
// visitor's demo deployments among them while the demo is enabled. The
// demo-off cases are in e2e/demo-off/.

const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });
const header = (page: Page) => page.locator("[data-page-header]");
const grid = (page: Page) => page.getByRole("list", { name: "Applications" });
const card = (page: Page, name: string) => page.locator("article", { has: page.getByRole("link", { name, exact: true }) });
const search = (page: Page) => page.getByRole("searchbox", { name: "Search Applications" });
const switcher = (page: Page) => page.locator("[data-shell-header]").getByRole("button", { name: /^Switch Application, current: / });
const switcherList = (page: Page) => page.locator("[data-shell-header] [popover]").getByRole("list", { name: "Switch Application" });

/** The browser's demo workspace, which the fixtures create with guided hints off. */
async function workspaceOf(context: BrowserContext, db: Db) {
  const key = (await context.cookies()).find((cookie) => cookie.name === WORKSPACE_COOKIE)!.value;
  return ensureWorkspace(db, key);
}
const sandbox = (name: string) => validateDeployInput({ name, environment: "sandbox", project: "", repository: "" });

/** Access with Payee Hub, and Markets with Ledger, a Module Federation application. */
function twoPortals(db: Db) {
  const access = onboardPortal(db, "Access");
  const markets = onboardPortal(db, "Markets");
  const payeeHub = registerApplication(db, { name: "Payee Hub", portal: access, sealId: "88001" });
  const ledger = registerApplication(db, { name: "Ledger", portal: markets, sealId: "1042" });
  determineRendering(db, ledger, "module_federation_2");
  return { access, markets, payeeHub, ledger };
}

test.describe("registered Applications", () => {
  test("Card content: the name, repository with its provider, Portal with its badge, assessment, and rendering", async ({ page, db }) => {
    twoPortals(db);
    await page.goto("/applications");
    await expect(page).toHaveTitle("Applications · DE FabLab");
    const payeeHub = card(page, "Payee Hub");
    await expect(payeeHub).toContainText("acme/payee-hub");
    await expect(payeeHub.getByRole("img", { name: "GitHub" })).toBeVisible();
    await expect(payeeHub).toContainText("Access");
    await expect(payeeHub).toContainText("Prototype");
    await expect(payeeHub).toContainText("Not assessed");
    await expect(payeeHub).toContainText("Not determined yet");
    await expect(card(page, "Ledger")).toContainText("Module Federation");
    await payeeHub.getByRole("link", { name: "Payee Hub" }).click();
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Payee Hub");
  });

  test("List view: the same Applications as rows, kept in the address", async ({ page, db }) => {
    twoPortals(db);
    await page.goto("/applications");
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
    await expect(page).toHaveURL(/view=list/);
    const rows = page.getByRole("table", { name: "Applications" }).locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Ledger" })).toContainText("Markets");
    await page.reload();
    await expect(page.getByRole("table", { name: "Applications" })).toBeVisible();
  });

  test("Search by SEAL ID, with the / shortcut, and a no-match Clear", async ({ page, db }) => {
    twoPortals(db);
    await page.goto("/applications");
    await waitForHydration(page);
    await page.locator("body").press("/");
    await expect(search(page)).toBeFocused();
    await search(page).fill("1042");
    await search(page).press("Enter");
    await expect(page).toHaveURL(/q=1042/);
    await expect(grid(page).getByRole("listitem")).toHaveCount(1);
    await expect(card(page, "Ledger")).toBeVisible();

    await search(page).fill("zzz");
    await search(page).press("Enter");
    await expect(page.getByText("No applications match")).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Clear", exact: true }).click();
    await expect(grid(page).getByRole("listitem")).toHaveCount(2);
  });

  test("Filter: Module Federation leaves only Ledger, kept in the address", async ({ page, db }) => {
    twoPortals(db);
    await page.goto("/applications");
    await waitForHydration(page);
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("checkbox", { name: /^Module Federation/ }).check();
    await expect(page).toHaveURL(/rendering=module_federation_2/);
    await expect(grid(page).getByRole("listitem")).toHaveCount(1);
    await expect(card(page, "Ledger")).toBeVisible();
    await expect(page.getByRole("button", { name: "Filter, 1 active" })).toBeVisible();
  });

  test("Markets scope: the current Portal scopes the page, and portal=all shows every Portal", async ({ page, db, baseURL }) => {
    const { markets } = twoPortals(db);
    await page.context().addCookies([{ name: "fabricate-portal", value: markets.publicId, url: baseURL! }]);
    await page.goto("/applications");
    await expect(header(page)).toContainText("Applications registered in Markets, the current Portal.");
    await expect(grid(page).getByRole("listitem")).toHaveCount(1);
    await expect(card(page, "Ledger")).toBeVisible();
    await page.goto("/applications?portal=all");
    await expect(header(page)).toContainText("Applications registered in every Portal.");
    await expect(grid(page).getByRole("listitem")).toHaveCount(2);
  });

  test("Empty state: No applications yet, with Add application; Add application is the only primary action, with no import", async ({ page, db: _db }) => {
    await page.goto("/applications");
    await expect(page.getByText("No applications yet")).toBeVisible();
    await expect(header(page).locator('[data-variant="primary"]')).toHaveCount(1);
    await expect(header(page).getByRole("link", { name: "Add application" })).toHaveAttribute("data-variant", "primary");
    await expect(page.getByRole("link", { name: "Import from BitBucket" })).toHaveCount(0);
    await header(page).getByRole("link", { name: "Add application" }).click();
    await expect(page).toHaveURL(/\/applications\/new$/);
  });
});

test.describe("the application switcher", () => {
  test("Switching, filtering, and Escape: All Applications first, then the Applications, and Create Application last", async ({ page, db }) => {
    const { ledger } = twoPortals(db);
    await page.goto("/applications");
    await waitForHydration(page);
    await expect(switcher(page)).toHaveAccessibleName("Switch Application, current: All Applications");
    await switcher(page).click();
    await expect(switcherList(page).getByRole("link")).toHaveText([/All Applications/, /Ledger|Payee Hub/, /Ledger|Payee Hub/]);
    const filter = page.locator("[data-shell-header] [popover]").getByRole("searchbox", { name: "Find Application…" });
    await expect(filter).toBeFocused();
    await filter.fill("led");
    await expect(switcherList(page).getByRole("link")).toHaveText([/All Applications/, /Ledger/]);
    await page.keyboard.press("Escape");
    await expect(switcherList(page)).toBeHidden();
    await expect(switcher(page)).toBeFocused();

    await switcher(page).click();
    await switcherList(page).getByRole("link", { name: /Ledger/ }).click();
    await expect(page).toHaveURL(new RegExp(`/applications/${ledger.publicId}$`));
    await expect(switcher(page)).toHaveAccessibleName("Switch Application, current: Ledger");

    await switcher(page).click();
    await page.locator("[data-shell-header] [popover]").getByRole("link", { name: /^Create Application/ }).click();
    await expect(page).toHaveURL(/\/applications\/new$/);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("Entries are links: choosing Ledger opens its dashboard", async ({ page, db }) => {
      const { ledger } = twoPortals(db);
      await page.goto("/applications");
      await switcher(page).click();
      await switcherList(page).getByRole("link", { name: /Ledger/ }).click();
      await expect(page).toHaveURL(new RegExp(`/applications/${ledger.publicId}$`));
    });
  });
});

test.describe("demo deployments", () => {
  test("Demo cards: the visitor's deployments among the Applications, newest first, with a Demo mark and Visit", async ({ page, context, db }) => {
    const workspace = await workspaceOf(context, db);
    twoPortals(db);
    createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Older desk"), new Date(Date.now() - 60 * 60 * 1000));
    createApplication(db, workspace.id, templateBySlug("payments-workspace")!, sandbox("Newer payments"), new Date(Date.now() + 60 * 1000));

    await page.goto("/applications");
    const items = grid(page).getByRole("listitem");
    await expect(items).toHaveCount(4);
    await expect(items.first()).toContainText("Newer payments");
    const older = page.locator("[data-demo-deployment]", { hasText: "Older desk" });
    await expect(older).toContainText("Demo");
    await expect(older).toContainText("Market watch template");
    await older.getByRole("button", { name: "Actions for Older desk" }).click();
    await expect(page.getByRole("link", { name: /^Visit/ })).toHaveAttribute("target", "_blank");
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Newer payments", exact: true }).click();
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Newer payments");
    await expect(page.locator("[data-page-header]").getByRole("navigation", { name: "Breadcrumb" }).getByRole("link")).toHaveText(["Applications"]);
  });

  test("Visit while building: Visit is unavailable until the build is ready", async ({ page, context, db }) => {
    const workspace = await workspaceOf(context, db);
    createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Fresh desk"));
    await page.goto("/applications");
    await page.getByRole("button", { name: "Actions for Fresh desk" }).click();
    await expect(page.getByRole("button", { name: /^Visit/ })).toBeDisabled();
    await expect(page.getByRole("link", { name: /^Visit/ })).toHaveCount(0);
  });

  test("does not show another visitor's deployment", async ({ page, context, browser, db }) => {
    const workspace = await workspaceOf(context, db);
    const application = createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Private desk"));

    const other = await browser.newContext();
    const stranger = await other.newPage();
    await stranger.goto("/applications");
    await expect(stranger.getByText("No applications yet")).toBeVisible();
    const response = await stranger.goto(`/applications/${application.publicId}`);
    expect(response?.status()).toBe(404);
    await other.close();
    await page.goto("/applications");
    await expect(card(page, "Private desk")).toBeVisible();
  });

  test("Delete removes the deployment and its share link after confirmation", async ({ page, context, db }) => {
    const workspace = await workspaceOf(context, db);
    const application = createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Shared desk"));
    const token = createShare(db, { applicationId: application.id }, workspace.id, { route: "watch", overrides: {}, theme: "light", persona: "analyst" });

    await page.goto("/applications");
    await page.getByRole("button", { name: "Actions for Shared desk" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Shared desk?" });
    await expect(dialog).toContainText("Its comments and share links are removed too.");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Delete deployment" }).click();

    await expect(toasts(page).getByText(/was deleted/)).toBeVisible();
    await expect(page.getByText("No applications yet")).toBeVisible();
    expect(findShare(db, token)).toBeNull();
    expect((await page.request.get(`/s/${token}`)).status()).toBe(404);
  });

  test("Reset demo on Add application removes the visitor's deployments, leaving registered Applications", async ({ page, context, db }) => {
    const workspace = await workspaceOf(context, db);
    twoPortals(db);
    createApplication(db, workspace.id, templateBySlug("market-watch")!, sandbox("Demo desk"));
    db.insert(demoThreads)
      .values({ publicId: "thr_aaaaaaaaaaaaaaaa", referenceSlug: "market-watch", viewWorkspaceId: workspace.id, route: "watch", member: "watchlist", memberVersion: "1.8.0", anchor: "filter", offsetX: 0.5, offsetY: 0.5, createdAt: new Date() })
      .run();

    await page.goto("/applications/new");
    await waitForHydration(page);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Reset demo" }).click();
    const dialog = page.getByRole("dialog", { name: "Reset the demo?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(db.select().from(demoApplications).all()).toHaveLength(1);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Reset demo" }).click();
    await dialog.getByRole("button", { name: "Reset demo" }).click();
    await expect(toasts(page).getByText("The demo was reset.")).toBeVisible();
    await expect(page).toHaveURL(/\/applications\/new$/);
    expect(db.select().from(demoApplications).all()).toEqual([]);
    expect(db.select().from(demoThreads).all()).toEqual([]);

    await page.goto("/applications");
    await expect(grid(page).getByRole("listitem")).toHaveCount(2);
  });
});
