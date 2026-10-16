import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { getPortal, retirePortal } from "../src/lib/onboarding/portals";
import { ensurePortal } from "../src/lib/ownership/records";
import { ana, onboardPortal } from "../test/support/onboarding";
import { expect, test } from "./support/fixtures";
import { seedResults } from "./support/results";
import { waitForHydration } from "./support/shell";

// web-onboarding/portal-switcher spec: the sidebar's Portal switcher.

const sidebar = (page: Page) => page.locator("#sidebar");
const trigger = (page: Page) => sidebar(page).getByRole("button", { name: /^Switch Portal, current: / });
const list = (page: Page) => sidebar(page).locator("[popover]").getByRole("list", { name: "Switch Portal" });
const entry = (page: Page, name: string) => list(page).getByRole("button", { name: new RegExp(`^${name}\\b`) });
const filter = (page: Page) => sidebar(page).locator("[popover]").getByRole("searchbox", { name: "Find Portal…" });

async function open(page: Page) {
  await trigger(page).click();
  await expect(list(page)).toBeVisible();
}

async function choose(page: Page, name: string) {
  await open(page);
  await entry(page, name).click();
  await expect(trigger(page)).toHaveAccessibleName(`Switch Portal, current: ${name}`);
}

/** An onboarded Portal from before Portals recorded a platform: a row and a revision, written directly. */
function legacyPortal(db: Db, label: string): void {
  const now = Date.now();
  const { id } = db.$client.prepare("insert into portals (public_id, label, label_key, created_at) values (?, ?, ?, ?) returning id").get(`ptl_legacy${label.toLowerCase().padEnd(10, "x").slice(0, 10)}`, label, label.toLowerCase(), now) as { id: number };
  db.$client.prepare("insert into portal_revisions (number, document, created_by, created_at, updated_at, portal_id) values (1, '{}', 'Ana', ?, ?, ?)").run(now, now, id);
}

