import type { Page } from "@playwright/test";
import { getPortal } from "../src/lib/onboarding/portals";
import { activate, decide, observeStudio, onboardApplication, onboardPortal, placementsOf } from "../test/support/onboarding";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { seedOnboardingSurfaces } from "./support/onboarding-surfaces";
import { waitForHydration } from "./support/shell";

const iframe = (path: string) => ({ kind: "external" as const, mode: "iframe" as const, documentUrl: `https://payments.example.com${path}` });
const request = (portal: string, route: string, overrides: Record<string, unknown> = {}) => ({ placement: null, portal, menuParent: "payments", route, label: "Payments", order: 1, environments: ["uat", "prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false, ...overrides });
const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });

test("lists one row per placement, filtered by state, Portal, and search in the URL", async ({ page, db }) => {
  const access = onboardPortal(db, "Access").publicId;
  const markets = onboardPortal(db, "Markets").publicId;
  const workspace = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access, "/payments"), request(markets, "/payments")] }).application;
  onboardApplication(db, "Payments reporting", { launch: iframe("/reports"), placements: [request(access, "/reports")] });
  decide(db, placementsOf(db, workspace.publicId)[0]!, "approve");

  await page.goto("/onboarding/reviews");
  await waitForHydration(page);
  const rows = page.getByRole("table", { name: "Placement reviews" }).getByRole("row");
  // Two Portals, two independent reviews of one Application.
  await expect(rows.filter({ hasText: "Payments workspace · Access" })).toContainText("Approved");
  await expect(rows.filter({ hasText: "Payments workspace · Markets" })).toContainText("Pending");
  await expect(rows).toHaveCount(4);

  await page.getByRole("navigation", { name: "Filter reviews by state" }).getByRole("link", { name: /Pending/ }).click();
  await expect(page).toHaveURL(/state=pending/);
  await expect(rows).toHaveCount(3);
  await waitForHydration(page);
  await page.getByLabel("Portal", { exact: true }).selectOption({ label: "Access" });
  await expect(page).toHaveURL(new RegExp(`portal=${access}`));
  await expect(page).toHaveURL(/state=pending/);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Payments reporting · Access");

  await page.goto(`/onboarding/reviews?state=pending&q=workspace`);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Payments workspace · Markets");
  await expect(page.getByRole("searchbox", { name: "Search reviews" })).toHaveValue("workspace");
});

test("approves with the values the Portal accepts, once, unverified, and without reaching any other system", async ({ page, db, baseURL }) => {
  const access = onboardPortal(db, "Access").publicId;
  const application = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access, "/payments", { defaultRequested: true })] }).application;
  const [placement] = placementsOf(db, application.publicId);
  const elsewhere: string[] = [];
  page.on("request", (sent) => {
    if (!sent.url().startsWith(baseURL!)) elsewhere.push(`${sent.method()} ${sent.url()}`);
  });

  await page.goto(`/onboarding/reviews/${placement}`);
  await expect(page.getByRole("heading", { level: 1, name: "Payments workspace · Access" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Check results" }).or(page.getByText("Every check passes"))).toBeVisible();
  // Every value a decision rests on reads as text, never as a raw document.
  expect(await page.locator("main").innerText()).not.toMatch(/[{}[\]"]/);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Approve" }).click();
  const dialog = page.getByRole("dialog", { name: "Approve Payments workspace · Access?" });
  await expect(dialog.getByLabel("Route")).toHaveValue("/payments");
  await expect(dialog.getByRole("group", { name: "Make it the default route in" }).getByLabel("PROD")).toBeChecked();
  await dialog.getByLabel("Route").fill("/payments/home");
  await dialog.getByLabel("Menu label").fill("Payments home");
  await dialog.getByLabel("Your name").fill("cy@example.com");
  await dialog.getByRole("button", { name: "Approve" }).click();

  await expect(toasts(page).getByText("Payments workspace · Access is approved.")).toHaveCount(1);
  await expect(page.getByRole("banner").or(page.getByRole("main")).getByText("Approved").first()).toBeVisible();
  const accepted = page.getByRole("table", { name: "Requested and accepted values" });
  await expect(accepted.getByRole("row", { name: /Route/ })).toContainText("/payments/home");
  await expect(accepted.getByRole("row", { name: /Menu label/ })).toContainText("Payments home");
  const decisions = page.getByRole("table", { name: "Decisions" });
  await expect(decisions.getByRole("row")).toHaveCount(2);
  await expect(decisions).toContainText("cy@example.com");
  await expect(decisions).toContainText("Unverified");
  expect(elsewhere).toEqual([]);
});

test("requires a reason to reject, and keeps what was entered", async ({ page, db }) => {
  const access = onboardPortal(db, "Access").publicId;
  const application = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access, "/payments")] }).application;
  await page.goto(`/onboarding/reviews/${placementsOf(db, application.publicId)[0]}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Reject" }).click();
  const dialog = page.getByRole("dialog", { name: "Reject Payments workspace · Access?" });
  await dialog.getByLabel("Your name").fill("cy@example.com");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(dialog.getByLabel("Reason")).toHaveAccessibleDescription(/Say why the placement is rejected/);
  await expect(dialog.getByLabel("Your name")).toHaveValue("cy@example.com");
  await dialog.getByLabel("Reason").fill("Payments lives under Markets");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(toasts(page).getByText("Payments workspace · Access is rejected.")).toHaveCount(1);
  await expect(page.getByRole("table", { name: "Decisions" })).toContainText("Payments lives under Markets");
});

test("withdraws a pending request, with an optional reason, leaving the Application's other placements alone", async ({ page, db }) => {
  const access = onboardPortal(db, "Access").publicId;
  const markets = onboardPortal(db, "Markets").publicId;
  const application = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access, "/payments"), request(markets, "/payments")] }).application;
  const [inAccess, inMarkets] = placementsOf(db, application.publicId);
  decide(db, inMarkets!, "approve");
  await page.goto(`/onboarding/reviews/${inAccess}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Withdraw" }).click();
  const dialog = page.getByRole("dialog", { name: "Withdraw Payments workspace · Access?" });
  await dialog.getByLabel("Your name").fill("ana@example.com");
  await dialog.getByRole("button", { name: "Withdraw" }).click();
  await expect(toasts(page).getByText("Payments workspace · Access is withdrawn.")).toHaveCount(1);
  await page.goto(`/onboarding/reviews/${inMarkets}`);
  await expect(page.getByRole("main").locator("dt", { hasText: "Served" }).locator("+ dd")).toHaveText("Served");
});

