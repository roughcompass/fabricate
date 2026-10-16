import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { getPortal } from "../src/lib/onboarding/portals";
import { onboardPortal } from "../test/support/onboarding";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { E2E_WHATS_INCLUDED } from "./support/env";
import { waitForHydration } from "./support/shell";

// web-onboarding/portal-creation spec: the Create Portal dialog and the New Portal page.

const dialog = (page: Page) => page.getByRole("dialog", { name: /^Create/ });
const pageHeading = (page: Page, name: string) => page.locator("[data-shell-header]").getByRole("heading", { level: 1, name });
const platform = (scope: Page | ReturnType<typeof dialog>, name: string) => scope.getByRole("group", { name: /^Platform/ }).getByRole("radio", { name: new RegExp(`^${name}`) });
const newPortal = (page: Page) => page.locator("[data-page-header]").getByRole("link", { name: "New Portal" });
const included = (scope: Page | ReturnType<typeof dialog>) => scope.getByRole("region", { name: "What's included" });

/** Opens the dialog from the Portals page's New Portal action. */
async function openFromPortals(page: Page) {
  await page.goto("/onboarding/portals");
  await waitForHydration(page);
  // Hydrated, New Portal opens the dialog rather than the page.
  await expect(newPortal(page)).toHaveAttribute("aria-haspopup", "dialog");
  await newPortal(page).click();
  await expect(dialog(page)).toBeVisible();
}

/** Fills every field of the open form. */
async function fill(scope: Page | ReturnType<typeof dialog>, values: { platform?: string; sealId?: string; name?: string; description?: string } = {}) {
  const { platform: chosen = "Web", sealId = "1042", name = "Treasury", description = "Cash and liquidity for the treasury desk" } = values;
  if (chosen) await platform(scope, chosen).check();
  await scope.getByLabel("SEAL ID").fill(sealId);
  await scope.getByLabel("Name", { exact: true }).fill(name);
  await scope.getByLabel("Description").fill(description);
}

/** Who a Portal's creation was recorded as. */
const createdBy = (db: Db, label: string) =>
  db.$client.prepare("select e.actor, e.attribution from onboarding_events e join portals p on p.id = e.portal_id where p.label = ? and e.event = 'created'").get(label);

