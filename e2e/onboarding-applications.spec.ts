import type { Locator, Page } from "@playwright/test";
import { createWebApplication, readApplicationDraft, saveApplicationDraft } from "../src/lib/onboarding/applications";
import { recordAssertion } from "../src/lib/ownership/records";
import { buildSource } from "../test/support/builders";
import { CHILD_RENDERING, ana, decide, observeStudio, onboardApplication, onboardPortal, registerMfe } from "../test/support/onboarding";
import { loadV1Fixture } from "../test/support/onboarding-v1";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { seedOnboardingSurfaces } from "./support/onboarding-surfaces";
import { waitForHydration } from "./support/shell";

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });
const lockVersion = (page: Page) => page.locator('input[name="lockVersion"]').first();
const picker = (page: Page) => page.getByRole("list", { name: "Shared MFEs" });
const placement = (portal: string, route: string, overrides: Record<string, unknown> = {}) => ({ placement: null, portal, menuParent: "payments", route, label: "Payments", order: 1, environments: ["uat", "prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false, ...overrides });

/** Clicks a button that saves the Draft, and waits for the saved page, by its newer lock version, to hydrate. */
async function save(page: Page, button: Locator | string) {
  const before = await lockVersion(page).inputValue();
  await (typeof button === "string" ? page.getByRole("button", { name: button, exact: true }) : button).click();
  await expect(lockVersion(page)).not.toHaveValue(before);
  await waitForHydration(page);
}

/** Presses a key that saves the Draft, such as Enter in a field, and waits for the saved page. */
async function saveByKey(page: Page, field: Locator, key = "Enter") {
  const before = await lockVersion(page).inputValue();
  await field.press(key);
  await expect(lockVersion(page)).not.toHaveValue(before);
  await waitForHydration(page);
}

async function createApplication(page: Page, name: string, sealId = "") {
  await page.goto("/onboarding/applications/new");
  await waitForHydration(page);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Owning team").fill("Payments");
  if (sealId) await page.getByLabel("SEAL ID").fill(sealId);
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await page.getByRole("button", { name: "Create Web Application" }).click();
  await expect(heading(page, "Name and owner")).toBeVisible();
  await waitForHydration(page);
}

async function next(page: Page, step: string) {
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(heading(page, step)).toBeVisible();
  await waitForHydration(page);
}

test("onboards a composite Application from shared MFEs, confirming the inferred mode, without authoring platform capabilities, and leaves its placement pending", async ({ page, db }) => {
  onboardPortal(db, "Access");
  const repository = buildSource(db, { name: "payee" });
  registerMfe(db, "Payee hub", { repository });
  registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee-search" }), rendering: CHILD_RENDERING });

  await createApplication(page, "Payee workspace");
  for (const field of ["Environments", "Portal capabilities it requires"]) await expect(page.getByText(field, { exact: true })).toHaveCount(0);
  await next(page, "Launch target");

  await page.getByLabel("A registered MFE").check();
  await page.getByLabel("MFE", { exact: true }).selectOption({ label: "Payee hub" });
  await page.getByLabel("Module Federation 2").check();
  await save(page, "Save draft");
  await expect(page.getByLabel("MFE", { exact: true })).toHaveAccessibleDescription("Loads through Module Federation 2 (./App).");
  // One proposal, with where it comes from and when; nothing is confirmed until the team says so.
  const proposal = page.getByRole("listitem").filter({ hasText: "Module Federation 2 · ./App" });
  await expect(proposal).toContainText("Submitted MFE rendering metadata: Payee hub revision 1 rendering metadata");
  await expect(proposal).toContainText("Observed");
  await expect(page.getByText("Confirmed from the evidence")).toHaveCount(0);
  await waitForHydration(page);
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await save(page, proposal.getByRole("button", { name: "Confirm Module Federation 2" }));
  await expect(page.getByText("Confirmed from the evidence")).toBeVisible();
  await expect(page.getByLabel("Exposed module")).toHaveValue("./App");
  await waitForHydration(page);
  await next(page, "Composition");

  // The launch target is the entry; the shared MFE is added from the picker, with its one module, and no host settings.
  await expect(page.getByText("Payee hub is the entry")).toBeVisible();
  await expect(picker(page).getByRole("listitem").filter({ hasText: "Payee hub" })).toContainText("The launch target");
  await save(page, picker(page).getByRole("button", { name: "Add Payee search as a child" }));
  await expect(page.getByLabel("MFE", { exact: true })).toHaveValue(/^mfe_/);
  await expect(page.getByLabel("Module the host mounts").locator("option").first()).toHaveText("./Widget (its only module)");
  await expect(page.getByLabel("Host settings")).toHaveCount(0);
  // Keyboard only: choose the mount by typing, and save with Enter.
  await page.getByLabel("Mounts at").focus();
  await page.keyboard.type("A slot");
  await page.keyboard.press("Tab");
  await page.keyboard.type("search");
  await saveByKey(page, page.getByLabel("Route or slot"));
  await expect(page.getByLabel("Mounts at")).toHaveValue("slot");
  await expect(picker(page).getByRole("listitem").filter({ hasText: "Payee search" })).toContainText("Already a child");
  await next(page, "Placements");

  await save(page, "Add placement");
  await page.getByLabel("Portal", { exact: true }).selectOption({ label: "Access" });
  // The placement chooses from the environments Access enables.
  await expect(page.getByRole("group", { name: "Environments" }).locator("label")).toHaveText(["UAT", "PROD"]);
  await page.getByRole("group", { name: "Environments" }).getByLabel("UAT").check();
  await page.getByRole("group", { name: "Environments" }).getByLabel("PROD").check();
  await page.getByLabel("Menu group").selectOption({ label: "Payments" });
  await page.getByLabel("Route", { exact: true }).fill("/payee");
  await page.getByLabel("Entitlement codes").fill("PAYEE_VIEW");
  await next(page, "Review and submit");

  await expect(page.getByText("No issues")).toBeVisible();
  await page.getByRole("button", { name: "Submit revision 1" }).click();
  await expect(heading(page, "Payee workspace")).toBeVisible();
  const placements = page.getByRole("table", { name: "Placements" });
  await expect(placements).toContainText("Payee workspace · Access");
  await expect(placements).toContainText("Pending");
  await expect(page.getByRole("main").locator("dt", { hasText: "Lifecycle" }).locator("+ dd")).toHaveText("Draft");
  await expect(page.getByLabel("Composition outline")).toContainText("Child Payee search (./Widget) at slot search, required");
});

test("shows every candidate when the evidence conflicts, and keeps them beside an override", async ({ page, db }) => {
  onboardPortal(db, "Access");
  const hub = registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "payee" }), rendering: { iframe: null, esm: { exports: ["./App"] }, module_federation_2: { exposes: ["./App"] } } });
  observeStudio(db, { kind: "microfrontend", id: hub.id }, "module", "6f1d", { outcome: "found", projection: { uuid: "6f1d", title: "Payee hub", appId: "payee", url: "https://payee.example.com/", sealId: "88001", status: "Active", version: 3, typeLabels: ["iframe"] } });
  await createApplication(page, "Payee workspace");
  await page.goto(page.url().replace("/identity", "/launch"));
  await waitForHydration(page);
  await page.getByLabel("A registered MFE").check();
  await page.getByLabel("MFE", { exact: true }).selectOption({ label: "Payee hub" });
  await save(page, "Save draft");

  await expect(page.getByText("The evidence proposes different modes")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Confirm / })).toHaveCount(3);
  await expect(page.getByRole("listitem").filter({ hasText: "Studio module type: Studio module 6f1d" })).toContainText("iframe");

  await waitForHydration(page);
  await page.getByLabel("ESM module").check();
  await page.getByLabel("Exported module").fill("./App");
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await save(page, "Override with the values above");
  await expect(page.getByText("Overridden: the values above were chosen over the evidence")).toBeVisible();
  // The candidates stay beside the override.
  await expect(page.getByRole("button", { name: /^Confirm / })).toHaveCount(3);
});

