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
import { ORDERS, STOREFRONT, serverConfig } from "./support/results";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, gitRepo, test } from "./support/fixtures";
import { paths } from "./support/paths";

const category = (page: Page, id: string) => page.locator(`#${id}`);
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A Service Dependency's panel, by the start of its summary: its endpoint. */
const service = (page: Page, endpoint: string) => page.locator("#services").getByRole("region", { name: new RegExp(`^${escaped(endpoint)}`) });
/** Opens a Service Dependency's panel. */
const expand = async (region: Locator) => {
  await region.locator("summary").click();
  return region;
};
/** The value a details list gives for +term+. */
const detail = (region: Locator, term: string) => region.locator(`xpath=.//dt[normalize-space()='${term}']/following-sibling::dd[1]`);
/** Opens the evidence of the first row in +section+ that contains +text+, and returns the row. */
const openEvidence = async (section: Locator, text: string) => {
  const row = section.getByRole("row").filter({ hasText: text }).first();
  await row.getByRole("button", { name: /^Show \d+ locations?$/ }).click();
  return row;
};

async function seedOrders(db: Parameters<typeof seedAssessment>[0]) {
  const orders = buildSource(db, { name: "orders" });
  const initiative = buildInitiative(db, { name: "Fleet assessment", sources: [orders] });
  const assessment = await seedAssessment(db, initiative, [orders], [ORDERS]);
  return { orders, initiative, assessment, profile: profilesOf(db, assessment.id)[0]!.profile };
}

async function seedStorefront(db: Parameters<typeof seedAssessment>[0]) {
  const storefront = buildSource(db, { name: "storefront" });
  const initiative = buildInitiative(db, { name: "Storefront review", sources: [storefront] });
  const assessment = await seedAssessment(db, initiative, [storefront], [STOREFRONT]);
  return { storefront, initiative, assessment, profile: profilesOf(db, assessment.id)[0]!.profile };
}

test("leads with an overview of what the repository is, then what needs attention", async ({ page, db }) => {
  const { profile } = await seedStorefront(db);
  await page.goto(`/profiles/${profile.publicId}`);
  expect((await page.locator("main").getByRole("heading", { level: 2 }).allTextContents()).slice(0, 3)).toEqual(["Overview", "Needs attention", "Inventory"]);

  const overview = page.getByRole("region", { name: "Overview" });
  expect(await overview.locator("dt").allTextContents()).toEqual(["Packages", "Languages", "Framework", "Build", "Tests", "Tooling", "Runtime", "Composition", "Design system", "Scope"]);
  await expect(detail(overview, "Framework")).toContainText("React 19.1.0");
  await expect(detail(overview, "Framework").getByRole("link")).toHaveAttribute("href", "#frameworks");
  await expect(detail(overview, "Build")).toContainText("Vite");
  // An inferred value names its state; an observed one only for assistive technology.
  await expect(detail(overview, "Tooling")).toContainText("Inferred");
  // Unknown composition shows its state and reason, in the overview and in Needs attention.
  await expect(detail(overview, "Composition")).toContainText("Unknown");
  await expect(detail(overview, "Composition")).toContainText("cannot prove there is none");
  const attention = page.getByRole("list", { name: "Needs attention" });
  await expect(attention.getByRole("listitem").filter({ hasText: "Composition" })).toContainText("Unknown");
  await expect(page.getByRole("group", { name: "Categories by state" })).toContainText("observed");
});

