import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { addItem, setDefault } from "../src/lib/onboarding/navigation";
import { type Portal, getPortal, promotePortal } from "../src/lib/onboarding/portals";
import { ensurePortal } from "../src/lib/ownership/records";
import { registerApplication } from "../test/support/applications";
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

async function choose(page: Page, name: string, lifecycle = name === "All Portals" ? "" : "Prototype") {
  await open(page);
  await entry(page, name).click();
  await expect(trigger(page)).toHaveAccessibleName(`Switch Portal, current: ${name}${lifecycle ? `, ${lifecycle}` : ""}`);
}

/** Puts +portal+ in Production: an item for one of its Applications, made the default, then promoted. */
function promote(db: Db, portal: Portal) {
  const application = registerApplication(db, { name: `${portal.label} Home`, portal });
  const item = addItem(db, portal.publicId, { lockVersion: getPortal(db, portal.publicId).lockVersion, label: "Home", route: "/home", application: application.publicId, parent: null }, ana);
  setDefault(db, portal.publicId, { lockVersion: getPortal(db, portal.publicId).lockVersion, entry: item.publicId }, ana);
  promotePortal(db, portal.publicId, { lockVersion: getPortal(db, portal.publicId).lockVersion }, ana);
}

/** A Portal onboarded before Portals recorded a platform: a row and its carried-over creation, written directly. */
function legacyPortal(db: Db, label: string): void {
  const now = Date.now();
  const { id } = db.$client.prepare("insert into portals (public_id, label, label_key, created_at) values (?, ?, ?, ?) returning id").get(`ptl_legacy${label.toLowerCase().padEnd(10, "x").slice(0, 10)}`, label, label.toLowerCase(), now) as { id: number };
  db.$client.prepare("insert into onboarding_events (subject, portal_id, event, to_lifecycle, actor, attribution, occurred_at) values ('portal', ?, 'created', 'prototype', 'Ana', 'unverified', ?)").run(id, now);
}

test.describe("with JavaScript", () => {
  test("Nothing is chosen: the switcher reads All Portals with no platform tag or badge, beside the product mark", async ({ page, db }) => {
    onboardPortal(db, "Access");
    await page.goto("/assessments");
    await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: All Portals");
    await expect(trigger(page)).toHaveText("All Portals");
    await expect(sidebar(page).getByRole("link", { name: "DE FabLab home" })).toBeVisible();
  });

  test("Three Portals: All Portals first, then by name, each with its lifecycle badge, the current one checked, and Create Portal last; claim-only Portals are left out", async ({ page, db }) => {
    onboardPortal(db, "Treasury");
    promote(db, onboardPortal(db, "Access"));
    onboardPortal(db, "Markets");
    ensurePortal(db, "Lending");
    await page.goto("/assessments");
    await waitForHydration(page);
    await choose(page, "Markets");
    await expect(trigger(page)).toHaveText(/^MMarketsWebPrototype$/);
    await open(page);
    await expect(list(page).getByRole("button")).toHaveCount(4);
    for (const [index, name] of ["All Portals", "Access Web Production", "Markets Web Prototype Current", "Treasury Web Prototype"].entries()) await expect(list(page).getByRole("button").nth(index)).toHaveAccessibleName(name);
    await expect(entry(page, "Markets")).toHaveAttribute("aria-current", "true");
    const create = sidebar(page).locator("[popover]").getByRole("link", { name: /^Create Portal/ });
    await expect(create).toContainText("Onboard a Portal its team configures");
  });

  test("A Portal is chosen: its initial, name, platform tag, and Production badge", async ({ page, db, baseURL }) => {
    const access = onboardPortal(db, "Access");
    promote(db, access);
    await page.context().addCookies([{ name: "fabricate-portal", value: access.publicId, url: baseURL! }]);
    await page.goto("/assessments");
    await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: Access, Production");
    await expect(trigger(page)).toHaveText(/^AAccessWebProduction$/);
  });

  test("Portal without a platform: its initial, name, and badge, and no tag", async ({ page, db }) => {
    legacyPortal(db, "Lending");
    await page.goto("/assessments");
    await waitForHydration(page);
    await choose(page, "Lending");
    await expect(trigger(page)).toHaveText(/^LLendingPrototype$/);
  });

  test("Filtering by SEAL ID, no match, and closing with Escape", async ({ page, db }) => {
    onboardPortal(db, "Access", { sealId: "88001" });
    onboardPortal(db, "Markets", { sealId: "1042" });
    await page.goto("/assessments");
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
    await page.goto("/assessments");
    await waitForHydration(page);
    await open(page);
    await expect(list(page).getByRole("button")).toHaveCount(1);
    await expect(sidebar(page).getByText("Portals you create appear here for quick switching.")).toBeVisible();
    await expect(sidebar(page).locator("[popover]").getByRole("link", { name: /^Create Portal/ })).toBeVisible();
  });

  test("Choosing with arrow keys keeps the page", async ({ page, db }) => {
    onboardPortal(db, "Access");
    onboardPortal(db, "Markets");
    onboardPortal(db, "Treasury");
    await page.goto("/assessments");
    await waitForHydration(page);
    await open(page);
    await expect(filter(page)).toBeFocused();
    for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowDown");
    await expect(entry(page, "Treasury")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: Treasury, Prototype");
    await expect(page).toHaveURL(/\/assessments$/);
  });

  test("Choice survives a reload: the Applications page is scoped to Markets from its first paint", async ({ page, db }) => {
    const markets = onboardPortal(db, "Markets");
    const access = onboardPortal(db, "Access");
    registerApplication(db, { name: "Ledger", portal: markets });
    registerApplication(db, { name: "Payroll", portal: access });
    await page.goto("/applications");
    await waitForHydration(page);
    await expect(page.getByRole("link", { name: "Payroll", exact: true })).toBeVisible();
    await choose(page, "Markets");
    await expect(page.getByRole("link", { name: "Payroll", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: Markets, Prototype");
    // The server's own render, before any client code runs, is already scoped.
    const html = await (await page.request.get("/applications")).text();
    expect(html).toContain("Ledger");
    expect(html).not.toContain("Payroll");
  });

  test("Switching on a Navigation page: choosing Markets opens Markets' Navigation page", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    const markets = onboardPortal(db, "Markets");
    await page.goto(`/portals/${access.publicId}`);
    await waitForHydration(page);
    await choose(page, "Markets");
    await expect(page).toHaveURL(new RegExp(`/portals/${markets.publicId}$`));
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Markets");
  });

  test("Choosing All Portals removes the choice", async ({ page, db }) => {
    onboardPortal(db, "Markets");
    await page.goto("/assessments");
    await waitForHydration(page);
    await choose(page, "Markets");
    await choose(page, "All Portals");
    expect((await page.context().cookies()).some((cookie) => cookie.name === "fabricate-portal")).toBe(false);
  });
});

test("Other pages aren't scoped: with Access chosen, another Portal's dashboard opens in full, the Portals page shows every Portal, and Assessments shows the same Assessments", async ({ page, db, baseURL }) => {
  const access = onboardPortal(db, "Access");
  const markets = onboardPortal(db, "Markets");
  const ledger = registerApplication(db, { name: "Ledger", portal: markets });
  const { initiative } = await seedResults(db);
  await page.goto("/assessments");
  const assessments = page.getByRole("table").first().locator("tbody tr");
  const unscoped = await assessments.allTextContents();
  expect(unscoped.join(" ")).toContain(initiative.name);

  await page.context().addCookies([{ name: "fabricate-portal", value: access.publicId, url: baseURL! }]);
  await page.goto(`/applications/${ledger.publicId}`);
  await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: Access, Prototype");
  await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Ledger");
  await expect(page.getByRole("region", { name: "Overview" })).toContainText("Markets");
  await page.goto("/portals");
  const portals = page.getByRole("list", { name: "Portals" }).getByRole("listitem");
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
    await page.goto("/assessments");
    await choose(page, "Markets");
    await open(page);
    await expect(filter(page)).toHaveCount(0);
    await expect(sidebar(page).locator("[popover]").getByRole("link", { name: /^Create Portal/ })).toHaveAttribute("href", "/portals/new");
  });

  test("Without JavaScript on a Navigation page: choosing Markets opens Markets' page", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    const markets = onboardPortal(db, "Markets");
    await page.goto(`/portals/${access.publicId}`);
    await choose(page, "Markets");
    await expect(page).toHaveURL(new RegExp(`/portals/${markets.publicId}$`));
  });
});

