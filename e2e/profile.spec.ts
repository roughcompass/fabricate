import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { listAssessments } from "../src/lib/assessments/assessment-records";
import { resolveCloneUrl } from "../src/lib/catalog/catalog";
import { SourceBoundary } from "../src/lib/catalog/source-boundary";
import { insertSource } from "../src/lib/catalog/source-records";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { profilesOf } from "../src/lib/profiles/profile-records";
import { buildInitiative, buildSource } from "../test/support/builders";
import { manifest } from "../test/support/profiles";
import { seedAssessment } from "../test/support/scenarios";
import { ORDERS, serverConfig } from "./support/results";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, gitRepo, test } from "./support/fixtures";

const category = (page: Page, id: string) => page.locator(`#${id}`);
const service = (page: Page, key: string) => page.locator("#services").getByRole("region", { name: key, exact: true });
/** Opens a Service Dependency's panel. */
const expand = async (region: Locator) => {
  await region.locator("summary").click();
  return region;
};
/** The value a details list gives for +term+. */
const detail = (region: Locator, term: string) => region.locator(`xpath=.//dt[normalize-space()='${term}']/following-sibling::dd[1]`);

async function seedOrders(db: Parameters<typeof seedAssessment>[0]) {
  const orders = buildSource(db, { name: "orders" });
  const initiative = buildInitiative(db, { name: "Fleet assessment", sources: [orders] });
  const assessment = await seedAssessment(db, initiative, [orders], [ORDERS]);
  return { orders, initiative, assessment, profile: profilesOf(db, assessment.id)[0]!.profile };
}

test("explains observed, inferred, unknown, conflicting, negative, and skipped-input facts", async ({ page, db }) => {
  const { profile } = await seedOrders(db);
  await page.goto(`/profiles/${profile.publicId}`);
  await expect(page.getByRole("heading", { level: 1, name: "orders" })).toBeVisible();
  await expect(page.getByText("Nothing in the repository was run.")).toBeVisible();

  const languages = category(page, "languages");
  await expect(languages.getByText("Observed").first()).toBeVisible();
  await expect(languages.getByRole("row").filter({ hasText: "TypeScript" })).toBeVisible();

  const managers = category(page, "package_managers");
  await expect(managers.getByText("Inferred").first()).toBeVisible();
  await expect(managers).toContainText("yarn.lock is the lockfile yarn writes, so yarn manages this directory.");
  await expect(managers.getByRole("link", { name: "yarn.lock" })).toBeVisible();

  const runtime = category(page, "runtime_requirements");
  await expect(runtime.getByText("Conflicting").first()).toBeVisible();
  const candidates = runtime.getByRole("list", { name: "Candidates" }).locator(":scope > li");
  await expect(candidates).toHaveCount(2);
  await expect(candidates.filter({ hasText: "declared: 18" }).getByRole("link", { name: ".nvmrc:1" })).toBeVisible();
  await expect(candidates.filter({ hasText: "declared: >=20" }).getByRole("link", { name: "package.json /engines/node" })).toBeVisible();

  // A parse failure makes CI unknown and names the input, never "none detected".
  const ci = category(page, "ci_systems");
  await expect(ci.getByText("Unknown").first()).toBeVisible();
  await expect(ci).toContainText("1 relevant input could not be read or understood");
  await expect(ci).toContainText(".github/workflows/ci.yml");
  await expect(category(page, "resolved_dependencies")).toContainText("no bounded search can establish this category");

  const submodules = category(page, "submodules");
  await expect(submodules.getByText("None detected").first()).toBeVisible();
  await expect(submodules).toContainText("None detected: no input this category reads exists in this commit.");
  await expect(category(page, "test_frameworks")).toContainText("None detected after a complete search of 1 input.");

  const access = category(page, "access_signals");
  await expect(access.getByText("Mixed").first()).toBeVisible();
  await expect(access).toContainText("likely reachable only from inside one");
  await expect(access).toContainText("LEDGER_TOKEN");

  const skipped = page.getByRole("table", { name: "Skipped inputs" });
  await expect(skipped.getByRole("row").filter({ hasText: ".github/workflows/ci.yml" })).toContainText("Could not be parsed");
  await expect(page.getByRole("table", { name: "Other diagnostics" })).toContainText("Unlocked dependency");

  // Seeded snapshots have no mirror: the record still identifies the content.
  await managers.getByRole("link", { name: "yarn.lock" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "yarn.lock" })).toBeVisible();
  await expect(page.getByText("lockfile.package-manager")).toBeVisible();
  await expect(page.getByText("Excerpt unavailable")).toBeVisible();
});

test("shows an unavailable Service Dependency's call boundary, missing evidence, and static-only limitation", async ({ page, db }) => {
  const { profile } = await seedOrders(db);
  await page.goto(`/profiles/${profile.publicId}`);
  const services = page.locator("#services");
  await expect(services.getByText("Static discovery does not prove entitlement, reachability, or integrated behavior", { exact: false })).toBeVisible();

  const payments = service(page, "https://payments.invalid");
  await expect(payments).toContainText("Boundary characterized");
  await expand(payments);
  await expect(detail(payments, "Endpoint")).toContainText("derivation: literal; origin: https://payments.invalid");
  await expect(detail(payments, "Operations")).toContainText("POST /v1/charges");
  await expect(detail(payments, "Consumed response fields")).toContainText("status");
  await expect(detail(payments, "Access")).toContainText("Static discovery cannot establish entitlement, credentials, or reachability");
  await expect(detail(payments, "Missing evidence")).toHaveText("authentication, retry, proxy");
  await expect(detail(payments, "Contracts")).toContainText("None detected after a complete search");
  await expect(detail(payments, "Test substitutes")).toContainText("None detected after a complete search");
  await expect(detail(payments, "Proxy expectation")).toContainText("Unknown");
  await expect(detail(payments, "Call sites").getByRole("link", { name: "src/payments.ts:2" })).toBeVisible();

  const ledger = service(page, "https://ledger.corp.internal");
  await expect(ledger).toContainText("Boundary incomplete");
  await expand(ledger);
  await expect(detail(ledger, "Authentication signals")).toContainText("template from process.env.LEDGER_TOKEN");
  await expect(detail(ledger, "Missing evidence")).toContainText("consumed response fields");

  // Nothing offers to connect, fabricate a response, or test the service.
  await expect(services.getByRole("button")).toHaveCount(0);
  await expect(services.getByRole("link", { name: /connect|test|mock|try/i })).toHaveCount(0);
});