test("explains observed, inferred, unknown, conflicting, negative, and skipped-input facts", async ({ page, db }) => {
  const { profile } = await seedOrders(db);
  await page.goto(`/profiles/${profile.publicId}`);
  await expect(page.getByRole("heading", { level: 1, name: "orders" })).toBeVisible();
  await expect(page.getByText("Nothing in the repository was run.")).toBeVisible();

  const languages = category(page, "languages");
  await expect(languages.getByText("Observed").first()).toBeVisible();
  await expect(languages.getByRole("row").filter({ hasText: "TypeScript" })).toBeVisible();

  // An inference explains itself beside its value, and its evidence is a row's panel away.
  const managers = category(page, "package_managers");
  await expect(managers.getByText("Inferred").first()).toBeVisible();
  await expect(managers.getByText("yarn.lock is the lockfile yarn writes, so yarn manages this directory.")).toBeVisible();
  const manager = await openEvidence(managers, "yarn");
  await expect(manager.getByRole("link", { name: "yarn.lock" })).toBeVisible();

  const runtime = category(page, "runtime_requirements");
  await expect(runtime.getByText("Conflicting").first()).toBeVisible();
  // A conflict's candidates read in the category's columns, one row each with its own location.
  await expect(runtime.getByRole("row").filter({ hasText: "2 candidates disagree" })).toBeVisible();
  const candidate = (location: string) => runtime.getByRole("row").filter({ has: page.getByRole("link", { name: location, exact: true }) });
  await expect(candidate(".nvmrc:1")).toContainText("18");
  await expect(candidate("package.json /engines/node")).toContainText(">=20");

  // A parse failure makes CI unknown and names the input, never "none detected".
  const ci = category(page, "ci_systems");
  await expect(ci.getByText("Unknown").first()).toBeVisible();
  await expect(ci).toContainText("1 relevant input could not be read or understood");
  await expect(ci).toContainText(".github/workflows/ci.yml");
  // No lockfile resolves any package: resolved versions are unknown, never none detected, said once above the table instead of in a column of placeholders.
  const axios = category(page, "dependencies").getByRole("row").filter({ hasText: "axios" });
  await expect(axios).not.toContainText("None detected");
  await expect(page.getByRole("table", { name: "Dependencies" }).getByRole("columnheader", { name: /Resolved/ })).toHaveCount(0);
  await expect(category(page, "resolved_dependencies").getByText("Unknown")).toBeVisible();
  await expect(category(page, "resolved_dependencies")).toContainText("Resolved versions aren't shown.");

  const submodules = category(page, "submodules");
  await expect(submodules.getByText("None detected").first()).toBeVisible();
  await expect(submodules).toContainText("No input this category reads exists in this commit");
  await expect(category(page, "test_frameworks")).toContainText("After a complete search of 1 input");

  const access = category(page, "access_signals");
  await expect(access.getByText("Mixed").first()).toBeVisible();
  await expect(access).toContainText("likely reachable only from inside one");
  await expect(access).toContainText("LEDGER_TOKEN");

  const skipped = page.getByRole("table", { name: "Skipped inputs" });
  await expect(skipped.getByRole("row").filter({ hasText: ".github/workflows/ci.yml" })).toContainText("Could not be parsed");
  await expect(page.getByRole("table", { name: "Other diagnostics" })).toContainText("Unlocked dependency");
  await expect(page.getByRole("list", { name: "Needs attention" }).getByRole("link", { name: "1 skipped input" })).toHaveAttribute("href", "#diagnostics");

  // Seeded snapshots have no mirror: the record still identifies the content.
  await manager.getByRole("link", { name: "yarn.lock" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "yarn.lock" })).toBeVisible();
  await expect(page.getByText("lockfile.package-manager")).toBeVisible();
  await expect(page.getByText("Excerpt unavailable")).toBeVisible();
});

test("shows each category's search and rule, and a row's state only where it differs", async ({ page, db }) => {
  const { profile } = await seedStorefront(db);
  await page.goto(`/profiles/${profile.publicId}`);

  // Every language is observed, as its category is: no row repeats the state.
  const languages = category(page, "languages");
  await expect(languages.getByRole("table").getByText("Observed")).toHaveCount(0);
  await expect(languages.getByRole("row").filter({ hasText: "TypeScript" }).getByRole("button", { name: /^Show \d+ locations?$/ })).toBeVisible();

  // How each category was searched is one disclosure away, since the column states say whether to look.
  await category(page, "dependencies").getByText("How these were found").click();
  const dependencies = category(page, "dependencies").getByRole("list", { name: "Categories in Dependencies" }).getByRole("listitem").first();
  await expect(dependencies).toContainText("Searched 1 input · complete");
  await expect(dependencies).toContainText("Rule manifest.dependencies");

  // A row's evidence panel holds its evidence, its fact key, and its raw value. The declaration and the consumed package cite the same location.
  const react = await openEvidence(category(page, "dependencies"), "react-dom");
  await expect(react.getByRole("link", { name: "package.json /dependencies/react-dom" }).first()).toBeVisible();
  await expect(react.getByRole("link", { name: "package-lock.json /packages/node_modules/react-dom/version" })).toBeVisible();
  await expect(react.getByText("package.json#dependencies/react-dom")).toBeVisible();
  await expect(react.getByLabel("Raw value of package.json#dependencies/react-dom")).toContainText('"specifier": "19.1.0"');
});

