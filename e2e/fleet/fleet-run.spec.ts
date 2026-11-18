import fs from "node:fs";
import type { JsonObject } from "@repo-facts/contract";
import { expect, type Page, test } from "@playwright/test";
import { listAssessments, targetsOf } from "../../src/lib/assessments/assessment-records";
import { listSources } from "../../src/lib/catalog/source-records";
import { loadConfig } from "../../src/lib/config";
import { openDatabase } from "../../src/lib/db/client";
import { findingDocument, findingsOf, listEvaluations } from "../../src/lib/evaluations/evaluation-records";
import { listInitiatives } from "../../src/lib/initiatives/initiative-records";
import { jobHandlers } from "../../src/lib/jobs/registry";
import { drainJobs } from "../../src/lib/jobs/worker";
import { profileDocument, profilesOf } from "../../src/lib/profiles/profile-records";
import { FLEET_DATABASE, FLEET_ENV, FLEET_ROOT } from "./env";
import { paths } from "../support/paths";

/**
 * The synthetic fleet, assessed and evaluated through the product: import the
 * fleet directory, run a baseline Assessment, author two Standards in the
 * structured editor, publish them, and run a diagnostic Evaluation. Jobs run
 * from the test process with the server's configuration, exactly as the
 * worker would run them.
 */

test.skip(!fs.existsSync(FLEET_ROOT), `The synthetic fleet is not at ${FLEET_ROOT}; set FLEET_ROOT.`);
test.setTimeout(600_000);

const REPOSITORIES = ["acme-platform", "legacy-portal", "mf-admin", "mf-billing", "mf-shell", "spa-orders", "spa-reports", "spa-root"];
const ANALYTICS_CONSUMERS = ["mf-admin", "mf-billing", "mf-shell", "spa-orders", "spa-reports", "spa-root"];

// The page header: status, meta, and actions; the title is in the shell header.
const header = (page: Page) => page.locator("[data-page-header]");
const toast = (page: Page, text: string | RegExp) => page.getByRole("region", { name: "Notifications" }).getByText(text);
const control = (page: Page, number: number) => page.getByRole("region", { name: new RegExp(`^Control ${number}\\b`) });
const builder = (scope: ReturnType<typeof control>, legend: string) => scope.getByRole("group", { name: legend, exact: true });

async function newStandard(page: Page, name: string, purpose: string) {
  await page.goto("/standards");
  await page.getByRole("link", { name: "New Standard" }).first().click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Purpose").fill(purpose);
  await page.getByRole("button", { name: "Create Standard" }).click();
  await expect(toast(page, `${name} was created.`)).toBeVisible();
}