test("marks an earlier Profile historical and links to the newest one", async ({ page, db }) => {
  const { orders, initiative, profile: earlier } = await seedOrders(db);
  const later = await seedAssessment(db, initiative, [orders], [{ ...ORDERS, ".nvmrc": "20\n" }]);
  const newest = profilesOf(db, later.id)[0]!.profile;

  await page.goto(`/profiles/${earlier.publicId}`);
  await expect(page.getByText("This is a historical Profile")).toBeVisible();
  await expect(category(page, "runtime_requirements").getByText("Conflicting").first()).toBeVisible();
  await page.getByRole("link", { name: "View the newest Profile" }).click();
  await expect(page).toHaveURL(new RegExp(`/profiles/${newest.publicId}$`));
  await expect(page.getByText("This is a historical Profile")).toHaveCount(0);
  await expect(category(page, "runtime_requirements").getByText("Observed").first()).toBeVisible();
});

test("the Profile stays readable at mobile width", async ({ page, db }) => {
  const { profile } = await seedOrders(db);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/profiles/${profile.publicId}`);
  await expect(page.getByRole("heading", { level: 1, name: "orders" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoOverlappingContent(page);
});

test("opens verified evidence excerpts from a real snapshot without rendering URL credentials", async ({ page, db, sourcesDir }) => {
  const config = serverConfig();
  const repository = gitRepo(path.join(sourcesDir, "orders"), {
    "package.json": manifest({ name: "orders", version: "1.0.0" }),
    "yarn.lock": "# yarn lockfile v1\n\n",
    "src/payments.ts": 'export async function charge(id: string) {\n  const res = await fetch("https://svc:hunter2@payments.invalid/v1/charges", { method: "POST", body: JSON.stringify({ id }) });\n  return (await res.json()).status;\n}\n',
  });
  const source = insertSource(db, { name: "orders", ...resolveCloneUrl(`file://${repository}`, new SourceBoundary(config)), gitRef: null });
  const initiative = buildInitiative(db, { name: "Fleet assessment", sources: [source] });
  await page.goto(`/initiatives/${initiative.publicId}`);
  await page.getByRole("button", { name: "Start Assessment" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Assessment #1 was started.")).toBeVisible();
  await drainJobs(db, jobHandlers(db, config));
  const assessment = listAssessments(db, initiative.id)[0]!;

  await page.goto(`/assessments/${assessment.publicId}`);
  await page.getByRole("link", { name: "orders Profile" }).click();
  await category(page, "package_managers").getByRole("link", { name: "yarn.lock" }).click();
  await expect(page.getByText("lockfile.package-manager")).toBeVisible();
  await expect(page.getByText("This evidence is the presence, type, or mode of the path itself")).toBeVisible();

  await page.goBack();
  for (const summary of await page.locator("#services summary").all()) await summary.click();
  await page.locator("#services").getByRole("link", { name: "src/payments.ts:2" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "src/payments.ts:2" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Record" })).toContainText("Line 2");
  const excerpt = page.getByLabel("Excerpt of src/payments.ts");
  await expect(excerpt).toContainText("[redacted]@payments.invalid/v1/charges");
  await expect(excerpt).toContainText("2");
  await expect(page.locator("body")).not.toContainText("hunter2");
});

test("navigates between categories and keeps categories without facts compact", async ({ page, db }) => {
  const { profile } = await seedOrders(db);
  await page.goto(`/profiles/${profile.publicId}`);
  // A current Profile has no alert.
  await expect(page.locator("#page-alerts")).toBeEmpty();

  const nav = page.getByRole("navigation", { name: "Profile sections" });
  const managers = nav.getByRole("link", { name: /^Package manager/ }).first();
  await managers.click();
  await expect(page).toHaveURL(/#package_managers$/);
  await expect(managers).toHaveAttribute("aria-current", "location");
  await expect(category(page, "package_managers")).toBeInViewport();

  // A category with nothing to show is one row in a list, not a card with a table.
  const submodules = category(page, "submodules");
  await expect(submodules).toHaveJSProperty("tagName", "LI");
  await expect(submodules.getByRole("table")).toHaveCount(0);
  await expect(submodules).toContainText("None detected");
});

test("links an evidence record to each ancestor, with no other way back", async ({ page, db }) => {
  const { profile, initiative, assessment } = await seedOrders(db);
  await page.goto(`/profiles/${profile.publicId}`);
  await category(page, "package_managers").getByRole("link", { name: "yarn.lock" }).click();
  const breadcrumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumbs.getByRole("link")).toHaveText(["Initiatives", initiative.name, "Assessment #1", "orders"]);
  await expect(breadcrumbs.getByRole("link", { name: "Assessment #1" })).toHaveAttribute("href", `/assessments/${assessment.publicId}`);
  await expect(page.locator("main").getByRole("link", { name: /back/i })).toHaveCount(0);
});