test("shows dependencies and scripts in shared tables, and CI steps with their definition", async ({ page, db }) => {
  const { profile } = await seedStorefront(db);
  await page.goto(`/profiles/${profile.publicId}`);

  const table = page.getByRole("table", { name: "Dependencies" });
  await expect(table.getByRole("row").filter({ hasText: "react-dom" })).toHaveCount(1);
  await expect(table.getByRole("row").filter({ hasText: "react-dom" })).toContainText("Production");
  await expect(table.getByRole("row").filter({ hasText: "vitest" })).toContainText("Development");
  for (const id of ["resolved_dependencies", "packages_consumed"]) await expect(page.getByRole("table", { name: id })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Resolved versions" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Packages consumed" })).toHaveCount(0);
  // The table's own state is in its heading; only the columns another category fills show that category's state.
  // A group that is one table of the same name is headed once.
  await expect(page.locator("main").getByRole("heading", { name: "Dependencies", exact: true })).toHaveCount(1);
  for (const column of ["Kind", "Declared"]) await expect(table.getByRole("columnheader").filter({ hasText: column })).not.toContainText("Observed");
  for (const column of ["Resolved", "Consumed"]) await expect(table.getByRole("columnheader").filter({ hasText: column })).toContainText("Observed");

  const nav = page.getByRole("navigation", { name: "Profile sections" });
  await nav.getByRole("link", { name: /^Resolved versions/ }).click();
  await expect(page).toHaveURL(/#resolved_dependencies$/);
  await expect(category(page, "resolved_dependencies")).toBeInViewport();
  await expect(table).toBeInViewport();

  const workflow = category(page, "ci_systems").getByRole("row").filter({ hasText: ".github/workflows/ci.yml" });
  await expect(workflow).toContainText("GitHub Actions");
  await expect(workflow).toContainText("npm test");
  await expect(workflow).toContainText("ci · step 3 · Test");

  const scripts = page.getByRole("table", { name: "Package scripts" });
  await expect(scripts.getByRole("row").filter({ hasText: "vitest run" })).toContainText("Test");
  await expect(scripts.getByRole("row").filter({ hasText: "start" })).toContainText("None");
  await expect(page.getByRole("table", { name: "Verification commands" })).toHaveCount(0);
});

test("filters the Dependencies table by kind and package, in the URL", async ({ page, db }) => {
  const { profile } = await seedStorefront(db);
  await page.goto(`/profiles/${profile.publicId}`);
  const table = page.getByRole("table", { name: "Dependencies" });
  const packages = table.getByRole("row").filter({ hasText: /Production|Development/ });
  await expect(packages).toHaveCount(6);

  await page.locator("#filter-kind").selectOption("devDependencies");
  await expect(page).toHaveURL(/kind=devDependencies/);
  await expect(page.getByText("Showing 4 of 6 dependencies")).toBeVisible();
  await expect(packages).toHaveCount(4);
  await expect(table.getByRole("row").filter({ hasText: "Production" })).toHaveCount(0);

  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/kind=/);
  await expect(packages).toHaveCount(6);

  await page.goto(`/profiles/${profile.publicId}?package=REACT`);
  await expect(page.getByText("Showing 2 of 6 dependencies")).toBeVisible();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("applies the Dependencies filters with Apply", async ({ page, db }) => {
    const { profile } = await seedStorefront(db);
    await page.goto(`/profiles/${profile.publicId}`);
    await page.locator("#filter-kind").selectOption("dependencies");
    await page.getByRole("form", { name: "Filter dependencies" }).getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/kind=dependencies/);
    await expect(page.getByText("Showing 2 of 6 dependencies")).toBeVisible();
  });
});

