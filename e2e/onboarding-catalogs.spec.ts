import type { Page } from "@playwright/test";
import { createWebApplication } from "../src/lib/onboarding/applications";
import { createPortal } from "../src/lib/onboarding/portals";
import { buildSource } from "../test/support/builders";
import { ana, decide, onboardApplication, onboardPortal, placementsOf, registerMfe } from "../test/support/onboarding";
import { expect, expectNoHorizontalOverflow, expectNoNestedBorders, test } from "./support/fixtures";
import { expectCurrentItem, waitForHydration } from "./support/shell";

/*
 * The Web Onboarding catalogs and records as a whole: the navigation section,
 * the list pages' URL filters, record titles and IDs, the shared actions'
 * refusals, and the not-found, loading, and error states at both widths.
 */

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

test("marks Web Onboarding and the record's catalog current on deep pages, with MFE assets under Web Applications (Web Onboarding section on a deep page)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const hub = registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "payee" }) });
  const { application } = onboardApplication(db, "Payee hub", { launch: { kind: "mfe", microfrontend: hub.publicId, mode: "module_federation_2", exposedModule: "./App" } });
  for (const [path, item] of [
    [`/onboarding/microfrontends/${hub.publicId}`, "Web Applications"],
    [`/onboarding/microfrontends/${hub.publicId}/revisions/1`, "Web Applications"],
    ["/onboarding/microfrontends", "Web Applications"],
    [`/onboarding/applications/${application.publicId}/microfrontends/new`, "Web Applications"],
    [`/onboarding/applications/${application.publicId}/revisions/1`, "Web Applications"],
    [`/onboarding/portals/${access.publicId}/revisions/1`, "Portals"],
    ["/onboarding/reviews", "Reviews"],
  ] as const) {
    await page.goto(path);
    await expectCurrentItem(page, "Web Onboarding", item);
  }
});

test("keeps each list's search and lifecycle filter in the URL, rendered by the server", async ({ page, db }) => {
  onboardPortal(db, "Access");
  createPortal(db, { name: "Payments hub", ownerTeam: "Payments", sealId: null }, ana);
  const repository = buildSource(db, { name: "payee" });
  registerMfe(db, "Payee hub", { repository });
  registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee-search" }), confirmed: false });
  onboardApplication(db, "Payments workspace", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" } });
  onboardApplication(db, "Ledger console", { launch: { kind: "external", mode: "iframe", documentUrl: "https://ledger.example.com/app" } });

  for (const [list, search, table, expected] of [
    ["portals", "pay", "Portals", "Payments hub"],
    ["microfrontends", "payee", "MFEs", "Payee search"],
    ["applications", "workspace", "Web Applications", "Payments workspace"],
  ] as const) {
    await page.goto(`/onboarding/${list}?lifecycle=draft&q=${search}`);
    await expect(page.getByRole("searchbox")).toHaveValue(search);
    await expect(page.getByRole("link", { name: /Draft/ }).and(page.locator('[aria-current="page"]'))).toBeVisible();
    const rows = page.getByRole("table", { name: table }).getByRole("row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText(expected);
    // Searching again keeps the lifecycle tab.
    await waitForHydration(page);
    await page.getByRole("searchbox").fill(expected.split(" ")[1]!);
    await page.getByRole("searchbox").press("Enter");
    await expect(page).toHaveURL(new RegExp(`lifecycle=draft.*q=${expected.split(" ")[1]}|q=${expected.split(" ")[1]}.*lifecycle=draft`));
    await expect(rows.nth(1)).toContainText(expected);
  }
});

test("titles each record by name with its catalog, and keeps its public ID secondary and copyable", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const hub = registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "payee" }) });
  const { application } = onboardApplication(db, "Payments workspace", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" } });
  for (const [path, title, id] of [
    [`/onboarding/portals/${access.publicId}`, "Access · Portals · DE FabLab", access.publicId],
    [`/onboarding/microfrontends/${hub.publicId}`, "Payee hub · MFEs · DE FabLab", hub.publicId],
    [`/onboarding/applications/${application.publicId}`, "Payments workspace · Web Applications · DE FabLab", application.publicId],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).not.toContainText(id);
    await page.getByText("Details", { exact: true }).click();
    await expect(page.getByRole("button", { name: /^Copy ID/ })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(id);
  }
});

