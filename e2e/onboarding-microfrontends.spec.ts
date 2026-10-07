import type { Page } from "@playwright/test";
import { createWebApplication } from "../src/lib/onboarding/applications";
import { getMicrofrontend } from "../src/lib/onboarding/microfrontends";
import { buildSource } from "../test/support/builders";
import { rawRun } from "../test/support/db";
import { MFE_RENDERING, ana, cdaasView, observeCdaas, onboardApplication, registerMfe } from "../test/support/onboarding";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { seedOnboardingSurfaces } from "./support/onboarding-surfaces";
import { expectCurrentItem, waitForHydration } from "./support/shell";

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

/** Registers an MFE from a new Application's composition, as an Application team does, and opens its Draft's first step. */
async function createMfe(page: Page, db: Parameters<typeof createWebApplication>[0], name: string) {
  const { application } = createWebApplication(db, { name: "Payments workspace", ownerTeam: "Payments" }, ana);
  await page.goto(`/onboarding/applications/${application.publicId}/microfrontends/new`);
  await waitForHydration(page);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await page.getByRole("button", { name: "Create MFE" }).click();
  await expect(heading(page, "Built from")).toBeVisible();
  await waitForHydration(page);
  return application;
}

test("registers an MFE from its Repository, CDaaS view, and rendering metadata, staying Draft until CDaaS confirms the view (Register ESM MFE)", async ({ page, db }) => {
  await createMfe(page, db, "Payee search");
  await expectCurrentItem(page, "Web Onboarding", "Web Applications");

  // No Repository yet: the step says where to add one.
  await expect(page.getByText("No enabled Repositories yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "New Repository" })).toHaveAttribute("href", "/repositories/new");

  buildSource(db, { name: "payee-monorepo" });
  buildSource(db, { name: "ledger" });
  await page.reload();
  await waitForHydration(page);
  await page.getByRole("searchbox", { name: "Search Repositories" }).fill("payee");
  await page.getByRole("searchbox", { name: "Search Repositories" }).press("Enter");
  await expect(page).toHaveURL(/q=payee/);
  await expect(page.getByLabel("Repository", { exact: true }).locator("option")).toHaveText(["Choose a Repository", "payee-monorepo"]);
  await waitForHydration(page);
  await page.getByLabel("Repository", { exact: true }).selectOption({ label: "payee-monorepo" });
  await page.getByLabel("Workspace path").fill("./apps//search/");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(heading(page, "CDaaS view")).toBeVisible();
  await waitForHydration(page);
  await page.getByLabel("appId").fill("payee");
  await page.getByLabel("viewId").fill("search");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(heading(page, "Rendering")).toBeVisible();
  await waitForHydration(page);
  // Only how each mode loads it: nothing it requires of a host, provides, emits, or shares.
  for (const field of ["Requires", "Provides", "Events", "Context", "Shared dependencies", "Owner email"]) await expect(page.getByLabel(field, { exact: true })).toHaveCount(0);
  await page.getByLabel("It can be imported as an ESM module").check();
  await page.getByLabel("Exported modules").fill("./Search");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(heading(page, "Review and submit")).toBeVisible();
  await waitForHydration(page);
  await page.getByRole("button", { name: "Submit revision 1" }).click();
  // Submitting returns to the composition it was registered from.
  await expect(heading(page, "Composition")).toBeVisible();

  const id = db.$client.prepare("select public_id from microfrontends where name = 'Payee search'").pluck().get() as string;
  await page.goto(`/onboarding/microfrontends/${id}`);
  await expect(heading(page, "Payee search")).toBeVisible();
  const overview = page.getByRole("main");
  await expect(overview.locator("dt", { hasText: "Renders through" }).locator("+ dd")).toHaveText("ESM module (./Search)");
  await expect(overview.getByText("payee-monorepo · apps/search")).toBeVisible();
  await expect(overview.getByText("payee/search", { exact: true }).first()).toBeVisible();
  // Never read yet: Unknown, which isn't confirmation, and the MFE stays Draft.
  await expect(page.getByRole("banner").or(overview).getByText("Draft").first()).toBeVisible();
  await expect(overview.getByText("Unknown").first()).toBeVisible();
  await expect(overview.getByText("Matching")).toHaveCount(0);

  observeCdaas(db, getMicrofrontend(db, id), { outcome: "found", projection: cdaasView("payee", "search", 2) });
  await page.reload();
  await expect(overview.getByText("Matching").first()).toBeVisible();
  await expect(page.getByRole("table", { name: "Observed versions" }).getByRole("row")).toHaveCount(3);
});

test("never shows Unknown or Conflicting CDaaS evidence as confirmation", async ({ page, db }) => {
  const repository = buildSource(db, { name: "payee" });
  const unknown = registerMfe(db, "Payee details", { repository, workspacePath: "apps/details", rendering: MFE_RENDERING, confirmed: false });
  observeCdaas(db, unknown, { outcome: "unavailable", error: "CDaaS didn't answer in time" });
  const conflicting = registerMfe(db, "Payee history", { repository, workspacePath: "apps/history", rendering: MFE_RENDERING, confirmed: false });
  observeCdaas(db, conflicting, { outcome: "found", projection: cdaasView("payee", "payee-history-v2") });

  for (const [mfe, state] of [
    [unknown, "Unknown"],
    [conflicting, "Conflicting"],
  ] as const) {
    await page.goto(`/onboarding/microfrontends/${mfe.publicId}`);
    const main = page.getByRole("main");
    const confirmation = main.locator("dt", { hasText: "CDaaS confirmation" }).locator("+ dd");
    await expect(confirmation).toHaveText(state);
    await expect(main.locator("dt", { hasText: "Lifecycle" }).locator("+ dd")).toHaveText("Draft");
    const check = page.getByRole("table", { name: "Readiness checks" }).getByRole("row", { name: /CDaaS view/ });
    await expect(check).toContainText(state === "Unknown" ? "Unknown" : "Fails");
    await expect(main.getByText(state).first()).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Observed versions" }).or(page.getByRole("main")).getByText("Not confirmed: Conflicting")).toBeVisible();
});

test("shows a disabled Repository with where to enable it, and keeps it chosen", async ({ page, db }) => {
  const repository = buildSource(db, { name: "legacy-widgets" });
  await createMfe(page, db, "Legacy widget");
  await page.getByLabel("Repository", { exact: true }).selectOption({ label: "legacy-widgets" });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("The Draft is saved.")).toBeVisible();
  rawRun(db, "update repository_sources set enabled = 0 where id = ?", repository.id);
  await page.reload();
  await expect(page.getByLabel("Repository", { exact: true })).toHaveValue(repository.publicId);
  await expect(page.getByRole("link", { name: "Find legacy-widgets in Repositories" })).toHaveAttribute("href", "/repositories?status=disabled&q=legacy-widgets");
  await expect(page.getByText(/legacy-widgets is disabled in the catalog/)).toHaveCount(1);
  await expect(page.getByLabel("Repository", { exact: true })).toHaveAccessibleDescription(/legacy-widgets is disabled in the catalog\. Ask an operator to enable it/);
});

test("shows one MFE as one Application's entry and another's child, and previews a rendering change against both", async ({ page, db }) => {
  const repository = buildSource(db, { name: "payee" });
  const hub = registerMfe(db, "Payee hub", { repository });
  onboardApplication(db, "Payee hub", { launch: { kind: "mfe", microfrontend: hub.publicId, mode: "module_federation_2", exposedModule: "./App" } });
  onboardApplication(db, "Payments console", {
    launch: { kind: "external", mode: "esm", moduleUrl: "https://cdn.example.com/console.js", exportedModule: "mount" },
    children: [{ microfrontend: hub.publicId, mountKind: "route", mountKey: "/payee", required: true, module: null }],
  });

  await page.goto(`/onboarding/microfrontends/${hub.publicId}`);
  await expect(heading(page, "Payee hub")).toBeVisible();
  const uses = page.getByRole("table", { name: "Used by" });
  await expect(uses.getByRole("row").nth(1)).toContainText("Payee hub");
  await expect(uses.getByRole("row").nth(1)).toContainText("Entry: the Application's launch target");
  await expect(uses.getByRole("row").nth(2)).toContainText("Payments console");
  await expect(uses.getByRole("row").nth(2)).toContainText("Launches an external endpoint");
  await expect(uses.getByRole("row").nth(2)).toContainText("Route /payee");

  await waitForHydration(page);
  await page.getByRole("button", { name: "Start a Draft" }).click();
  await page.getByRole("dialog").getByLabel("Your name").fill("Ana Ruiz");
  await page.getByRole("dialog").getByRole("button", { name: "Start Draft" }).click();
  await expect(heading(page, "Name and owner")).toBeVisible();
  // The old contract step's address opens the rendering step.
  await page.goto(`/onboarding/microfrontends/${hub.publicId}/draft/contract`);
  await expect(heading(page, "Rendering")).toBeVisible();
  await waitForHydration(page);
  const using = page.getByRole("table", { name: "Applications using it" });
  await expect(using.getByText("Still offered")).toHaveCount(2);
  await page.getByLabel("A Module Federation 2 host can load it").uncheck();
  await page.getByLabel("It can be imported as an ESM module").check();
  await page.getByLabel("Exported modules").fill("./Main");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("The Draft is saved.")).toBeVisible();
  await expect(using.getByText("No longer offered")).toHaveCount(2);
  await expect(using.getByRole("row").filter({ hasText: "Payee hub" })).toContainText("It can no longer be loaded through Module Federation 2, which Payee hub launches it with");
  await expect(using.getByRole("row").filter({ hasText: "Payments console" })).toContainText("It no longer names ./App, which Payments console mounts at route /payee");
});

test("shows a rendering field error once, at its field", async ({ page, db }) => {
  const hub = registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "payee" }) });
  await page.goto(`/onboarding/microfrontends/${hub.publicId}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Start a Draft" }).click();
  await page.getByRole("dialog").getByLabel("Your name").fill("Ana Ruiz");
  await page.getByRole("dialog").getByRole("button", { name: "Start Draft" }).click();
  await expect(heading(page, "Name and owner")).toBeVisible();
  await page.goto(`/onboarding/microfrontends/${hub.publicId}/draft/rendering`);
  await waitForHydration(page);
  await page.getByLabel("Exposed modules").fill("has space");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("The Draft is saved.")).toBeVisible();
  const exposes = page.getByLabel("Exposed modules");
  await expect(exposes).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("A module name has no spaces", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /^Rendering/ })).toContainText("1");

  await page.getByLabel("Exposed modules").fill("./App\n./Widget");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByLabel("Exposed modules")).not.toHaveAttribute("aria-invalid", "true");
});

test("lists shared MFEs under Web Applications, with no create action of its own", async ({ page, db }) => {
  registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "payee" }) });
  await page.goto("/onboarding/applications");
  await page.getByRole("link", { name: "Shared MFEs" }).click();
  await expect(heading(page, "MFEs")).toBeVisible();
  await expectCurrentItem(page, "Web Onboarding", "Web Applications");
  await expect(page.getByRole("link", { name: "New MFE" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "MFEs" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "MFEs" })).toContainText("Payee hub");
  const response = await page.goto("/onboarding/microfrontends/new");
  expect(response?.status()).toBe(404);
});

test("fits desktop and 375px viewports in every MFE state and step", async ({ page, db }) => {
  const surfaces = seedOnboardingSurfaces(db).filter(([name]) => name.startsWith("21-mfe"));
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