test("launches an external endpoint with an explicit mode, and composes a shared MFE it finds by search, with no host contract", async ({ page, db }) => {
  registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee-search" }), rendering: CHILD_RENDERING });
  registerMfe(db, "Card controls", { repository: buildSource(db, { name: "cards" }), ownerTeam: "Cards", sealId: "77001" });
  await createApplication(page, "Payments console");
  await page.goto(page.url().replace("/identity", "/launch"));
  await waitForHydration(page);
  await page.getByLabel("An external endpoint").check();
  await page.getByLabel("ESM module").check();
  await page.getByLabel("Module URL").fill("https://cdn.example.com/console.js");
  await page.getByLabel("Exported module").fill("mount");
  await save(page, "Save draft");
  await expect(page.getByText("An external endpoint is never fetched to guess its mode")).toBeVisible();
  await waitForHydration(page);
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await save(page, "Confirm the values above");
  await expect(page.getByText("Chosen explicitly: no evidence proposed a mode")).toBeVisible();

  await page.goto(page.url().split("?")[0]!.replace("/launch", "/composition"));
  await waitForHydration(page);
  await expect(page.getByText("The external endpoint hosts the children below")).toBeVisible();
  // Search narrows the shared MFEs; another team's MFE can be bound and opened, but not edited here.
  const search = page.getByRole("searchbox", { name: "Search shared MFEs" });
  await search.fill("77001");
  await search.press("Enter");
  await expect(picker(page).getByRole("listitem")).toHaveCount(1);
  await expect(picker(page)).toContainText("Cards owns Card controls, so they change it");
  await expect(picker(page).getByRole("link", { name: "Edit Card controls" })).toHaveCount(0);
  await search.fill("payee");
  await search.press("Enter");
  await expect(picker(page).getByRole("listitem")).toHaveCount(1);
  await waitForHydration(page);
  await save(page, picker(page).getByRole("button", { name: "Add Payee search as a child" }));
  await page.getByLabel("Mounts at").selectOption("route");
  await page.getByLabel("Route or slot").fill("/search");
  await saveByKey(page, page.getByLabel("Route or slot"));
  await expect(page.getByLabel("Route or slot")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/host contract/i)).toHaveCount(0);
  await expect(page.getByText("To fix before submitting")).toHaveCount(0);
});