test.describe("the dialog", () => {
  test("Opening from the Portals page: What's included beside the form, focus on the first platform card, and no card chosen", async ({ page, db: _db }) => {
    await openFromPortals(page);
    await expect(included(dialog(page))).toBeVisible();
    await expect(included(dialog(page)).getByRole("listitem").first()).toContainText("Environments from the catalog");
    await expect(platform(dialog(page), "Web")).toBeFocused();
    for (const name of ["Web", "Mobile", "Desktop"]) await expect(platform(dialog(page), name)).not.toBeChecked();
    await expect(dialog(page).getByRole("heading", { level: 2, name: "Create a Portal" })).toBeVisible();
    // It doesn't ask who's creating the Portal.
    await expect(dialog(page).getByLabel("Your name")).toHaveCount(0);
    await expect(dialog(page).getByText(/Creating as/)).toHaveCount(0);
  });

  test("Dialog placement: against the right of the viewport, 16px from its top, right, and bottom, and further from its left", async ({ page, db: _db }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFromPortals(page);
    await expect
      .poll(async () => {
        const box = (await dialog(page).boundingBox())!;
        return { top: box.y, right: 1440 - (box.x + box.width), bottom: 900 - (box.y + box.height), leftFar: box.x > 16 };
      })
      .toEqual({ top: 16, right: 16, bottom: 16, leftFar: true });
  });

  test("Typing a name: the heading follows it, and a tag names the chosen platform", async ({ page, db: _db }) => {
    await openFromPortals(page);
    await platform(dialog(page), "Web").check();
    await dialog(page).getByLabel("Name", { exact: true }).fill("My New Portal");
    await expect(dialog(page).getByRole("heading", { level: 2, name: /^Create/ })).toHaveText("Create My New Portal");
    await expect(dialog(page).getByText("Web", { exact: true }).first()).toBeVisible();
    // Choosing with the keyboard: Right moves the choice.
    await platform(dialog(page), "Web").focus();
    await page.keyboard.press("ArrowRight");
    await expect(platform(dialog(page), "Mobile")).toBeChecked();
  });

  test("Cancelling: nothing is created, and focus returns to New Portal; Escape and the close button close it too", async ({ page, db }) => {
    await openFromPortals(page);
    await dialog(page).getByLabel("Name", { exact: true }).fill("Abandoned");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(newPortal(page)).toBeFocused();
    await newPortal(page).click();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await newPortal(page).click();
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    expect(db.$client.prepare("select count(*) as n from portals").get()).toEqual({ n: 0 });
  });

  test("Slug: derived as the name is typed, editable, and no longer following the name once edited", async ({ page, db: _db }) => {
    await openFromPortals(page);
    const form = dialog(page);
    await expect(form.getByText("None yet")).toBeVisible();
    await form.getByLabel("Name", { exact: true }).fill("My New Portal");
    await expect(form.locator('input[type="hidden"][name="slug"]')).toHaveValue("mynewportal");
    await expect(form.getByText("mynewportal", { exact: true })).toBeVisible();
    await form.getByLabel("Name", { exact: true }).fill("Café Markets 2");
    await expect(form.getByText("cafemarkets", { exact: true })).toBeVisible();

    await form.getByLabel("Name", { exact: true }).fill("My New Portal");
    await form.getByRole("button", { name: "Edit slug" }).click();
    const slug = form.getByLabel("Slug");
    await expect(slug).toBeFocused();
    await expect(slug).toHaveValue("mynewportal");
    await slug.fill("");
    await slug.pressSequentially("Desk-Top1");
    await expect(slug).toHaveValue("desktop");
    await slug.fill("mnp");
    await form.getByLabel("Name", { exact: true }).fill("My Newer Portal");
    await expect(slug).toHaveValue("mnp");
  });

  test("Required fields: each problem at its field, values kept, and focus on the first one", async ({ page, db }) => {
    await openFromPortals(page);
    const form = dialog(page);
    await form.getByLabel("Name", { exact: true }).fill("Treasury");
    await form.getByRole("button", { name: "Create Portal" }).click();
    await expect(form.getByText("Choose the Portal's platform")).toBeVisible();
    await expect(form.getByText("Enter the Portal's SEAL ID")).toBeVisible();
    await expect(form.getByText("Enter a description of the Portal")).toBeVisible();
    await expect(platform(form, "Web")).toBeFocused();
    await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Treasury");
    await expect(dialog(page)).toBeVisible();

    // Name taken.
    onboardPortal(db, "Access");
    await fill(form, { name: "Access" });
    await form.getByRole("button", { name: "Create Portal" }).click();
    await expect(form.getByText("A Portal named Access is already onboarded")).toBeVisible();
  });

  test("Slug validation: a taken slug and a name without letters open the slug's field with the problem", async ({ page, db }) => {
    onboardPortal(db, "Markets");
    await openFromPortals(page);
    const form = dialog(page);
    await fill(form, { name: "Markets desk" });
    await form.getByRole("button", { name: "Edit slug" }).click();
    await form.getByLabel("Slug").fill("markets");
    await form.getByRole("button", { name: "Create Portal" }).click();
    await expect(form.getByText("The slug markets belongs to Markets")).toBeVisible();
    await expect(form.getByLabel("Slug")).toBeFocused();

    await form.getByLabel("Slug").fill("");
    await form.getByLabel("Name", { exact: true }).fill("2026");
    await form.getByRole("button", { name: "Create Portal" }).click();
    await expect(form.getByText("Enter a slug of lowercase letters")).toBeVisible();
  });

  test("After creating: the Draft's Identity step with its toast, and the new Portal current in the switcher, recorded as Not stated without a remembered name", async ({ page, db }) => {
    await openFromPortals(page);
    await fill(dialog(page), { platform: "Mobile", name: "Treasury" });
    await dialog(page).getByRole("button", { name: "Create Portal" }).click();
    await expect(pageHeading(page, "Identity")).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Treasury is a Draft Portal.");
    await expect(page.locator("#sidebar").getByRole("button", { name: "Switch Portal, current: Treasury" })).toBeVisible();
    const created = db.$client.prepare("select public_id as publicId from portals where label = 'Treasury'").get() as { publicId: string };
    expect(getPortal(db, created.publicId)).toMatchObject({ platform: "mobile", slug: "treasury", sealId: "1042", description: "Cash and liquidity for the treasury desk", ownerTeam: null });
    expect(createdBy(db, "Treasury")).toEqual({ actor: "Not stated", attribution: "unverified" });
  });

  test("Remembered name: a Portal created from the Assessments page is recorded as the name last given, without asking for it", async ({ page, db, baseURL }) => {
    await page.context().addCookies([{ name: "fabricate-actor", value: "Jane Rivera", url: baseURL! }]);
    await page.goto("/assessments");
    await waitForHydration(page);
    await page.locator("#sidebar").getByRole("button", { name: /^Switch Portal/ }).click();
    await page.locator("#sidebar [popover]").getByRole("link", { name: /^Create Portal/ }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByLabel("Your name")).toHaveCount(0);
    await fill(dialog(page), { name: "Lending" });
    await dialog(page).getByRole("button", { name: "Create Portal" }).click();
    await expect(pageHeading(page, "Identity")).toBeVisible();
    expect(createdBy(db, "Lending")).toEqual({ actor: "Jane Rivera", attribution: "unverified" });
  });

  test("Create from the switcher: the switcher closes and the dialog opens with focus on its first field", async ({ page, db: _db }) => {
    await page.goto("/onboarding/applications");
    await waitForHydration(page);
    await page.locator("#sidebar").getByRole("button", { name: /^Switch Portal/ }).click();
    await page.locator("#sidebar [popover]").getByRole("link", { name: /^Create Portal/ }).click();
    await expect(page.locator("#sidebar [popover]").getByRole("searchbox")).toBeHidden();
    await expect(dialog(page)).toBeVisible();
    await expect(platform(dialog(page), "Web")).toBeFocused();
    await expect(page).toHaveURL(/\/onboarding\/applications$/);
  });

  test.describe("at 375px", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("Phone width: 12px from every edge, the cards stack, and What's included is a collapsed disclosure below the form", async ({ page, db: _db }) => {
      await openFromPortals(page);
      await expect.poll(async () => { const box = (await dialog(page).boundingBox())!; return [box.x, box.y, 375 - (box.x + box.width), 812 - (box.y + box.height)]; }).toEqual([12, 12, 12, 12]);
      await expect(included(dialog(page))).toBeHidden();
      const summary = dialog(page).locator("summary", { hasText: "What's included" });
      await expect(summary).toBeVisible();
      expect((await summary.boundingBox())!.y).toBeGreaterThan((await dialog(page).getByRole("button", { name: "Create Portal" }).boundingBox())!.y);
      const [web, mobile] = [(await platform(dialog(page), "Web").boundingBox())!, (await platform(dialog(page), "Mobile").boundingBox())!];
      expect(mobile.y).toBeGreaterThan(web.y);
      await expectNoHorizontalOverflow(page);
    });
  });
});