test("keeps the navigation in view while the Profile scrolls", async ({ page, db }) => {
  const { profile } = await seedStorefront(db);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/profiles/${profile.publicId}`);
  const nav = page.getByRole("navigation", { name: "Profile sections" });
  await category(page, "dependencies").evaluate((element) => element.scrollIntoView());
  await expect(nav.getByRole("link", { name: /^Dependencies/ })).toHaveAttribute("aria-current", "location");
  await expect(nav.getByRole("link", { name: /^Dependencies/ })).toBeInViewport();
  await page.mouse.wheel(0, 2000);
  await expect(nav.getByRole("list").first()).toBeInViewport();
});

test("shows an unavailable Service Dependency's call boundary, missing evidence, and static-only limitation", async ({ page, db }) => {
  const { profile } = await seedOrders(db);
  await page.goto(`/profiles/${profile.publicId}`);
  const services = page.locator("#services");
  await expect(services.getByText("Static discovery does not prove entitlement, reachability, or integrated behavior", { exact: false })).toBeVisible();

  const payments = service(page, "https://payments.invalid");
  await expect(payments).toContainText("Boundary characterized");
  await expect(payments.locator("summary")).toContainText("called through fetch");
  await expect(payments.locator("summary")).toContainText("at src/payments.ts:2");
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
  await expect(detail(payments, "Key")).toHaveText("https://payments.invalid");

  const ledger = service(page, "https://ledger.corp.internal");
  await expect(ledger).toContainText("Boundary incomplete");
  await expand(ledger);
  await expect(detail(ledger, "Authentication signals")).toContainText("template from process.env.LEDGER_TOKEN");
  await expect(detail(ledger, "Missing evidence")).toContainText("consumed response fields");

  // Nothing offers to connect, fabricate a response, or test the service.
  await expect(services.getByRole("button")).toHaveCount(0);
  await expect(services.getByRole("link", { name: /connect|test|mock|try/i })).toHaveCount(0);
});

test("summarizes an unresolved Service Dependency by its client and call site, not its key", async ({ page, db }) => {
  const { profile } = await seedStorefront(db);
  await page.goto(`/profiles/${profile.publicId}`);
  const unresolved = service(page, "Unresolved endpoint");
  await expect(unresolved.locator("summary")).toContainText("base is supplied by a caller");
  await expect(unresolved.locator("summary")).toContainText("called through fetch");
  await expect(unresolved.locator("summary")).toContainText("at src/client.ts:2");
  await expect(unresolved.locator("summary")).not.toContainText("unresolved:src/client.ts:2");
  await expand(unresolved);
  await expect(detail(unresolved, "Key")).toHaveText("unresolved:src/client.ts:2");
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

test("stacks the overview, Needs attention, and shared tables at mobile width, with the navigation collapsed", async ({ page, db }) => {
  const { profile } = await seedStorefront(db);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/profiles/${profile.publicId}`);
  const nav = page.getByRole("navigation", { name: "Profile sections" });
  await expect(nav.getByText("Jump to category")).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Languages/ })).toBeHidden();

  await expect(page.getByRole("region", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Needs attention" })).toBeVisible();
  // A table row becomes a stack of labeled values.
  const react = page.getByRole("table", { name: "Dependencies" }).getByRole("row").filter({ hasText: "react-dom" });
  await expect(react.locator("td").first()).toHaveCSS("display", "grid");
  await expect(page.getByRole("table", { name: "Package scripts" }).getByRole("row").filter({ hasText: "vitest run" }).locator("td").first()).toHaveCSS("display", "grid");
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
  await page.goto(paths.assessment(initiative.publicId));
  await page.getByRole("button", { name: "Start Run" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Run #1 was started.")).toBeVisible();
  await drainJobs(db, jobHandlers(db, config));
  const assessment = listAssessments(db, initiative.id)[0]!;

  await page.goto(paths.run(assessment.publicId));
  await page.getByRole("link", { name: "orders Profile" }).click();
  const manager = await openEvidence(category(page, "package_managers"), "yarn");
  await manager.getByRole("link", { name: "yarn.lock" }).click();
  await expect(page.getByText("lockfile.package-manager")).toBeVisible();
  await expect(page.getByText("This evidence is the presence, type, or mode of the path itself")).toBeVisible();

  await page.goBack();
  for (const summary of await page.locator("#services summary").all()) await summary.click();
  await page.locator("#services").getByRole("link", { name: "src/payments.ts:2" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "src/payments.ts:2" })).toBeVisible();
  // A call site's breadcrumb returns to the Service Dependencies.
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "orders" })).toHaveAttribute("href", /#services$/);
  await expect(page.getByRole("region", { name: "Record" })).toContainText("Line 2");
  const excerpt = page.getByLabel("Excerpt of src/payments.ts");
  await expect(excerpt).toContainText("[redacted]@payments.invalid/v1/charges");
  await expect(excerpt).toContainText("2");
  await expect(page.locator("body")).not.toContainText("hunter2");
});

test("navigates between categories and heads a category without facts like every other", async ({ page, db }) => {
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

  // A category with nothing to show has the same heading, description, and state as any other, and one line where its table would be.
  const submodules = category(page, "submodules");
  await expect(submodules).toHaveJSProperty("tagName", "SECTION");
  await expect(submodules.getByRole("heading", { level: 3, name: "Submodules" })).toBeVisible();
  await expect(submodules.getByRole("table")).toHaveCount(0);
  await expect(submodules).toContainText("None detected");
});