test("registers a missing MFE from the composition, and returns there when it's submitted (Team registers a missing MFE)", async ({ page, db }) => {
  buildSource(db, { name: "payee-search" });
  const { application } = createWebApplication(db, { name: "Payments workspace", ownerTeam: "Payments", sealId: "88001" }, ana);
  const composition = `/onboarding/applications/${application.publicId}/draft/composition`;
  await page.goto(composition);
  await waitForHydration(page);
  await page.getByRole("link", { name: "Register MFE" }).click();
  await expect(heading(page, "Register MFE")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Composition");
  await waitForHydration(page);
  await page.getByLabel("Name", { exact: true }).fill("Payee search");
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await page.getByRole("button", { name: "Create MFE" }).click();

  // The MFE's Draft opens with its way back to the composition.
  await expect(heading(page, "Built from")).toBeVisible();
  expect(page.url()).toContain(`from=${application.publicId}`);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Composition" })).toHaveAttribute("href", composition);
  await waitForHydration(page);
  await page.getByLabel("Repository").selectOption({ label: "payee-search" });
  await next(page, "CDaaS view");
  await page.getByLabel("appId").fill("payee");
  await page.getByLabel("viewId").fill("search");
  await next(page, "Rendering");
  for (const field of ["Requires", "Provides", "Shared dependencies", "Events", "Context"]) await expect(page.getByLabel(field, { exact: true })).toHaveCount(0);
  await page.getByLabel("It can be imported as an ESM module").check();
  await page.getByLabel("Exported modules").fill("./Search");
  await next(page, "Review and submit");
  await page.getByRole("button", { name: "Submit revision 1" }).click();

  await expect(heading(page, "Composition")).toBeVisible();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("The MFE's revision is submitted.")).toBeVisible();
  await expect(picker(page).getByRole("listitem").filter({ hasText: "Payee search" })).toContainText("Owned by Payments");
  await expect(picker(page).getByRole("button", { name: "Add Payee search as a child" })).toBeVisible();
  expect(db.$client.prepare("select count(*) as n from microfrontends").get()).toEqual({ n: 1 });
});