test("refuses a stale rejection after another reviewer approves, keeping the reason and showing the approval (Two reviewers act on one placement)", async ({ page, browser, db }) => {
  const access = onboardPortal(db, "Access").publicId;
  const application = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access, "/payments")] }).application;
  const [placement] = placementsOf(db, application.publicId);
  await page.goto(`/onboarding/reviews/${placement}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Reject" }).click();
  const dialog = page.getByRole("dialog", { name: "Reject Payments workspace · Access?" });
  await dialog.getByLabel("Reason").fill("Not this quarter");
  await dialog.getByLabel("Your name").fill("dee@example.com");

  // Another reviewer approves in their own browser while the first has the dialog open.
  const other = await browser.newPage();
  await other.goto(page.url());
  await waitForHydration(other);
  await other.getByRole("button", { name: "Approve" }).click();
  await other.getByRole("dialog").getByLabel("Your name").fill("cy@example.com");
  await other.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(toasts(other).getByText("Payments workspace · Access is approved.")).toBeVisible();
  await other.close();

  await dialog.getByRole("button", { name: "Reject" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("This placement was approved by cy@example.com after you opened it");
  await expect(alert).toBeFocused();
  await expect(dialog.getByLabel("Reason")).toHaveValue("Not this quarter");
  // Behind the dialog, the page shows the approval that won.
  await expect(page.getByRole("table", { name: "Decisions" })).toContainText("cy@example.com");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  // Focus returns to the record that changed, its decisions; Reject no longer applies.
  await expect(page.locator("#decisions")).toBeFocused();
  await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Decisions" }).getByRole("row")).toHaveCount(2);
});

test("asks for a replacement before retiring an Active Portal's default route", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const home = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access.publicId, "/payments", { defaultRequested: true })] }).application;
  const reports = onboardApplication(db, "Payments reporting", { launch: iframe("/reports"), placements: [request(access.publicId, "/reports")] }).application;
  const [homePlacement] = placementsOf(db, home.publicId);
  decide(db, homePlacement!, "approve");
  decide(db, placementsOf(db, reports.publicId)[0]!, "approve");
  activate(db, getPortal(db, access.publicId));

  await page.goto(`/onboarding/reviews/${homePlacement}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Retire" }).click();
  const dialog = page.getByRole("dialog", { name: "Retire Payments workspace · Access?" });
  await dialog.getByLabel("Reason").fill("Moving to the new home page");
  await dialog.getByLabel("Your name").fill("cy@example.com");
  await dialog.getByRole("button", { name: "Retire placement" }).click();
  await expect(dialog.getByLabel("New default route in PROD")).toHaveAccessibleDescription(/Choose another approved placement to become the default first/);
  await dialog.getByLabel("New default route in PROD").selectOption({ label: "Payments reporting at /reports" });
  await dialog.getByLabel("New default route in UAT").selectOption({ label: "Payments reporting at /reports" });
  await dialog.getByRole("button", { name: "Retire placement" }).click();
  await expect(toasts(page).getByText("Payments workspace · Access is retired.")).toHaveCount(1);
  await expect(page.getByRole("table", { name: "Decisions" })).toContainText("Moving to the new home page");
});

test("keeps Studio's last answer when it can't be read, showing its age as Stale", async ({ page, db }) => {
  const access = onboardPortal(db, "Access").publicId;
  const application = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access, "/payments")] }).application;
  const [placement] = placementsOf(db, application.publicId);
  decide(db, placement!, "approve");
  const id = (db.$client.prepare("select id from application_placements where public_id = ?").get(placement) as { id: number }).id;
  observeStudio(db, { kind: "placement", id }, "menu", "5e1a", { outcome: "found", projection: { uuid: "5e1a", name: "Payments", parentUuid: null, channelUuid: null, envId: 2, route: "/payments", moduleUuids: [], entitlementCodes: [] } }, "prod", new Date(Date.now() - 3 * 24 * 60 * 60_000));
  observeStudio(db, { kind: "placement", id }, "menu", "5e1a", { outcome: "unavailable", error: "Studio didn't answer in time" }, "prod");

  await page.goto(`/onboarding/reviews/${placement}`);
  const state = page.locator("#current-state");
  await expect(state.getByText(/^Stale/).first()).toBeVisible();
  await expect(state).toContainText("PROD Studio menu for /payments");
  await expect(state).toContainText("3 days ago");
  await expect(state).not.toContainText("Missing");
});

test("fits desktop and 375px viewports in every review state", async ({ page, db }) => {
  const surfaces = seedOnboardingSurfaces(db).filter(([name]) => name.startsWith("23-"));
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [name, url] of surfaces) {
      await test.step(`${name} at ${width}px`, async () => {
        await page.goto(typeof url === "string" ? url : url());
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
  }
});