test.describe("with JavaScript", () => {
  test("Nothing is chosen: the switcher reads All Portals with no platform tag, beside the product mark", async ({ page, db }) => {
    onboardPortal(db, "Access");
    await page.goto("/onboarding/portals");
    await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: All Portals");
    await expect(trigger(page)).toHaveText("All Portals");
    await expect(sidebar(page).getByRole("link", { name: "DE FabLab home" })).toBeVisible();
  });

  test("Three Portals: All Portals first, then by name, the current one checked, and Create Portal last; Retired and claim-only Portals are left out", async ({ page, db }) => {
    onboardPortal(db, "Treasury");
    onboardPortal(db, "Access");
    onboardPortal(db, "Markets");
    const payments = onboardPortal(db, "Payments");
    retirePortal(db, payments.publicId, { lockVersion: getPortal(db, payments.publicId).lockVersion, reason: "Merged into Markets", actor: ana });
    ensurePortal(db, "Lending");
    await page.goto("/onboarding/portals");
    await waitForHydration(page);
    await choose(page, "Markets");
    await expect(trigger(page)).toHaveText(/^MMarketsWeb$/);
    await open(page);
    await expect(list(page).getByRole("button")).toHaveCount(4);
    for (const [index, name] of ["All Portals", "Access Web", "Markets Web Current", "Treasury Web"].entries()) await expect(list(page).getByRole("button").nth(index)).toHaveAccessibleName(name);
    await expect(entry(page, "Markets")).toHaveAttribute("aria-current", "true");
    const create = sidebar(page).locator("[popover]").getByRole("link", { name: /^Create Portal/ });
    await expect(create).toContainText("Onboard a Portal its team configures");
  });

  test("Portal without a platform: its initial and name, and no tag", async ({ page, db }) => {
    legacyPortal(db, "Lending");
    await page.goto("/onboarding/portals");
    await waitForHydration(page);
    await choose(page, "Lending");
    await expect(trigger(page)).toHaveText(/^LLending$/);
  });

  test("Filtering by SEAL ID, no match, and closing with Escape", async ({ page, db }) => {
    onboardPortal(db, "Access", { sealId: "88001" });
    onboardPortal(db, "Markets", { sealId: "1042" });
    await page.goto("/onboarding/portals");
    await waitForHydration(page);
    await open(page);
    await expect(filter(page)).toBeFocused();
    await filter(page).fill("1042");
    await expect(list(page).getByRole("button")).toHaveCount(2);
    await expect(entry(page, "Markets")).toBeVisible();
    await filter(page).fill("access");
    await expect(entry(page, "Access")).toBeVisible();
    await filter(page).fill("zzz");
    await expect(sidebar(page).getByRole("status")).toHaveText("No Portal matches “zzz”");
    await expect(entry(page, "All Portals")).toBeVisible();
    await expect(sidebar(page).locator("[popover]").getByRole("link", { name: /^Create Portal/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
  });

  test("First visit: All Portals, the empty state, and Create Portal", async ({ page, db: _db }) => {
    await page.goto("/onboarding/portals");
    await waitForHydration(page);
    await open(page);
    await expect(list(page).getByRole("button")).toHaveCount(1);
    await expect(sidebar(page).getByText("Portals you create appear here for quick switching.")).toBeVisible();
    await expect(sidebar(page).locator("[popover]").getByRole("link", { name: /^Create Portal/ })).toBeVisible();
  });

  test("Choosing with arrow keys", async ({ page, db }) => {
    onboardPortal(db, "Access");
    onboardPortal(db, "Markets");
    onboardPortal(db, "Treasury");
    await page.goto("/onboarding/portals");
    await waitForHydration(page);
    await open(page);
    await expect(filter(page)).toBeFocused();
    for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowDown");
    await expect(entry(page, "Treasury")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: Treasury");
    await expect(page).toHaveURL(/\/onboarding\/portals$/);
  });

  test("Choice survives a reload, and a retired remembered Portal means All Portals", async ({ page, db }) => {
    const markets = onboardPortal(db, "Markets");
    await page.goto("/onboarding/applications");
    await waitForHydration(page);
    await choose(page, "Markets");
    await page.reload();
    await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: Markets");
    retirePortal(db, markets.publicId, { lockVersion: getPortal(db, markets.publicId).lockVersion, reason: "Merged into Access", actor: ana });
    await page.reload();
    await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: All Portals");
  });

  test("Choosing All Portals removes the choice", async ({ page, db }) => {
    onboardPortal(db, "Markets");
    await page.goto("/onboarding/portals");
    await waitForHydration(page);
    await choose(page, "Markets");
    await choose(page, "All Portals");
    expect((await page.context().cookies()).some((cookie) => cookie.name === "fabricate-portal")).toBe(false);
  });
});

test("Other pages aren't scoped: with Access chosen, the Portals list shows every onboarded Portal and Assessments shows the same Assessments", async ({ page, db, baseURL }) => {
  const access = onboardPortal(db, "Access");
  onboardPortal(db, "Markets");
  const { initiative } = await seedResults(db);
  await page.goto("/assessments");
  const assessments = page.getByRole("table").first().locator("tbody tr");
  const unscoped = await assessments.allTextContents();
  expect(unscoped.join(" ")).toContain(initiative.name);

  await page.context().addCookies([{ name: "fabricate-portal", value: access.publicId, url: baseURL! }]);
  await page.goto("/onboarding/portals");
  await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: Access");
  const portals = page.getByRole("table", { name: "Portals" }).locator("tbody tr");
  await expect(portals).toHaveCount(2);
  await expect(portals.filter({ hasText: "Markets" })).toHaveCount(1);
  await page.goto("/assessments");
  await expect(assessments).toHaveText(unscoped);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("Without JavaScript: the switcher opens and chooses, and Create Portal is a link to the New Portal page", async ({ page, db }) => {
    onboardPortal(db, "Access");
    onboardPortal(db, "Markets");
    await page.goto("/onboarding/portals");
    await choose(page, "Markets");
    await open(page);
    await expect(filter(page)).toHaveCount(0);
    await expect(sidebar(page).locator("[popover]").getByRole("link", { name: /^Create Portal/ })).toHaveAttribute("href", "/onboarding/portals/new");
  });
});
