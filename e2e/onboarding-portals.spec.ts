import type { Locator, Page } from "@playwright/test";
import { catalogFromStudio, recordCatalogRead } from "../src/lib/onboarding/environments";
import { getPortal, savePortalDraft, startPortalDraft, submitPortal } from "../src/lib/onboarding/portals";
import { ana, decide, onboardApplication, onboardPortal, placementsOf, portalDraft } from "../test/support/onboarding";
import { loadV1Fixture } from "../test/support/onboarding-v1";
import { expect, expectNoHorizontalOverflow, expectNoNestedBorders, expectNoOverlappingContent, test } from "./support/fixtures";
import { seedOnboardingSurfaces, seedV1Surfaces } from "./support/onboarding-surfaces";
import { waitForHydration } from "./support/shell";

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });
const lockVersion = (page: Page) => page.locator('input[name="lockVersion"]').first();
const enabled = (page: Page) => page.getByRole("group", { name: "The Portal enables" });
const request = (portal: string, route: string, overrides: Record<string, unknown> = {}) => ({ placement: null, portal, menuParent: "payments", route, label: "Payments", order: 1, environments: ["uat", "prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false, ...overrides });
const iframe = (path: string) => ({ kind: "external" as const, mode: "iframe" as const, documentUrl: `https://payments.example.com${path}` });

/** Activates a control that saves the Draft, by click or key, and waits for the saved page to hydrate. */
async function save(page: Page, control: Locator, key?: string) {
  const before = await lockVersion(page).inputValue();
  if (key) await control.press(key);
  else await control.click();
  await expect(lockVersion(page)).not.toHaveValue(before);
  await waitForHydration(page);
}

/** Fills the New Portal page's form: a Web Portal with a SEAL ID and a description. */
async function fillNewPortal(page: Page, name: string, sealId = "88001") {
  await page.getByRole("radio", { name: /^Web/ }).check();
  await page.getByLabel("SEAL ID").fill(sealId);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Description").fill(`The ${name} Portal`);
}

async function createPortal(page: Page, name: string, sealId = "88001") {
  await page.goto("/onboarding/portals/new");
  await waitForHydration(page);
  await fillNewPortal(page, name, sealId);
  await page.getByRole("button", { name: "Create Portal" }).click();
  await expect(heading(page, "Identity")).toBeVisible();
  await waitForHydration(page);
}

test("selects predefined environments from the fallback set, with no runtime or entitlement fields, and keeps them across steps and reloads (Portal selects predefined environments)", async ({ page, db }) => {
  onboardPortal(db, "Access");
  await createPortal(page, "Markets", "88001");
  await expect(page.getByLabel("SEAL ID")).toHaveValue("88001");
  await expect(page.getByLabel("Runtimes")).toHaveCount(0);
  await page.getByLabel("Owning team").fill("Markets Platform");
  await save(page, page.getByRole("button", { name: "Save and continue" }));
  await expect(heading(page, "Environments")).toBeVisible();

  // The fallback set, attributed as such; nothing to type, and nothing to entitle.
  await expect(page.getByText("The fallback environment set")).toBeVisible();
  await expect(enabled(page).getByRole("checkbox")).toHaveCount(4);
  await expect(enabled(page).locator("label")).toHaveText(["DEV", "UAT", "TEST", "PROD"]);
  for (const field of ["Key", "Runtime", "Entitlement codes", "Inherit from"]) await expect(page.getByLabel(field, { exact: true })).toHaveCount(0);
  await enabled(page).getByLabel("UAT").check();
  await enabled(page).getByLabel("PROD").check();
  await save(page, page.getByRole("button", { name: "Save draft" }));

  await page.getByRole("link", { name: /Identity/ }).click();
  await expect(heading(page, "Identity")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Owning team")).toHaveValue("Markets Platform");
  await expect(page.getByLabel("SEAL ID")).toHaveValue("88001");
  await page.goto(page.url().split("?")[0]!.replace("/identity", "/environments"));
  await expect(enabled(page).getByLabel("UAT")).toBeChecked();
  await expect(enabled(page).getByLabel("PROD")).toBeChecked();
  await expect(enabled(page).getByLabel("DEV")).not.toBeChecked();
});

test("shows a Portal's platform, slug, and description in its overview (Portal page shows identity)", async ({ page, db }) => {
  // The builder creates a Web Portal described as "The Treasury Portal", with the slug its name derives.
  const treasury = onboardPortal(db, "Treasury");
  await page.goto(`/onboarding/portals/${treasury.publicId}`);
  const overview = page.locator("dl").first();
  await expect(overview.getByText("Platform", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("Web");
  await expect(overview.getByText("Slug", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("treasury");
  await expect(overview.getByText("Description", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("The Treasury Portal");
});

test("offers Studio's environment list with when it was read, and refuses one the catalog doesn't list (Studio environment catalog is unavailable)", async ({ page, db }) => {
  recordCatalogRead(db, { outcome: "found", environments: catalogFromStudio([{ id: 2, label: "SIT" }, { id: 4, label: "PROD" }]).environments });
  const access = onboardPortal(db, "Access", { environments: ["prod"] });
  const draft = startPortalDraft(db, access.publicId, ana);
  savePortalDraft(db, access.publicId, { lockVersion: draft.lockVersion, document: portalDraft({ environments: ["prod", "uat"] }) });
  await page.goto(`/onboarding/portals/${access.publicId}/draft/environments`);
  await expect(page.getByText(/^From Studio, read /)).toBeVisible();
  await expect(enabled(page).locator("label")).toContainText(["SIT", "PROD", "UAT"]);
  await expect(enabled(page).getByLabel("UAT")).toHaveAccessibleName(/UAT.*Not in the catalog any more/);
  await expect(page.getByText("UAT isn't in the Studio environment catalog. Choose one it lists").first()).toBeVisible();
  await expect(enabled(page).getByLabel("DEV")).toHaveCount(0);
});

test("opens the old contract step's address at the first step, keeping the Draft's values", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const draft = startPortalDraft(db, access.publicId, ana);
  savePortalDraft(db, access.publicId, { lockVersion: draft.lockVersion, document: portalDraft({ ownerTeam: "Access Experience", environments: ["dev", "prod"] }) });
  await page.goto(`/onboarding/portals/${access.publicId}/draft/contract`);
  await expect(heading(page, "Identity")).toBeVisible();
  expect(page.url()).toMatch(/\/draft\/identity$/);
  await expect(page.getByRole("navigation", { name: /^Steps of revision/ }).getByRole("link")).toHaveText([/^Identity/, /^Environments/, /^Menu/, /^Review and submit/]);
  await expect(page.getByLabel("Owning team")).toHaveValue("Access Experience");
  await page.goto(`/onboarding/portals/${access.publicId}/draft/environments`);
  await expect(enabled(page).getByLabel("DEV")).toBeChecked();
  await expect(enabled(page).getByLabel("PROD")).toBeChecked();
});

test("edits nested menu groups by keyboard, refuses a duplicate key, and keeps their order", async ({ page, db: _db }) => {
  await createPortal(page, "Markets");
  await page.goto(page.url().split("?")[0]!.replace("/identity", "/menu"));
  await waitForHydration(page);
  await save(page, page.getByRole("button", { name: "Add menu group" }), "Enter");
  await page.getByLabel("Label", { exact: true }).focus();
  await page.keyboard.type("Payments");
  await page.keyboard.press("Tab");
  await page.keyboard.type("payments");
  await save(page, page.getByLabel("Key", { exact: true }), "Enter");
  await save(page, page.getByRole("button", { name: "Add menu group" }), "Enter");
  await page.getByLabel("Label", { exact: true }).nth(1).focus();
  await page.keyboard.type("Payment tools");
  await page.keyboard.press("Tab");
  await page.keyboard.type("payments");
  await save(page, page.getByLabel("Key", { exact: true }).nth(1), "Enter");
  await expect(page.getByLabel("Key", { exact: true }).nth(1)).toHaveAccessibleDescription(/The menu key payments is used more than once/);
  await page.getByLabel("Key", { exact: true }).nth(1).fill("payment-tools");
  await page.keyboard.press("Tab");
  await page.keyboard.type("payments");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  await save(page, page.getByLabel("Position").nth(1), "Enter");
  await expect(page.getByLabel("Key", { exact: true }).nth(1)).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Inside").nth(1)).toHaveValue("payments");
  await expect(page.getByLabel("Position").nth(1)).toHaveValue("2");
});

test("separates menu groups from the placements under them, and shows an empty menu as empty", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const application = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access.publicId, "/payments")] }).application;
  decide(db, placementsOf(db, application.publicId)[0]!, "approve");
  const bare = onboardPortal(db, "Intranet", { menu: [] });
  await page.goto(`/onboarding/portals/${access.publicId}`);
  const menu = page.getByRole("table", { name: "PROD menu" });
  await expect(menu.getByRole("row", { name: /Payments Top-level group/ })).toContainText("—");
  await expect(menu.getByRole("row", { name: /Payments workspace/ })).toContainText("/payments");
  await page.goto(`/onboarding/portals/${bare.publicId}`);
  await expect(page.getByText("Empty menu").first()).toBeVisible();
});

test("reads revision differences as fields, and a v2 revision shows only its environments and menu", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const draft = startPortalDraft(db, access.publicId, ana);
  const revised = savePortalDraft(db, access.publicId, { lockVersion: draft.lockVersion, document: portalDraft({ environments: ["dev", "prod"] }) });
  expect(submitPortal(db, access.publicId, { lockVersion: revised.lockVersion, actor: ana }).submitted).toBe(true);
  await page.goto(`/onboarding/portals/${access.publicId}/revisions/2`);
  const changes = page.getByRole("table", { name: "Changes from revision 1" });
  await expect(changes.getByRole("row").filter({ hasText: "dev" })).toContainText("Added");
  await expect(changes.getByRole("row").filter({ hasText: "uat" })).toContainText("Removed");
  await expect(page.getByRole("main")).not.toContainText(/Runtime|Contract|Entitlement/);
  await expect(page.getByRole("main")).toContainText("DEV");
});

test("chooses each environment's first default from approved placements, activates, and replaces a default", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const workspace = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access.publicId, "/payments")] }).application;
  const reporting = onboardApplication(db, "Payments reporting", { launch: iframe("/reports"), placements: [request(access.publicId, "/reports")] }).application;
  decide(db, placementsOf(db, workspace.publicId)[0]!, "approve");
  decide(db, placementsOf(db, reporting.publicId)[0]!, "approve");

  await page.goto(`/onboarding/portals/${access.publicId}`);
  await waitForHydration(page);
  // No default yet: activation is blocked, and says why.
  const blockers = page.getByRole("table", { name: "What stops activation" });
  await expect(blockers).toContainText("PROD");
  await expect(page.getByRole("button", { name: "Activate revision 1" })).toHaveCount(0);

  for (const environment of ["PROD", "UAT"]) {
    await page.getByRole("table", { name: "Default routes" }).getByRole("row", { name: new RegExp(environment) }).getByRole("button", { name: "Choose" }).click();
    const dialog = page.getByRole("dialog", { name: `Choose Access's default in ${environment}` });
    await dialog.getByLabel("Default placement").selectOption({ label: "Payments workspace at /payments" });
    await dialog.getByLabel("Your name").fill("Cy Okafor");
    await dialog.getByRole("button", { name: "Save default" }).click();
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("The default route is saved.")).toBeVisible();
    await waitForHydration(page);
  }
  await page.getByRole("button", { name: "Activate revision 1" }).click();
  await page.getByRole("dialog").getByLabel("Your name").fill("Cy Okafor");
  await page.getByRole("dialog").getByRole("button", { name: "Activate revision 1" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Access is active.")).toBeVisible();
  await waitForHydration(page);

  // An Active Portal's default can be replaced, never cleared.
  await page.getByRole("table", { name: "Default routes" }).getByRole("row", { name: /PROD/ }).getByRole("button", { name: "Change" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose Access's default in PROD" });
  await expect(dialog.getByLabel("Default placement").locator("option")).toHaveText(["Payments workspace at /payments", "Payments reporting at /reports"]);
  await dialog.getByLabel("Default placement").selectOption({ label: "Payments reporting at /reports" });
  await dialog.getByLabel("Your name").fill("Cy Okafor");
  await dialog.getByRole("button", { name: "Save default" }).click();
  await expect(page.getByRole("table", { name: "Default routes" }).getByRole("row", { name: /PROD/ })).toContainText("Payments reporting at /reports");
  await expect(page.getByRole("table", { name: "Default routes" }).getByRole("row", { name: /PROD/ })).toContainText("Chosen by Cy Okafor, unverified");
});

test("refuses an approval in an environment the Portal's newer revision no longer enables (Environment mismatch)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const application = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access.publicId, "/payments")] }).application;
  const draft = startPortalDraft(db, access.publicId, ana);
  const saved = savePortalDraft(db, access.publicId, { lockVersion: draft.lockVersion, document: portalDraft({ environments: ["prod"] }) });
  submitPortal(db, access.publicId, { lockVersion: saved.lockVersion, actor: ana });
  await page.goto(`/onboarding/reviews/${placementsOf(db, application.publicId)[0]}`);
  await expect(page.getByRole("table", { name: "Check results" })).toContainText("Access has no enabled UAT environment now");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Approve" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your name").fill("Cy Okafor");
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Access has no enabled UAT environment now");
});