// update-portal-management-journey task 6.3: names never wrap.
test("Long name: the switcher keeps the name on one line with an ellipsis and its full text on hover, in the trigger and the list (Long name, Long name in the list)", async ({ page, db, baseURL }) => {
  const portal = onboardPortal(db, "Global Corporate Treasury Operations Portal");
  await page.context().addCookies([{ name: "fabricate-portal", value: portal.publicId, url: baseURL! }]);
  await page.goto("/applications");
  await waitForHydration(page);
  const name = trigger(page).locator("[class*='entryLabel']");
  await expect(name).toHaveText("Global Corporate Treasury Operations Portal");
  const oneLine = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return { lines: Math.round(element.getBoundingClientRect().height / Number.parseFloat(style.lineHeight)), truncated: element.scrollWidth > element.clientWidth, ellipsis: style.textOverflow };
  };
  expect(await name.evaluate(oneLine)).toEqual({ lines: 1, truncated: true, ellipsis: "ellipsis" });
  await expect(trigger(page)).toHaveAttribute("title", "Global Corporate Treasury Operations Portal");
  await expect(trigger(page)).toHaveAccessibleName("Switch Portal, current: Global Corporate Treasury Operations Portal, Prototype");
  await expect(trigger(page)).toContainText("Web");
  await expect(trigger(page)).toContainText("Prototype");

  await trigger(page).click();
  const entry = list(page).getByRole("button", { name: /^Global Corporate Treasury/ });
  const label = entry.locator("[class*='entryLabel']");
  expect((await label.evaluate(oneLine)).lines).toBe(1);
  await expect(label).toHaveAttribute("title", "Global Corporate Treasury Operations Portal");
  const [entryBox, tagBox] = await Promise.all([entry.boundingBox(), entry.getByText("Web", { exact: true }).boundingBox()]);
  // The tag and badge stay whole, inside the entry.
  expect(tagBox!.x + tagBox!.width).toBeLessThanOrEqual(entryBox!.x + entryBox!.width);
  expect(await entry.getByText("Web", { exact: true }).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});