test("edits its own team's MFE from the composition, and returns on Cancel, browser Back, and a stale save", async ({ page, db }) => {
  const search = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "payee-search" }), ownerTeam: "Payments", rendering: CHILD_RENDERING });
  const { application } = createWebApplication(db, { name: "Payments workspace", ownerTeam: "Payments", sealId: "88001" }, ana);
  const composition = `/onboarding/applications/${application.publicId}/draft/composition`;
  await page.goto(composition);
  await waitForHydration(page);
  await picker(page).getByRole("link", { name: "Edit Payee search" }).click();
  // No Draft yet: the MFE page opens its Start a Draft form, which keeps the way back.
  await page.locator("#dialog").getByRole("textbox").fill("Ana Ruiz");
  await page.locator("#dialog").getByRole("button", { name: "Start Draft" }).click();
  await expect(heading(page, "Name and owner")).toBeVisible();
  expect(page.url()).toContain(`from=${application.publicId}`);
  await waitForHydration(page);

  // Cancel returns to the composition.
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(heading(page, "Composition")).toBeVisible();
  // So does browser Back.
  await page.goBack();
  await expect(heading(page, "Name and owner")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/onboarding/microfrontends/${search.publicId}`));

  // A save based on a Draft someone changed since is refused, keeping what was entered.
  await page.goto(`/onboarding/microfrontends/${search.publicId}/draft/rendering?from=${application.publicId}`);
  await waitForHydration(page);
  db.$client.prepare("update microfrontend_revisions set lock_version = lock_version + 1 where microfrontend_id = ? and state = 'draft'").run(search.id);
  await page.getByLabel("A Portal can frame it").check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator("#mfe-rendering-alert")).toContainText("Someone saved this Draft after you opened it");
  await expect(page.getByLabel("A Portal can frame it")).toBeChecked();
  await waitForHydration(page);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByLabel("A Portal can frame it")).toBeChecked();
  await expect(page.getByRole("region", { name: "Applications using it" })).toBeVisible();
});

test("offers a Portal an ownership claim names as a candidate, never as a placement, until the team requests one", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  const { application } = createWebApplication(db, { name: "Payments workspace", ownerTeam: "Payments", sealId: "88001" }, ana);
  recordAssertion(db, { attribute: "portal", application: application.id, portal: access.id, operation: "add", providedBy: "ben@example.com", source: "person" });
  await page.goto(`/onboarding/applications/${application.publicId}`);
  await expect(page.getByRole("table", { name: "Placement candidates" })).toContainText("Claimed by ben@example.com, unverified");
  await expect(page.getByText("No placements requested")).toBeVisible();

  await page.goto(`/onboarding/applications/${application.publicId}/draft/placements`);
  await waitForHydration(page);
  await expect(page.getByText("Claimed in ownership, not requested yet")).toBeVisible();
  await save(page, page.getByRole("button", { name: "Request a placement in Access" }));
  await expect(page.getByLabel("Portal", { exact: true })).toHaveValue(access.publicId);
  await expect(page.getByText("Claimed in ownership, not requested yet")).toHaveCount(0);
});

test("keeps same-SEAL Applications apart while editing", async ({ page, db }) => {
  createWebApplication(db, { name: "Payments reporting", ownerTeam: "Reporting", sealId: "88001" }, ana);
  await createApplication(page, "Payments workspace", "88001");
  await expect(page.getByText("Another Application carries SEAL ID 88001")).toBeVisible();
  await expect(page.getByRole("link", { name: "Payments reporting" })).toBeVisible();
  await expect(page.getByText("owned by Reporting")).toBeVisible();
});

test("places one Application in two Portals with independent values, reports a collision at both routes, and removes a placement", async ({ page, db }) => {
  onboardPortal(db, "Access");
  onboardPortal(db, "Markets", { sealId: "88002" });
  await createApplication(page, "Payments workspace");
  await page.goto(page.url().split("?")[0]!.replace("/identity", "/placements"));
  await waitForHydration(page);
  for (const [position, portal, route] of [
    [0, "Access", "/payments"],
    [1, "Markets", "/payments"],
    [2, "Access", "/payments"],
  ] as const) {
    await save(page, "Add placement");
    await page.getByLabel("Portal", { exact: true }).nth(position).selectOption({ label: portal });
    await page.getByRole("group", { name: "Environments" }).nth(position).getByLabel("PROD").check();
    await page.getByLabel("Route", { exact: true }).nth(position).fill(route);
    await page.getByLabel("Menu label").nth(position).fill(`Payments in ${portal}`);
    await save(page, "Save draft");
  }
  // The two Access requests collide with each other; the Markets one doesn't.
  await expect(page.getByLabel("Route", { exact: true }).nth(0)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Route", { exact: true }).nth(1)).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Route", { exact: true }).nth(2)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Menu label").nth(1)).toHaveValue("Payments in Markets");

  await save(page, "Remove placement 3");
  await expect(page.getByLabel("Route", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("Route", { exact: true }).nth(0)).not.toHaveAttribute("aria-invalid", "true");
});

test("flags only the placement that asks for an environment its Portal doesn't enable (Placement selects unavailable environment)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access").publicId;
  const treasury = onboardPortal(db, "Treasury", { environments: ["uat"] }).publicId;
  const { application, draft } = createWebApplication(db, { name: "Payments workspace", ownerTeam: "Payments" }, ana);
  saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document: { ...readApplicationDraft(draft), placements: [placement(access, "/payments", { environments: ["test", "prod"] }), placement(treasury, "/payments", { environments: ["uat"] })] } });
  await page.goto(`/onboarding/applications/${application.publicId}/draft/placements`);
  const first = page.getByRole("group", { name: "Environments" }).nth(0);
  await expect(first).toHaveAttribute("aria-invalid", "true");
  await expect(first).toContainText("TEST is unavailable for this placement: Access doesn't enable it");
  await expect(first.getByLabel("TEST")).toHaveAccessibleName(/TEST.*Not enabled in Access/);
  await expect(page.getByRole("group", { name: "Environments" }).nth(1)).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("group", { name: "Environments" }).nth(1).locator("label")).toHaveText(["UAT"]);
});

test("edits after submission open a new Draft and leave the pending review alone", async ({ page, db }) => {
  const access = onboardPortal(db, "Access").publicId;
  const markets = onboardPortal(db, "Markets").publicId;
  const { application } = onboardApplication(db, "Payments workspace", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" }, placements: [placement(access, "/payments"), placement(markets, "/payments")] });
  const inAccess = db.$client.prepare("select p.public_id from application_placements p join portals po on po.id = p.portal_id where p.application_id = ? and po.label = 'Access'").pluck().get(application.id) as string;
  decide(db, inAccess, "approve");

  await page.goto(`/onboarding/applications/${application.publicId}`);
  await waitForHydration(page);
  const placements = page.getByRole("table", { name: "Placements" });
  await expect(placements.getByRole("row").filter({ hasText: "Access" })).toContainText("Approved");
  await expect(placements.getByRole("row").filter({ hasText: "Markets" })).toContainText("Pending");
  await page.getByRole("button", { name: "Start a Draft" }).click();
  await page.getByRole("dialog").getByLabel("Your name").fill("Ana Ruiz");
  await page.getByRole("dialog").getByRole("button", { name: "Start Draft" }).click();
  await expect(heading(page, "Name and owner")).toBeVisible();
  await page.goto(page.url().split("?")[0]!.replace("/identity", "/placements"));
  await waitForHydration(page);
  await expect(page.getByText(/Revises an existing placement/)).toHaveCount(2);
  await page.getByRole("region", { name: /^In Markets/ }).getByLabel("Route", { exact: true }).fill("/markets/payments");
  await save(page, "Save draft");

  await page.goto(`/onboarding/applications/${application.publicId}`);
  await expect(placements.getByRole("row").filter({ hasText: "Markets" })).toContainText("/payments");
  await expect(placements.getByRole("row").filter({ hasText: "Markets" })).toContainText("Pending");
  await expect(placements.getByRole("row").filter({ hasText: "Markets" })).not.toContainText("/markets/payments");
  await page.goto(`/onboarding/applications/${application.publicId}/revisions/1`);
  await expect(page.getByRole("table", { name: "Placement requests" }).getByRole("row").filter({ hasText: "Access" })).toContainText("Approved");
});

test("keeps a v1 revision's environments, capabilities, and host contract as history beside its converted Draft", async ({ page, db }) => {
  loadV1Fixture(db);
  const id = (name: string) => (db.$client.prepare("select public_id as id from applications where name = ?").get(name) as { id: string }).id;
  await page.goto(`/onboarding/applications/${id("Payments reporting")}/revisions/1`);
  await expect(page.getByRole("heading", { name: "External host contract, earlier format" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Environments, earlier format");

  const hub = id("Payee hub");
  await page.goto(`/onboarding/applications/${hub}/draft/identity`);
  const kept = page.getByText("Kept from revision 2, as history").locator("..");
  await expect(kept).toContainText("Required Portal capabilities");
  await expect(kept).toContainText("navigation, theme");
  await expect(kept).toContainText('{"pageSize":25}');
  await page.goto(`/onboarding/applications/${hub}/draft/composition`);
  await expect(page.getByLabel("Host settings")).toHaveCount(0);
  await expect(page.getByLabel("Module the host mounts")).toBeVisible();
});

test("fits desktop and 375px viewports in every Application state and step", async ({ page, db }) => {
  const surfaces = seedOnboardingSurfaces(db).filter(([name]) => name.startsWith("22-"));
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