test("links an evidence record to each ancestor, with no other way back", async ({ page, db }) => {
  const { profile, initiative, assessment } = await seedOrders(db);
  await page.goto(`/profiles/${profile.publicId}`);
  const manager = await openEvidence(category(page, "package_managers"), "yarn");
  await manager.getByRole("link", { name: "yarn.lock" }).click();
  const breadcrumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumbs.getByRole("link")).toHaveText(["Assessments", initiative.name, "Run #1", "orders"]);
  await expect(breadcrumbs.getByRole("link", { name: "Run #1" })).toHaveAttribute("href", paths.run(assessment.publicId));
  await expect(page.locator("main").getByRole("link", { name: /back/i })).toHaveCount(0);

  // The Profile breadcrumb returns to the category that cites the evidence.
  await expect(breadcrumbs.getByRole("link", { name: "orders" })).toHaveAttribute("href", `/profiles/${profile.publicId}#package_managers`);
  await breadcrumbs.getByRole("link", { name: "orders" }).click();
  await expect(page).toHaveURL(/#package_managers$/);
  await expect(category(page, "package_managers")).toBeInViewport();
});

const SALT_APP = {
  "package.json": manifest({ name: "salt-orders", dependencies: { "@salt-ds/core": "^1.50.0", "@salt-ds/theme": "^1.33.0", react: "18.3.1" } }),
  "src/main.tsx": 'import "@salt-ds/theme/index.css";\nimport { Button, SaltProvider } from "@salt-ds/core";\nexport const Root = () => <SaltProvider><Button className="wide">Go</Button><Button>Back</Button><button>Raw</button></SaltProvider>;\n',
  "src/app.css": ".wide { inline-size: 100%; color: #0a6 }\n",
  "src/Button.stories.tsx": 'import { Button } from "@salt-ds/core";\nexport const Wide = () => <Button style={{ inlineSize: "100%" }}>Wide</Button>;\n',
};

test("shows design-system usage in the Interface categories, with each scope's non-zero counts", async ({ page, db }) => {
  const source = buildSource(db, { name: "salt-orders" });
  const assessment = await seedAssessment(db, buildInitiative(db, { name: "Salt adherence", sources: [source] }), [source], [SALT_APP]);
  await page.goto(`/profiles/${profilesOf(db, assessment.id)[0]!.profile.publicId}`);

  await expect(page.getByRole("heading", { level: 2, name: "Interface" })).toBeVisible();
  await expect(detail(page.getByRole("region", { name: "Overview" }), "Design system")).toContainText("Salt");
  // Each Interface category reads in its own columns, in words, never as one run of field names and values.
  const systems = category(page, "design_systems");
  await expect(systems.getByRole("row").filter({ hasText: "Salt" })).toContainText("Theme stylesheet imported");
  await expect(systems).not.toContainText("theme stylesheet: true");
  const button = category(page, "ui_elements").getByRole("row").filter({ hasText: "Salt component" }).filter({ hasText: "Button" });
  await expect(button).toContainText("1 as is · 1 customized");
  await expect(button).toContainText("1 in stories");
  // Only the app counts toward a Standard, so tests and stories stand apart, and a scope with none says nothing.
  await expect(button).not.toContainText("in tests");
  await expect(category(page, "ui_elements").getByRole("row").filter({ hasText: "<button>" })).toContainText("Salt has Button");
  await expect(category(page, "style_values").getByRole("row").filter({ hasText: "Color declarations" })).toContainText("1 raw value");
});

test("shows a version 1 Profile's facts unchanged, with the design-system categories not covered", async ({ page, db }) => {
  const orders = buildSource(db, { name: "orders" });
  const assessment = await seedAssessment(db, buildInitiative(db, { name: "Earlier release", sources: [orders] }), [orders], [ORDERS], { profileVersion1: true });
  const profile = profilesOf(db, assessment.id)[0]!.profile;
  expect(profile.schemaVersion).toBe(1);

  await page.goto(`/profiles/${profile.publicId}`);
  await expect(category(page, "languages").getByRole("row").filter({ hasText: "TypeScript" })).toBeVisible();
  for (const id of ["design_systems", "ui_elements", "style_values"]) {
    await expect(category(page, id), id).toContainText("Not covered");
    await expect(category(page, id), id).not.toContainText("Unknown");
  }
  const designSystem = detail(page.getByRole("region", { name: "Overview" }), "Design system");
  await expect(designSystem).toContainText("Not covered");
  await expect(designSystem).toContainText(/Detector release \S+ doesn't report this category/);
  await expect(page.getByRole("list", { name: "Needs attention" }).getByRole("listitem").filter({ hasText: "Design systems, UI elements, Style values" })).toContainText("Not covered");
});
