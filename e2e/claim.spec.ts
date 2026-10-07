import fs from "node:fs";
import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { completeClaim } from "../src/lib/ownership/claims";
import { refreshDeConsole } from "../src/lib/ownership/de-console";
import { createApplication, ensureLineOfBusiness, ensurePortal, recordAssertion } from "../src/lib/ownership/records";
import { buildSource } from "../test/support/builders";
import { E2E_DE_CONSOLE } from "./support/env";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { serverConfig } from "./support/results";

/*
 * The claim flow (repository-claims spec): a git URL first, then only the
 * values no one knows yet. Each test claims through the pages, with any
 * earlier claims and DE Console reads seeded from the test process.
 */

const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });

/** The portals and Lines of Business an ontology release would approve. */
function approve(db: Db) {
  for (const label of ["Access", "Digital Bank", "Markets"]) db.$client.prepare("update portals set concept_key = ? where id = ?").run(`portal/${label.toLowerCase().replace(/ /g, "-")}`, ensurePortal(db, label).id);
  for (const label of ["Payments", "Markets"]) db.$client.prepare("update lines_of_business set concept_key = ? where id = ?").run(`line-of-business/${label.toLowerCase()}`, ensureLineOfBusiness(db, label).id);
}

async function enterUrl(page: Page, url: string) {
  await page.goto("/repositories");
  await page.getByRole("link", { name: "Claim a Repository" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Claim a Repository" })).toBeVisible();
  await page.getByLabel("Git URL").fill(url);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function enterSealId(page: Page, sealId: string) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByLabel(/^(Another application's )?SEAL ID/).fill(sealId);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function signAndClaim(page: Page, providedBy = "ana@example.com") {
  await page.getByLabel("Your name or email").fill(providedBy);
  await page.getByRole("button", { name: "Claim Repository" }).click();
}

const ownership = (page: Page) => page.getByRole("region", { name: /Ownership|Known so far/ });

test.beforeEach(() => fs.rmSync(E2E_DE_CONSOLE, { force: true }));

test("shows a known Repository's ownership and asks nothing (Known repository)", async ({ page, db }) => {
  const orders = buildSource(db, { name: "orders" });
  completeClaim(db, orders.publicId, { providedBy: "ana@example.com", sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });

  await enterUrl(page, "https://GIT.example.com/acme/orders");

  await expect(page).toHaveURL(new RegExp(`/repositories/claim/${orders.publicId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "orders" })).toBeVisible();
  await expect(ownership(page)).toContainText("88010");
  await expect(ownership(page)).toContainText("Payments Web");
  await expect(ownership(page)).toContainText("Claimed by ana@example.com · Unverified");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Correct ownership" })).toBeVisible();
  // The claim started a Run, which hasn't finished.
  await expect(page.getByRole("region", { name: "Profile" })).toContainText("is assessing orders");
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "Correct ownership" }).click();
  await expect(page.getByLabel("Team")).toHaveValue("Payments Web");
  await page.getByLabel("Team").fill("Payments Experience");
  await page.getByLabel("Your name or email").fill("ben@example.com");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toasts(page).getByText("Your corrections are saved.")).toBeVisible();
  await expect(ownership(page)).toContainText("Payments Experience");
  await expect(ownership(page)).toContainText("Claimed by ben@example.com");
});

test("fails a URL with an access token and stores nothing (Unsafe URL)", async ({ page, db }) => {
  await enterUrl(page, "https://x-token-auth:ghp_tok3n@git.example.com/acme/billing.git");

  await expect(page.locator("#claim-clone-url-error")).toContainText("cannot contain a username, password, or access token");
  await expect(page.getByLabel("Git URL")).toBeFocused();
  await expect(page.getByLabel("Git URL")).not.toHaveValue(/ghp_tok3n/);
  await expect(page.locator("body")).not.toContainText("ghp_tok3n");
  expect(db.$client.prepare("select count(*) as count from repository_sources").get()).toEqual({ count: 0 });
});

test("asks only for the SEAL ID for a second repository of a known application (Second repository of a known application)", async ({ page, db }) => {
  const orders = buildSource(db, { name: "orders" });
  completeClaim(db, orders.publicId, { providedBy: "ana@example.com", sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });

  await enterUrl(page, "https://git.example.com/acme/billing.git");
  await expect(toasts(page).getByText("billing was added to the catalog.")).toBeVisible();
  await enterSealId(page, "88010");

  await expect(ownership(page)).toContainText("Payments Web");
  await expect(page.getByText("Nothing else to ask")).toBeVisible();
  for (const field of ["Team", "Line of Business", "Other portals", "Portals"]) await expect(page.getByLabel(field, { exact: true })).toHaveCount(0);
  await signAndClaim(page);

  await expect(toasts(page).getByText("billing is claimed.")).toBeVisible();
  await expect(toasts(page).getByText("A Run of its default branch has started.")).toBeVisible();
  await expect(ownership(page)).toContainText("Payments Web");
});

test("offers the DE Console's applications and takes its team and portals (DE Web application)", async ({ page, db }) => {
  approve(db);
  fs.writeFileSync(
    E2E_DE_CONSOLE,
    JSON.stringify({ format: "de-console-ownership", version: 1, applications: [{ seal_id: "88001", name: "Access Shell", team: "Access Platform", portals: ["Access"] }] }),
  );
  await refreshDeConsole(db, serverConfig(), "schedule");

  await enterUrl(page, "https://git.example.com/access/access-shell.git");
  await page.getByLabel("Application", { exact: true }).selectOption({ label: "Access Shell (88001)" });
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(ownership(page)).toContainText("Access Shell (88001)");
  await expect(ownership(page)).toContainText("Access Platform");
  await expect(ownership(page)).toContainText("From the DE Console · last read");
  await expect(page.getByLabel("Team", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Portals" })).toHaveCount(0);
  await page.getByLabel("Line of Business", { exact: true }).selectOption("Markets");
  await signAndClaim(page);

  await expect(toasts(page).getByText("access-shell is claimed.")).toBeVisible();
  await expect(ownership(page)).toContainText("Markets");
  const reads = db.$client.prepare("select trigger, status from de_console_reads order by id").all();
  expect(reads).toEqual([
    { trigger: "schedule", status: "succeeded" },
    { trigger: "claim", status: "succeeded" },
  ]);
});

test("proceeds with the last read when the DE Console can't be read (DE Console unavailable)", async ({ page, db }) => {
  fs.writeFileSync(E2E_DE_CONSOLE, JSON.stringify({ format: "de-console-ownership", version: 1, applications: [{ seal_id: "88001", name: "Access Shell", team: "Access Platform", portals: ["Access"] }] }));
  await refreshDeConsole(db, serverConfig(), "schedule");
  fs.rmSync(E2E_DE_CONSOLE);

  await enterUrl(page, "https://git.example.com/access/access-shell.git");
  await page.getByLabel("Application", { exact: true }).selectOption({ label: "Access Shell (88001)" });
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("The DE Console couldn't be read")).toBeVisible();
  await expect(page.getByText(/DE Console values here are from its last successful read/)).toBeVisible();
  await expect(ownership(page)).toContainText("Access Platform");
  await page.getByLabel("Line of Business").fill("Access");
  await signAndClaim(page);
  await expect(toasts(page).getByText("access-shell is claimed.")).toBeVisible();
});

test("asks for an unknown application's team, Line of Business, and portals (Unknown application)", async ({ page, db }) => {
  approve(db);

  await enterUrl(page, "https://git.example.com/pay/payee-hub.git");
  await enterSealId(page, "88099");

  await expect(ownership(page)).toContainText("88099");
  await page.getByRole("button", { name: "Claim Repository" }).click();
  await expect(page.locator("#claim-provided-by-error")).toContainText("Enter your name or email");
  await expect(page.locator("#claim-team-error")).toContainText("Enter the team");
  await expect(page.locator("#claim-lineOfBusiness-error")).toContainText("Choose or enter a Line of Business");
  await expect(page.locator("#claim-portals-error")).toContainText("Choose or enter at least one portal");

  await page.getByLabel("Team", { exact: true }).fill("Payee Services");
  await page.getByLabel("Line of Business", { exact: true }).selectOption("Payments");
  await page.getByRole("group", { name: "Portals" }).getByLabel("Digital Bank").check();
  await page.getByLabel("Other portals").fill("JPM Access");
  await page.getByLabel("Entering this for someone else? Their name or email").fill("cy@example.com");
  await signAndClaim(page);

  await expect(toasts(page).getByText("payee-hub is claimed.")).toBeVisible();
  await expect(ownership(page)).toContainText("Payee Services");
  await expect(ownership(page)).toContainText("Claimed by ana@example.com for cy@example.com");
  await expect(ownership(page)).toContainText("JPM Access (pending review)");
});

test("records a host and confirms its application as owner of an unowned portal (Host claimed for an unowned portal)", async ({ page, db }) => {
  approve(db);

  await enterUrl(page, "https://git.example.com/access/access-shell.git");
  await enterSealId(page, "88001");
  await page.getByLabel("Team", { exact: true }).fill("Access Platform");
  await page.getByLabel("Line of Business", { exact: true }).selectOption("Markets");
  await page.getByRole("group", { name: "Portals" }).getByLabel("Access").check();
  await page.getByLabel("Portal this Repository hosts").selectOption("Access");
  await signAndClaim(page);

  await expect(page.getByRole("heading", { level: 1, name: "Confirm the portal's owner" })).toBeVisible();
  await expect(page.getByText("Access has no owning application. Confirm that 88001, which access-shell belongs to, owns it.")).toBeVisible();
  await expect(page.getByLabel("Your name or email")).toHaveValue("ana@example.com");
  await page.getByRole("button", { name: "Confirm owner" }).click();

  await expect(toasts(page).getByText("The portal's owner is recorded.")).toBeVisible();
  await expect(ownership(page)).toContainText("Owned by 88001");
  await expect(ownership(page)).toContainText("Host: access-shell");
});

test("puts a portal's host in conflict when a second Repository claims it, and shows both (Second host)", async ({ page, db }) => {
  approve(db);
  const shell = buildSource(db, { name: "access-shell" });
  completeClaim(db, shell.publicId, { providedBy: "ana@example.com", sealId: "88001", team: "Access Platform", lineOfBusiness: "Markets", portals: ["Access"], hosts: "Access" });

  await enterUrl(page, "https://git.example.com/access/access-shell-next.git");
  await enterSealId(page, "88001");
  await page.getByLabel("Portal this Repository hosts").selectOption("Access");
  await signAndClaim(page, "ben@example.com");
  // Access still has no owner, so the claim proposes one; not now.
  await page.getByRole("link", { name: "Not now" }).click();

  await expect(ownership(page)).toContainText("Host: access-shell-next");
  await expect(ownership(page)).toContainText("In conflict with access-shell, claimed by ana@example.com");
});

test("asks which application a shared SEAL ID means, links only the one chosen, and starts its Run (Applications share one SEAL ID)", async ({ page, db }) => {
  approve(db);
  const workspace = createApplication(db, { sealId: "88010", name: "Payments workspace" });
  const reporting = createApplication(db, { sealId: "88010", name: "Payments reporting" });
  const claim = { source: "person" as const, providedBy: "cy@example.com" };
  recordAssertion(db, { attribute: "team", application: workspace.id, team: "Payments Web", ...claim });
  recordAssertion(db, { attribute: "team", application: reporting.id, team: "Payments Insights", ...claim });

  await enterUrl(page, "https://git.example.com/pay/payments-reports.git");
  await enterSealId(page, "88010");

  await expect(page.getByRole("heading", { level: 1, name: "payments-reports" })).toBeVisible();
  await expect(page.getByText("2 applications carry SEAL ID 88010. Which does this Repository belong to?")).toBeVisible();
  const choices = page.getByRole("group", { name: "Application" });
  await expect(choices.getByRole("radio")).toHaveCount(3);
  await expect(choices).toContainText(`SEAL ID 88010 · Team Payments Insights · ${reporting.publicId}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#claim-application-choice-error")).toContainText("Choose an application");
  await choices.getByLabel(/Payments reporting/).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Claim this Repository for Payments reporting (88010).")).toBeVisible();
  await expect(ownership(page)).toContainText("Payments Insights");
  await page.getByLabel("Line of Business", { exact: true }).selectOption("Payments");
  await page.getByRole("group", { name: "Portals" }).getByLabel("Digital Bank").check();
  await signAndClaim(page);

  await expect(toasts(page).getByText("payments-reports is claimed.")).toBeVisible();
  await expect(toasts(page).getByText("A Run of its default branch has started.")).toBeVisible();
  await expect(ownership(page)).toContainText("Payments reporting (88010)");
  await expect(page.getByRole("region", { name: "Profile" })).toContainText("is assessing payments-reports");
  expect(db.$client.prepare("select a.public_id as application from ownership_assertions o join applications a on a.id = o.value_application_id where o.attribute = 'application'").all()).toEqual([{ application: reporting.publicId }]);
  expect(db.$client.prepare("select count(*) as n from applications").get()).toEqual({ n: 2 });
});

test("proposes the one application a SEAL ID names, and makes a new one when the claimant chooses (New application with a shared SEAL ID)", async ({ page, db }) => {
  approve(db);
  const workspace = createApplication(db, { sealId: "88010", name: "Payments workspace" });
  recordAssertion(db, { attribute: "team", application: workspace.id, team: "Payments Web", source: "person", providedBy: "cy@example.com" });

  await enterUrl(page, "https://git.example.com/pay/payments-batch.git");
  await enterSealId(page, "88010");
  await expect(page.getByText("Claim this Repository for Payments workspace (88010).")).toBeVisible();
  await page.getByRole("link", { name: "Choose another application" }).click();

  await expect(page.getByText("One application carries SEAL ID 88010. Which does this Repository belong to?")).toBeVisible();
  await page.getByRole("group", { name: "Application" }).getByLabel(/A new application/).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Claim this Repository for a new application with SEAL ID 88010.")).toBeVisible();
  await page.getByLabel("Team", { exact: true }).fill("Payments Batch");
  await page.getByLabel("Line of Business", { exact: true }).selectOption("Payments");
  await page.getByRole("group", { name: "Portals" }).getByLabel("Digital Bank").check();
  await signAndClaim(page);

  await expect(toasts(page).getByText("payments-batch is claimed.")).toBeVisible();
  await expect(ownership(page)).toContainText("Payments Batch");
  expect(db.$client.prepare("select count(*) as n from applications where seal_id = '88010'").get()).toEqual({ n: 2 });
  expect(db.$client.prepare("select value_team as team from ownership_assertions where attribute = 'team' and subject_application_id = ?").all(workspace.id)).toEqual([{ team: "Payments Web" }]);
});

test("moves a Repository to the application chosen among those sharing a SEAL ID (Correcting to a shared SEAL ID)", async ({ page, db }) => {
  const orders = buildSource(db, { name: "orders" });
  completeClaim(db, orders.publicId, { providedBy: "ana@example.com", sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });
  createApplication(db, { sealId: "88030", name: "Ledger" });
  const reporting = createApplication(db, { sealId: "88030", name: "Ledger reporting" });

  await page.goto(`/repositories/claim/${orders.publicId}/correct`);
  await page.getByLabel("SEAL ID", { exact: true }).fill("88030");
  await page.getByLabel("Your name or email").fill("ben@example.com");
  await page.getByRole("button", { name: "Save changes" }).click();

  const choices = page.getByRole("group", { name: "Application" });
  await expect(choices).toContainText("2 applications carry SEAL ID 88030. Choose one, or a new application.");
  await expect(choices.getByRole("radio")).toHaveCount(3);
  await choices.getByLabel(/Ledger reporting/).check();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(toasts(page).getByText("The Repository now belongs to another application.")).toBeVisible();
  await expect(page.getByText("Claim this Repository for Ledger reporting (88030).")).toHaveCount(0);
  expect(db.$client.prepare("select a.public_id as application from ownership_assertions o join applications a on a.id = o.value_application_id where o.attribute = 'application' order by o.id desc limit 1").get()).toEqual({ application: reporting.publicId });
});

test("lists the Assessments created for claims apart from operators' Assessments", async ({ page, db }) => {
  const orders = buildSource(db, { name: "orders" });
  completeClaim(db, orders.publicId, { providedBy: "ana@example.com", sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });

  await page.goto("/assessments");

  await expect(page.getByRole("table", { name: "Assessments", exact: true })).toHaveCount(0);
  await expect(page.getByText("No Assessments yet")).toBeVisible();
  const claims = page.getByRole("region", { name: "Created for claims" });
  await expect(claims.getByRole("row", { name: /Claim: orders/ })).toContainText("Run #1");
  await claims.getByRole("link", { name: "orders", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/repositories/claim/${orders.publicId}$`));
});