async function saveAndPublish(page: Page, name: string) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved · Ready to publish")).toBeVisible();
  await page.getByRole("link", { name: "Review and publish" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Publish ${name} v1` })).toBeVisible();
  await page.getByRole("button", { name: "Publish v1" }).click();
  await page.getByRole("dialog", { name: `Publish ${name} v1?` }).getByRole("button", { name: "Publish v1" }).click();
  await expect(toast(page, "Release v1 was published.")).toBeVisible();
}

test("assesses the synthetic fleet, authors Standards in the editor, and runs a diagnostic Evaluation", async ({ page }) => {
  const db = openDatabase(FLEET_DATABASE);
  const config = loadConfig({ env: { ...process.env, ...FLEET_ENV } });
  const run = () => drainJobs(db, jobHandlers(db, config));

  await test.step("register only file:// sources under fleet/", async () => {
    await page.goto(paths.bulkRepositories);
    await page.getByLabel("Clone URLs").fill(REPOSITORIES.map((name) => `file://${FLEET_ROOT}/${name}`).join("\n"));
    await page.getByRole("button", { name: "Add Repositories" }).click();
    // Exact, so the bulk page's own "Add Repositories" heading doesn't satisfy it before the Repositories are added.
    await expect(page.getByRole("heading", { level: 1, name: "Repositories", exact: true })).toBeVisible();
    const sources = listSources(db);
    expect(sources.map((source) => source.name).sort()).toEqual(REPOSITORIES);
    for (const source of sources) expect(source.cloneUrl).toBe(`file://${FLEET_ROOT}/${source.name}`);
  });

  await test.step("run a full baseline Assessment", async () => {
    await page.goto(paths.newAssessment);
    await page.getByLabel("Name").fill("Fleet baseline");
    await page.getByLabel("Objective").fill("Establish the current state of every fleet repository");
    await page.getByRole("button", { name: "Create Assessment" }).click();
    await page.getByRole("button", { name: "Start Run" }).click();
    await expect(toast(page, "Run #1 was started.")).toBeVisible();
    await run();
    await expect(header(page)).toContainText("Complete");
    const assessment = listAssessments(db, listInitiatives(db)[0]!.id)[0]!;
    expect(targetsOf(db, assessment.id).map((target) => [target.sourceName, target.state]).sort()).toEqual(REPOSITORIES.map((name) => [name, "complete"]));
  });

  await test.step("represent discovered analytics calls statically", async () => {
    const assessment = listAssessments(db, listInitiatives(db)[0]!.id)[0]!;
    const profiles = new Map(profilesOf(db, assessment.id).map(({ profile, target }) => [target.sourceName, profile]));
    for (const name of ANALYTICS_CONSUMERS) {
      const services = (profileDocument(profiles.get(name)!).fact_document as JsonObject).service_dependencies as JsonObject[];
      expect(services, name).toContainEqual(expect.objectContaining({ key: "package:@acme/analytics", client: { kind: "packaged", package: "@acme/analytics" }, access: expect.objectContaining({ state: "unknown" }) }));
      const analytics = services.find((service) => service.key === "package:@acme/analytics")!;
      expect(analytics.endpoint).toMatchObject({ state: "observed", value: { derivation: "relative", base_path: "/__analytics" } });
    }
    // The client's own call has a destination static analysis cannot establish.
    const platform = (profileDocument(profiles.get("acme-platform")!).fact_document as JsonObject).service_dependencies as JsonObject[];
    expect(platform).toContainEqual(expect.objectContaining({ client: expect.objectContaining({ kind: "fetch" }), characterizable: false, endpoint: expect.objectContaining({ state: "unknown" }) }));

    await page.getByRole("link", { name: "mf-billing Profile" }).click();
    await page.getByRole("navigation", { name: "Profile views" }).getByRole("link", { name: /^Services/ }).click();
    // A Service Dependency's summary names its endpoint and client; its key is in its details.
    const analytics = page.locator("#services").getByRole("region", { name: /^Same origin \/__analytics · Packaged client from @acme\/analytics/ });
    await expect(analytics).toContainText("called through Packaged client from @acme/analytics");
    await expect(page.getByText("Static discovery does not prove entitlement, reachability, or integrated behavior", { exact: false })).toBeVisible();
  });

  await test.step("author representative Standards in the structured editor", async () => {
    await newStandard(page, "Fleet engineering baseline", "Automated verification and substitutable services");
    await page.getByRole("button", { name: "Add Control" }).click();
    const ci = control(page, 1);
    await ci.getByLabel("Key").fill("has-ci");
    await ci.getByLabel("Title").fill("Runs continuous integration");
    await ci.getByLabel("Rationale").fill("Changes need automated verification before they merge.");
    await ci.getByLabel("Severity").selectOption("high");
    await builder(ci, "Expected condition").getByLabel("Field").first().selectOption({ label: "CI systems" });
    await ci.getByLabel("Guidance").fill("Add a workflow that runs the repository's tests.");

    await page.getByRole("button", { name: "Add Control" }).click();
    const services = control(page, 2);
    await services.getByLabel("Key").fill("services-configurable");
    await services.getByLabel("Title").fill("Service destinations are configurable");
    await services.getByLabel("Rationale").fill("Migrations point services at substitutes without code changes.");
    await services.getByLabel("Severity").selectOption("critical");
    await builder(services, "Applies when").getByLabel("Condition type").first().selectOption({ label: "At least one item" });
    await builder(services, "Condition at least one item must meet").getByLabel("Condition type").first().selectOption({ label: "Always" });
    await builder(services, "Expected condition").getByLabel("Condition type").first().selectOption({ label: "Every item" });
    const each = builder(services, "Condition every item must meet");
    await each.getByLabel("Field").selectOption({ label: "Endpoint derivation" });
    await each.getByLabel("Operator").selectOption({ label: "is one of" });
    await each.getByLabel("Configured").check();
    await each.getByLabel("Host provided").check();
    await saveAndPublish(page, "Fleet engineering baseline");

    await newStandard(page, "Fleet relationships", "Every composition resolves within the fleet");
    await page.getByRole("button", { name: "Add Control" }).click();
    const composition = control(page, 1);
    await composition.getByLabel("Key").fill("composition-resolved");
    await composition.getByLabel("Title").fill("Every composition relationship resolves");
    await composition.getByLabel("Rationale").fill("A host must reach each application it composes.");
    await composition.getByLabel("Subject").selectOption({ label: "The Relationship Map" });
    const expected = builder(composition, "Expected condition");
    await expected.getByLabel("Condition type").first().selectOption({ label: "Number of items" });
    await expected.getByLabel("Items").first().selectOption({ label: "Relationships" });
    await expected.getByLabel("Only include items that match a condition").check();
    const include = builder(composition, "Items to include");
    await include.getByLabel("Condition type").first().selectOption({ label: "All of these" });
    const type = builder(composition, "Condition 1");
    await type.getByLabel("Field").selectOption({ label: "Relationship type" });
    await type.getByLabel("Operator").selectOption({ label: "is one of" });
    await type.getByLabel("composition").check();
    await include.getByRole("button", { name: "Add condition" }).last().click();
    const state = builder(composition, "Condition 2");
    await state.getByLabel("Field").selectOption({ label: "Resolution state" });
    await state.getByLabel("Operator").selectOption({ label: "is one of" });
    await state.getByLabel("unresolved").check();
    await state.getByLabel("ambiguous").check();
    await expected.getByLabel("The number of items is").selectOption({ label: "equal to" });
    await expected.getByLabel("Count").fill("0");
    await saveAndPublish(page, "Fleet relationships");
  });

  await test.step("run a diagnostic Evaluation of the baseline Assessment", async () => {
    const initiative = listInitiatives(db)[0]!;
    await page.goto(paths.assessmentEdit(initiative.publicId));
    const releases = page.getByRole("group", { name: "Standard Releases" });
    await releases.getByLabel("Fleet engineering baseline v1").check();
    await releases.getByLabel("Fleet relationships v1").check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("table", { name: "Run history" }).getByRole("button", { name: "Start Evaluation" }).click();
    await expect(toast(page, "Evaluation #1 was started.")).toBeVisible();
    await run();
    await expect(header(page)).toContainText("Complete");
    await expect(page.getByRole("table", { name: "Summary by Release" }).locator("tbody tr")).toHaveCount(2);
  });

  await test.step("keep evidence and uncertainty in every Finding", async () => {
    const evaluation = listEvaluations(db, { initiativeId: listInitiatives(db)[0]!.id })[0]!;
    const findings = findingsOf(db, evaluation.id).map((finding) => ({ finding, document: findingDocument(finding) }));
    // Two repository Controls for eight repositories, and one relationship Control.
    expect(findings).toHaveLength(REPOSITORIES.length * 2 + 1);
    const label = ({ finding, document }: (typeof findings)[number]) => `${finding.controlKey} ${String((document.subject as JsonObject).name)} ${finding.outcome}`;
    for (const item of findings) {
      // Uncertainty is never dropped: an Indeterminate Finding names what prevented a decision.
      if (item.finding.outcome === "indeterminate") expect((item.document.causes as JsonObject[]).length, label(item)).toBeGreaterThan(0);
      // An observed CI system, and a service call that fails the Control, cite their committed evidence.
      const observed = (item.finding.controlKey === "has-ci" && item.finding.outcome === "meets") || (item.finding.controlKey === "services-configurable" && item.finding.outcome === "gap");
      if (observed) expect(Object.keys(item.document.evidence as JsonObject).length, label(item)).toBeGreaterThan(0);
    }
    const outcome = (key: string, name: string) => findings.find(({ finding, document }) => finding.controlKey === key && (document.subject as JsonObject).name === name)!.finding.outcome;
    expect(outcome("has-ci", "mf-billing")).toBe("meets");
    expect(outcome("has-ci", "legacy-portal")).toBe("gap");
    expect(outcome("services-configurable", "mf-billing")).toBe("gap");
    expect(outcome("services-configurable", "acme-platform")).toBe("indeterminate");
    expect(outcome("services-configurable", "legacy-portal")).toBe("not_applicable");
    expect(outcome("composition-resolved", "Relationship Map")).toBe("gap");

    // An uncertain Finding explains every cause and links to the committed evidence.
    const uncertain = findings.find(({ finding, document }) => finding.controlKey === "services-configurable" && (document.subject as JsonObject).name === "acme-platform")!;
    await page.goto(`/evaluations/${evaluation.publicId}/findings/${uncertain.finding.publicId}`);
    await expect(page.getByRole("list", { name: "Indeterminate causes" }).getByRole("listitem")).toHaveCount((uncertain.document.causes as JsonObject[]).length);
    await page.getByRole("region", { name: "Evidence" }).getByRole("link").first().click();
    await expect(page.getByLabel(/^Excerpt of packages\/analytics\//)).toBeVisible();
  });

  await test.step("store nothing from outside the fleet", async () => {
    const stored = db.$client.serialize();
    expect(stored.includes(Buffer.from("fleet-kit"))).toBe(false);
    for (const source of listSources(db)) expect(source.cloneUrl.startsWith(`file://${FLEET_ROOT}/`)).toBe(true);
  });

  db.$client.close();
});
