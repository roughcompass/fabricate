import type { Locator, Page } from "@playwright/test";
import { loadConfig } from "../src/lib/config";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { refreshEnvironmentCatalog } from "../src/lib/onboarding/external/refresh";
import { declareReference } from "../src/lib/onboarding/external/references";
import { buildSource } from "../test/support/builders";
import { MFE_RENDERING, ana, onboardApplication, onboardPortal, placementsOf, registerMfe } from "../test/support/onboarding";
import { type RecordingServer, cdaasVersionsResponse, json, recordingServer, studioModuleResponse } from "../test/support/recording-server";
import { E2E_ENV } from "./support/env";
import { expect, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

/*
 * The onboarding acceptance flows, through the pages, one per team. Studio
 * and CDaaS are local recording servers; the refresh jobs the pages queue
 * run here, against them, and they see nothing but GET.
 *
 * - A Portal team selects environments from Studio's list, builds its menu,
 *   submits, approves placements, deciding their entitlements, assigns each
 *   environment's default, and activates, without ever configuring a
 *   runtime, a contract, or Portal entitlements.
 * - An Application team reuses a shared MFE and registers a missing one from
 *   the composition, confirms the inferred rendering mode, composes, requests
 *   placements with their environments and entitlements, and reaches Ready,
 *   without authoring platform capabilities or contracts.
 */

test.setTimeout(240_000);

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });
const lockVersion = (page: Page) => page.locator('input[name="lockVersion"]').first();
const lifecycle = (page: Page) => page.getByRole("main").locator("dt", { hasText: "Lifecycle" }).locator("+ dd");
const request = (portal: string, route: string, overrides: Record<string, unknown> = {}) => ({ placement: null, portal, menuParent: "payments", route, label: "Payments", order: 1, environments: ["uat", "prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false, ...overrides });

/** The platform-policy fields onboarding no longer asks for. */
const REMOVED_FIELDS = ["Runtimes", "Runtime", "Entitlement codes", "Inherit from", "Capabilities", "Portal capabilities it requires", "Allowed origins", "Shared dependencies", "Events", "Context", "Host settings", "Federation runtime versions"];

async function expectNoPlatformPolicy(page: Page) {
  for (const field of REMOVED_FIELDS) await expect(page.getByLabel(field, { exact: true }), field).toHaveCount(0);
}

async function save(page: Page, control: Locator) {
  const before = await lockVersion(page).inputValue();
  await control.click();
  await expect(lockVersion(page)).not.toHaveValue(before);
  await waitForHydration(page);
}

async function next(page: Page, step: string) {
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(heading(page, step)).toBeVisible();
  await waitForHydration(page);
}

async function create(page: Page, kind: "portals" | "applications", noun: string, name: string, first: string, sealId = "") {
  await page.goto(`/onboarding/${kind}/new`);
  await waitForHydration(page);
  if (kind === "portals") {
    // The Create Portal form asks for a platform, SEAL ID, name, and description, and records who created it without asking (portal-creation spec).
    await page.getByRole("group", { name: /^Platform/ }).getByRole("radio", { name: /^Web/ }).check();
    await page.getByLabel("SEAL ID").fill(sealId || "88001");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Description").fill(`The ${name} Portal`);
  } else {
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Owning team").fill("Payments");
    if (sealId) await page.getByLabel("SEAL ID").fill(sealId);
    await page.getByLabel("Your name").fill("Ana Ruiz");
  }
  await page.getByRole("button", { name: `Create ${noun}` }).click();
  await expect(heading(page, first)).toBeVisible();
  await waitForHydration(page);
  // The Draft's Identity step asks for the owning team, which Create Portal leaves to it; the next step's save keeps it.
  if (kind === "portals") await page.getByLabel("Owning team").fill("Payments");
}

async function submit(page: Page, name: string) {
  await expect(page.getByText("No issues")).toBeVisible();
  // Create Portal records who created it without asking, so the first submission is where a name is given.
  const actor = page.getByLabel("Your name");
  if ((await actor.count()) && !(await actor.inputValue())) await actor.fill("Ana Ruiz");
  await page.getByRole("button", { name: "Submit revision 1" }).click();
  await expect(heading(page, name)).toBeVisible();
  await waitForHydration(page);
}

/** Opens a pending review and decides it, approving with any accepted values the owner changes. */
async function decideReview(page: Page, title: string, decision: "Approve" | "Reject", options: { reason?: string; codes?: string; operator?: "Any one of them" | "All of them" } = {}) {
  await page.goto("/onboarding/reviews?state=pending");
  await page.getByRole("link", { name: title }).click();
  await expect(heading(page, title)).toBeVisible();
  await waitForHydration(page);
  await page.getByRole("button", { name: decision }).click();
  const dialog = page.getByRole("dialog");
  if (options.reason) await dialog.getByLabel("Reason").fill(options.reason);
  if (options.codes !== undefined) await dialog.getByLabel("Entitlement codes").fill(options.codes);
  if (options.operator) await dialog.getByLabel("A visitor needs").selectOption({ label: options.operator });
  await dialog.getByLabel("Your name").fill("Cy Okafor");
  await dialog.getByRole("button", { name: decision }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText(`${title} is ${decision === "Approve" ? "approved" : "rejected"}.`)).toBeVisible();
}

test.describe("onboarding acceptance", () => {
  let studio: RecordingServer;
  let cdaas: RecordingServer;
  let config: ReturnType<typeof loadConfig>;

  test.beforeEach(async () => {
    studio = await recordingServer();
    cdaas = await recordingServer();
    studio.route("/api/v1/environments", json([{ id: 4, label: "PROD", description: "" }, { id: 2, label: "UAT", description: "" }, { id: 3, label: "SIT", description: "" }]));
    studio.route("/api/v1/module/6f1d", json(studioModuleResponse("6f1d", { title: "Payee hub", types: [{ id: 2, name: "Module Federation" }] })));
    for (const view of ["payee-hub", "payee-search"]) cdaas.route(`/v1/apps/payee/views/${view}`, json(cdaasVersionsResponse([{ versionName: "1.4.0", live: true }])));
    config = loadConfig({ env: { ...process.env, ...E2E_ENV, FABRICATE_STUDIO_URL: studio.base, FABRICATE_CDAAS_URL: cdaas.base } });
  });

  test.afterEach(async () => {
    await studio.close();
    await cdaas.close();
  });

  test("a Portal team selects predefined environments, builds a menu, approves placements with their entitlements, assigns defaults, and activates, configuring no runtime, contract, or Portal entitlements", async ({ page, db }) => {
    await refreshEnvironmentCatalog(db, config);

    await create(page, "portals", "Portal", "Access", "Identity", "88001");
    await expectNoPlatformPolicy(page);
    await next(page, "Environments");
    await expect(page.getByText(/^From Studio, read /)).toBeVisible();
    const enabled = page.getByRole("group", { name: "The Portal enables" });
    await expect(enabled.locator("label")).toHaveText(["UAT", "SIT", "PROD"]);
    await enabled.getByLabel("UAT").check();
    await enabled.getByLabel("PROD").check();
    await expectNoPlatformPolicy(page);
    await next(page, "Menu");
    await save(page, page.getByRole("button", { name: "Add menu group" }));
    await page.getByLabel("Label", { exact: true }).fill("Payments");
    await page.getByLabel("Key", { exact: true }).fill("payments");
    await next(page, "Review and submit");
    await expectNoPlatformPolicy(page);
    await submit(page, "Access");
    await expect(lifecycle(page)).toHaveText("Ready");
    const access = /portals\/(ptl_[a-z0-9]+)/.exec(page.url())![1]!;
    expect(db.$client.prepare("select format_version as version, runtimes, contract, environment_catalog_source as source from portal_revisions").get()).toEqual({ version: 2, runtimes: null, contract: null, source: "studio" });

    // Applications ask to be placed; the Portal team decides each, with its entitlements.
    const workspace = onboardApplication(db, "Payments workspace", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" }, placements: [request(access, "/payments", { defaultRequested: true, entitlements: { codes: ["PAYMENTS_VIEW"], operator: "any" } })] }).application;
    onboardApplication(db, "Payments reporting", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/reports" }, placements: [request(access, "/reports", { environments: ["prod"] })] });
    await decideReview(page, "Payments workspace · Access", "Approve", { codes: "PAYMENTS_VIEW\nPAYMENTS_ADMIN", operator: "All of them" });
    await decideReview(page, "Payments reporting · Access", "Approve");
    expect(JSON.parse(db.$client.prepare("select accepted_entitlements from placement_decisions where placement_id = (select id from application_placements where public_id = ?)").pluck().get(placementsOf(db, workspace.publicId)[0]) as string)).toEqual({ codes: ["PAYMENTS_ADMIN", "PAYMENTS_VIEW"], operator: "all" });

    await page.goto(`/onboarding/portals/${access}`);
    await waitForHydration(page);
    const defaults = page.getByRole("table", { name: "Default routes" });
    for (const environment of ["PROD", "UAT"]) await expect(defaults.getByRole("row", { name: new RegExp(environment) })).toContainText("Payments workspace at /payments");
    await defaults.getByRole("row", { name: /PROD/ }).getByRole("button", { name: "Change" }).click();
    const dialog = page.getByRole("dialog", { name: "Choose Access's default in PROD" });
    await dialog.getByLabel("Default placement").selectOption({ label: "Payments reporting at /reports" });
    await dialog.getByLabel("Your name").fill("Cy Okafor");
    await dialog.getByRole("button", { name: "Save default" }).click();
    await expect(defaults.getByRole("row", { name: /PROD/ })).toContainText("Payments reporting at /reports");
    await waitForHydration(page);
    await page.getByRole("button", { name: "Activate revision 1" }).click();
    await page.getByRole("dialog").getByLabel("Your name").fill("Cy Okafor");
    await page.getByRole("dialog").getByRole("button", { name: "Activate revision 1" }).click();
    await expect(lifecycle(page)).toHaveText("Active");
    expect(db.$client.prepare("select count(*) as n from portal_environments where runtime is not null or entitlements is not null").get()).toEqual({ n: 0 });

    // Studio was only read, for its environment list.
    expect(studio.requests.map((item) => `${item.method} ${item.path}`)).toEqual(["GET /api/v1/environments"]);
    expect(cdaas.requests).toEqual([]);
  });

  test("an Application team reuses and registers MFEs, configures launch and composition, requests placements and entitlements, and reaches Ready, authoring no platform capability or contract", async ({ page, db }) => {
    const refresh = () => drainJobs(db, jobHandlers(db, config));
    buildSource(db, { name: "payee-monorepo" });
    onboardPortal(db, "Access");
    onboardPortal(db, "Markets", { sealId: "88002" });
    // A shared MFE another team already registered, mapped to its Studio module.
    const hub = registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "payee-hub" }), rendering: MFE_RENDERING, cdaas: { appId: "payee", viewId: "payee-hub" }, confirmed: false });
    declareReference(db, { system: "studio", resourceType: "module", externalId: "6f1d", subject: { kind: "microfrontend", id: hub.id }, source: "person", actor: ana });

    await create(page, "applications", "Web Application", "Payee workspace", "Name and owner", "88001");
    await expectNoPlatformPolicy(page);
    await next(page, "Launch target");
    await page.getByLabel("A registered MFE").check();
    await page.getByLabel("MFE", { exact: true }).selectOption({ label: "Payee hub" });
    await save(page, page.getByRole("button", { name: "Save draft" }));

    // The composition: register the missing MFE without leaving the Draft, and come back to it.
    await page.goto(page.url().split("?")[0]!.split("#")[0]!.replace("/launch", "/composition"));
    await waitForHydration(page);
    await page.getByRole("link", { name: "Register MFE" }).click();
    await expect(heading(page, "Register MFE")).toBeVisible();
    await waitForHydration(page);
    await page.getByLabel("Name", { exact: true }).fill("Payee search");
    await page.getByLabel("Your name").fill("Ana Ruiz");
    await page.getByRole("button", { name: "Create MFE" }).click();
    await expect(heading(page, "Built from")).toBeVisible();
    await waitForHydration(page);
    await page.getByLabel("Repository", { exact: true }).selectOption({ label: "payee-monorepo" });
    await page.getByLabel("Workspace path").fill("apps/search");
    await next(page, "CDaaS view");
    await page.getByLabel("appId").fill("payee");
    await page.getByLabel("viewId").fill("payee-search");
    await next(page, "Rendering");
    await expectNoPlatformPolicy(page);
    await page.getByLabel("A Module Federation 2 host can load it").check();
    await page.getByLabel("Exposed modules").fill("./Widget");
    await next(page, "Review and submit");
    await page.getByRole("button", { name: "Submit revision 1" }).click();
    await expect(heading(page, "Composition")).toBeVisible();
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("The MFE's revision is submitted.")).toBeVisible();

    // Reconciliation reads both MFEs' CDaaS views and the shared one's Studio module.
    for (const name of ["Payee hub", "Payee search"]) {
      const id = db.$client.prepare("select public_id from microfrontends where name = ?").pluck().get(name) as string;
      await page.goto(`/onboarding/microfrontends/${id}`);
      await waitForHydration(page);
      await page.getByRole("button", { name: "Read again" }).click();
      await expect(page.getByRole("region", { name: "Notifications" }).getByText(/A read of .* is queued\./)).toBeVisible();
    }
    expect((await refresh()).length).toBe(2);

    // The launch: two agreeing sources propose Module Federation 2, and the team confirms it.
    const application = db.$client.prepare("select public_id from applications where name = 'Payee workspace'").pluck().get() as string;
    await page.goto(`/onboarding/applications/${application}/draft/launch`);
    await waitForHydration(page);
    await expect(page.getByText("The evidence proposes one mode:")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Studio module type: Studio module 6f1d" })).toBeVisible();
    await page.getByLabel("Your name").fill("Ana Ruiz");
    await save(page, page.getByRole("listitem").filter({ hasText: "Module Federation 2 · ./App" }).getByRole("button", { name: "Confirm Module Federation 2" }));
    await expect(page.getByText("Confirmed from the evidence")).toBeVisible();
    await next(page, "Composition");
    const shared = page.getByRole("list", { name: "Shared MFEs" });
    await save(page, shared.getByRole("button", { name: "Add Payee search as a child" }));
    await page.getByLabel("Mounts at").selectOption("slot");
    await page.getByLabel("Route or slot").fill("search");
    await expectNoPlatformPolicy(page);

    // Placements, each choosing its Portal's environments and requesting its entitlements.
    await next(page, "Placements");
    for (const [index, portal] of ["Access", "Markets"].entries()) {
      await save(page, page.getByRole("button", { name: "Add placement" }));
      await page.getByLabel("Portal", { exact: true }).nth(index).selectOption({ label: portal });
      const environments = page.getByRole("group", { name: "Environments" }).nth(index);
      await environments.getByLabel("UAT").check();
      await environments.getByLabel("PROD").check();
      await page.getByLabel("Menu group").nth(index).selectOption({ label: "Payments" });
      await page.getByLabel("Route", { exact: true }).nth(index).fill("/payee");
    }
    await page.getByLabel("Entitlement codes").first().fill("PAYEE_VIEW");
    await page.getByLabel("Ask to be the Portal's default route").first().check();
    await next(page, "Review and submit");
    await submit(page, "Payee workspace");
    const revision = db.$client.prepare("select document, format_version as version, required_capabilities as capabilities from application_revisions where state = 'submitted'").get() as { document: string; version: number; capabilities: string | null };
    expect(revision).toMatchObject({ version: 2, capabilities: null });
    expect(revision.document).not.toMatch(/requiredCapabilities|hostContract|hostConfiguration|"environments":\["prod","uat"\],"launch"/);

    // Each Portal decides on its own: Access approves, keeping the requested entitlements and making it the default; Markets rejects.
    await decideReview(page, "Payee workspace · Markets", "Reject", { reason: "Markets serves payees from its own workspace" });
    await decideReview(page, "Payee workspace · Access", "Approve");
    await page.goto(`/onboarding/applications/${application}`);
    await expect(lifecycle(page)).toHaveText("Ready");
    await expect(page.getByLabel("Composition outline")).toContainText("Child Payee search (./Widget) at slot search, required");

    // Studio and CDaaS were only read.
    expect(studio.requests.map((item) => `${item.method} ${item.path}`)).toEqual(["GET /api/v1/module/6f1d"]);
    expect(cdaas.requests.map((item) => `${item.method} ${item.path}`).sort()).toEqual(["GET /v1/apps/payee/views/payee-hub", "GET /v1/apps/payee/views/payee-search"]);
  });
});