test.describe("the page", () => {
  test("Opening the address directly: What's included beside the form, as a page", async ({ page, db: _db }) => {
    await page.goto("/onboarding/portals/new");
    await expect(pageHeading(page, "New Portal")).toBeVisible();
    await expect(included(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("Malformed file: the form works without What's included", async ({ page, db }) => {
    const committed = fs.readFileSync(E2E_WHATS_INCLUDED, "utf8");
    fs.copyFileSync(path.resolve("test/fixtures/onboarding/whats-included-malformed.yaml"), E2E_WHATS_INCLUDED);
    try {
      await page.goto("/onboarding/portals/new");
      await waitForHydration(page);
      await expect(page.getByLabel("SEAL ID")).toBeVisible();
      await expect(included(page)).toHaveCount(0);
      await expect(page.locator("summary", { hasText: "What's included" })).toHaveCount(0);
      await fill(page, { name: "Lending" });
      await page.getByRole("button", { name: "Create Portal" }).click();
      await expect(pageHeading(page, "Identity")).toBeVisible();
      expect(db.$client.prepare("select slug from portals where label = 'Lending'").get()).toEqual({ slug: "lending" });
    } finally {
      fs.writeFileSync(E2E_WHATS_INCLUDED, committed);
    }
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("Creating without JavaScript: the Portal gets the slug its name derives; New Portal leads to the page", async ({ page, db }) => {
      await page.goto("/onboarding/portals");
      await newPortal(page).click();
      await expect(page).toHaveURL(/\/onboarding\/portals\/new$/);
      await expect(page.getByLabel("Slug")).toHaveValue("");
      await fill(page, { name: "My New Portal" });
      await page.getByRole("button", { name: "Create Portal" }).click();
      await expect(pageHeading(page, "Identity")).toBeVisible();
      expect(db.$client.prepare("select slug, platform from portals where label = 'My New Portal'").get()).toEqual({ slug: "mynewportal", platform: "web" });
    });
  });
});

test("Opening the dialog keeps the page behind it, not a loading skeleton", async ({ page, db }) => {
  onboardPortal(db, "Access");
  await openFromPortals(page);
  await page.waitForTimeout(400);
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("table", { name: "Portals" })).toBeVisible();
  await page.locator("#sidebar").getByRole("button", { name: /^Switch Portal/ }).click();
  await page.locator("#sidebar [popover]").getByRole("link", { name: /^Create Portal/ }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("table", { name: "Portals" })).toBeVisible();
});