test("refuses a missing name, a Portal name already onboarded, and a stale Draft, keeping what was entered", async ({ page, browser, db }) => {
  onboardPortal(db, "Access");
  const { application } = createWebApplication(db, { name: "Payments workspace", ownerTeam: "Payments" }, ana);
  await page.goto(`/onboarding/applications/${application.publicId}/microfrontends/new`);
  await waitForHydration(page);
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await page.getByRole("button", { name: "Create MFE" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveAccessibleDescription(/Enter the MFE's name/);
  await expect(page.getByLabel("Name", { exact: true })).toBeFocused();

  await page.goto("/onboarding/portals/new");
  await waitForHydration(page);
  await page.getByLabel("Name", { exact: true }).fill("Access");
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await page.getByRole("button", { name: "Create Portal" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveAccessibleDescription(/A Portal named Access is already onboarded/);
  await page.getByLabel("Name", { exact: true }).fill("Markets");
  await page.getByRole("button", { name: "Create Portal" }).click();
  await expect(heading(page, "Identity")).toBeVisible();

  // Two people edit the same Draft: the second save is refused, with its values kept.
  const url = page.url().split("?")[0]!;
  const other = await browser.newPage();
  await other.goto(url);
  await waitForHydration(page);
  await waitForHydration(other);
  await other.getByLabel("Owning team").fill("Markets Platform");
  await other.getByRole("button", { name: "Save draft" }).click();
  await expect(other.getByRole("region", { name: "Notifications" }).getByText("The Draft is saved.")).toBeVisible();
  await other.close();
  await page.getByLabel("Owning team").fill("Markets Web");
  await page.getByRole("button", { name: "Save draft" }).click();
  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toContainText("Someone saved this Draft after you opened it");
  await expect(alert).toBeFocused();
  await expect(page.getByLabel("Owning team")).toHaveValue("Markets Web");
});

test("refuses to retire an MFE an Application uses, saying which", async ({ page, db }) => {
  const hub = registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "payee" }) });
  onboardApplication(db, "Payee workspace", { launch: { kind: "mfe", microfrontend: hub.publicId, mode: "module_federation_2", exposedModule: "./App" } });
  await page.goto(`/onboarding/microfrontends/${hub.publicId}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Retire" }).click();
  const dialog = page.getByRole("dialog", { name: "Retire Payee hub?" });
  await dialog.getByLabel("Reason").fill("Replaced");
  await dialog.getByLabel("Your name").fill("Ana Ruiz");
  await dialog.getByRole("button", { name: "Retire MFE" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Payee workspace uses it. Remove it from that Application first");
  await expect(dialog.getByLabel("Reason")).toHaveValue("Replaced");
});

test("shows not-found pages for unknown records, revisions, and steps at both widths", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const missing = [
    ["/onboarding/portals/ptl_doesnotexist0000", "Portal not found"],
    [`/onboarding/portals/${access.publicId}/revisions/9`, "Revision not found"],
    [`/onboarding/portals/${access.publicId}/draft/nonsense`, "Portal not found"],
    ["/onboarding/applications/wap_doesnotexist0000", "Web Application not found"],
    ["/onboarding/microfrontends/mfe_doesnotexist0000", "MFE not found"],
    ["/onboarding/reviews/plc_doesnotexist0000", "Placement review not found"],
  ] as const;
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [path, title] of missing) {
      await test.step(`${path} at ${width}px`, async () => {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole("heading", { level: 1 })).toContainText(/not found/);
        await expect(page).toHaveTitle(new RegExp(title.replace("Revision not found", "(Revision|Portal) not found")));
        await expectNoHorizontalOverflow(page);
        await expectNoNestedBorders(page);
      });
    }
  }
});

test("shows a record's skeleton while a navigation waits, at both widths", async ({ page, db }) => {
  const hub = registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "payee" }) });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/onboarding/microfrontends");
    await waitForHydration(page);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route((url) => url.pathname === `/onboarding/microfrontends/${hub.publicId}`, async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("table", { name: "MFEs" }).getByRole("link", { name: "Payee hub" }).click();
    const skeleton = page.locator("main").getByLabel("Loading");
    await expect(skeleton).toBeVisible();
    await expectNoHorizontalOverflow(page);
    release();
    await expect(page.getByRole("table", { name: "Readiness checks" })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    await page.unroute((url) => url.pathname === `/onboarding/microfrontends/${hub.publicId}`);
  }
});

test.describe("an unexpected error on an onboarding page", () => {
  test.use({ expectedErrors: [/no such table|Server Components render|placement_decisions/i] });

  test("shows the error page without internal details, at both widths", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    void access;
    db.$client.exec("alter table placement_decisions rename to placement_decisions_away");
    try {
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/onboarding/reviews");
        const main = page.locator("main");
        await expect(main.locator("[data-shell-header]").getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
        await expect(main.getByRole("button", { name: "Try again" })).toBeVisible();
        await expect(main).not.toContainText("placement_decisions");
        await expectNoHorizontalOverflow(page);
      }
    } finally {
      db.$client.exec("alter table placement_decisions_away rename to placement_decisions");
    }
  });
});

// page-patterns spec: the Web Applications catalog filters what Home counts.
test("Placed Web Applications: the Placement filter lists only those a Portal has placed", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const request = { placement: null, portal: access.publicId, menuParent: null, route: "/payments", label: "Payments", order: 1, environments: ["prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false };
  const placed = onboardApplication(db, "Payments workspace", { sealId: "77001", launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" }, placements: [request] }).application;
  onboardApplication(db, "Payments reporting", { sealId: "77002", launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/reports" }, placements: [{ ...request, route: "/reports", label: "Reports" }] });
  decide(db, placementsOf(db, placed.publicId)[0]!, "approve");

  await page.goto("/onboarding/applications");
  await waitForHydration(page);
  await page.getByLabel("Placement").selectOption("placed");
  await expect(page).toHaveURL(/placement=placed/);
  const rows = page.getByRole("table", { name: "Web Applications", exact: true }).locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Payments workspace");
  await expect(page.getByRole("navigation", { name: "Filter Web Applications" }).getByRole("link", { name: /^All/ })).toContainText("1");

  await page.goto("/onboarding/applications?placement=unplaced");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Payments reporting");
});