test("shows a v1 revision's runtimes, entitlements, and contract read-only, and keeps them beside a converted Draft as history", async ({ page, db }) => {
  loadV1Fixture(db);
  const access = (db.$client.prepare("select public_id as id from portals where label = 'Access'").get() as { id: string }).id;
  await page.goto(`/onboarding/portals/${access}/revisions/1`);
  const environments = page.getByRole("table", { name: "Environments" });
  await expect(environments.getByRole("row", { name: /UAT/ })).toContainText("studio-shell");
  await expect(environments.getByRole("row", { name: /UAT/ })).toContainText("ACCESS_UAT");
  await expect(page.getByRole("heading", { name: "Contract" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Contracts are no longer collected");

  await page.goto(`/onboarding/portals/${access}/draft/identity`);
  const kept = page.getByText("Kept from revision 2, as history").locator("..");
  await expect(kept).toContainText("studio-shell, studio-shell-2");
  await expect(kept).toContainText("Entitlements inherited from UAT");
  await expect(kept).toContainText("DR (disabled)");
  await page.goto(`/onboarding/portals/${access}/draft/environments`);
  await expect(enabled(page).getByLabel("UAT")).toBeChecked();
  await expect(enabled(page).getByLabel("PROD")).toBeChecked();
});

test("fits desktop and 375px viewports, in both themes, in every Portal state and step", async ({ page, db, baseURL }) => {
  const surfaces = seedOnboardingSurfaces(db).filter(([name]) => name.startsWith("20-"));
  for (const theme of ["light", "dark"]) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      for (const [name, url] of surfaces) {
        await test.step(`${name} at ${width}px, ${theme}`, async () => {
          await page.goto(typeof url === "string" ? url : url());
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expectNoHorizontalOverflow(page);
          if (width === 1280 && theme === "light") await expectNoNestedBorders(page);
        });
      }
    }
  }
});

// The visual capture's checks, for the v1 surfaces it can't seed beside the current ones.
test("fits desktop and 375px viewports, in both themes, on v1 history and converted Drafts", async ({ page, db, baseURL }) => {
  const surfaces = seedV1Surfaces(db);
  for (const theme of ["light", "dark"]) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      for (const [name, url] of surfaces) {
        await test.step(`${name} at ${width}px, ${theme}`, async () => {
          await page.goto(typeof url === "string" ? url : url());
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expectNoHorizontalOverflow(page);
          await expectNoOverlappingContent(page);
          if (width === 1280 && theme === "light") await expectNoNestedBorders(page);
        });
      }
    }
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("onboards, submits, and activates a Portal with forms and links alone", async ({ page, db }) => {
    await page.goto("/onboarding/portals/new");
    await fillNewPortal(page, "Access");
    await page.getByRole("button", { name: "Create Portal" }).click();
    await expect(heading(page, "Identity")).toBeVisible();
    await page.getByLabel("Owning team").fill("Access Platform");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(heading(page, "Environments")).toBeVisible();
    await enabled(page).getByLabel("UAT").check();
    await enabled(page).getByLabel("PROD").check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(heading(page, "Menu")).toBeVisible();
    await page.getByRole("button", { name: "Add menu group" }).click();
    await page.getByLabel("Label", { exact: true }).fill("Payments");
    await page.getByLabel("Key", { exact: true }).fill("payments");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(heading(page, "Review and submit")).toBeVisible();
    // Creating the Portal asked for no name, so submitting is the first step that does.
    await page.getByLabel("Your name").fill("Ana Ruiz");
    await page.getByRole("button", { name: "Submit revision 1" }).click();
    await expect(heading(page, "Access")).toBeVisible();
    await expect(page.getByRole("main").locator("dt", { hasText: "Lifecycle" }).locator("+ dd")).toHaveText("Ready");

    // An approved placement to be the default, then the default and activation through inline forms.
    const access = getPortal(db, (/portals\/(ptl_[a-z0-9]+)/.exec(page.url()) ?? [])[1]!);
    const application = onboardApplication(db, "Payments workspace", { launch: iframe("/app"), placements: [request(access.publicId, "/payments")] }).application;
    decide(db, placementsOf(db, application.publicId)[0]!, "approve");
    for (const environment of ["prod", "uat"]) {
      await page.goto(`/onboarding/portals/${access.publicId}?dialog=default-${environment}#dialog`);
      await page.getByLabel("Default placement").selectOption({ label: "Payments workspace at /payments" });
      await page.getByLabel("Your name").fill("Cy Okafor");
      await page.getByRole("button", { name: "Save default" }).click();
      await expect(page.getByRole("table", { name: "Default routes" }).getByRole("row", { name: new RegExp(environment.toUpperCase()) })).toContainText("Payments workspace at /payments");
    }
    await page.getByRole("link", { name: "Activate revision 1" }).click();
    await page.getByLabel("Your name").fill("Cy Okafor");
    await page.getByRole("button", { name: "Activate revision 1" }).click();
    await expect(page.getByRole("main").locator("dt", { hasText: "Lifecycle" }).locator("+ dd")).toHaveText("Active");
    const history = page.getByRole("table", { name: "Lifecycle history" });
    await expect(history).toContainText("Cy Okafor");
    await expect(history).toContainText("Unverified");
  });
});
