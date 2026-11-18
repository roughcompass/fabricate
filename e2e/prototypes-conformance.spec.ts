import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative, updateReleaseSelections } from "../src/lib/initiatives/initiative-records";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { publishDraft } from "../src/lib/standards/publish";
import { blankDraftDocument, createStandard } from "../src/lib/standards/standard-records";
import { STARTERS } from "../src/lib/standards/starters";
import { buildRelease } from "../test/support/builders";
import { expect, test } from "./support/fixtures";
import { fixturePrototype, waitForAudit } from "./support/prototypes";
import { serverConfig } from "./support/results";

// template-conformance spec: candidate template versions are assessed and evaluated; acceptance requires no Gap and no Indeterminate Finding.

const SALT_PAGE = 'import { Button, StackLayout, Text } from "@salt-ds/core";\nexport default function Prototype() {\n  return (\n    <StackLayout>\n      <Text styleAs="h2">Urgent payments</Text>\n      <Button sentiment="accented">Release</Button>\n    </StackLayout>\n  );\n}\n';
const RAW_BUTTON = 'import { Text } from "@salt-ds/core";\nexport default function Prototype() {\n  return (\n    <>\n      <Text>Release payments</Text>\n      <button type="button">Release</button>\n    </>\n  );\n}\n';

const select = (db: Db, releaseIds: string[]) => updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative(db).lockVersion, releaseIds);
function selectStarters(db: Db): void {
  select(
    db,
    STARTERS.map((starter) => {
      const { standard, draft } = createStandard(db, { name: starter.name, purpose: starter.purpose }, starter.document);
      return publishDraft(db, standard.publicId, draft.lockVersion).publicId;
    }),
  );
}

/** Opens Accept on a fixture page version, continues to the confirmation, and runs the check's jobs as the worker would. */
async function continueToConfirmation(page: Page, db: Db, code: string): Promise<void> {
  const { prototypeId } = await fixturePrototype(page, { name: "Exception-first queue", scope: "page", title: "Urgent payments", code });
  await page.goto(`/prototypes/${prototypeId}`);
  await waitForAudit(page);
  await page.getByRole("link", { name: /^Accept as template/ }).click();
  await page.getByLabel("Title").fill("Urgent payments queue");
  await page.getByLabel("Description").fill("Payments that need action before cut-off lead the queue.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("[data-conformance=running]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept as template" })).toBeDisabled();
  await drainJobs(db, jobHandlers(db, serverConfig()));
}

test("accepts a Salt-only page once its Evaluation meets both Salt starters (Starting acceptance)", async ({ page, db }) => {
  selectStarters(db);
  await continueToConfirmation(page, db, SALT_PAGE);

  const check = page.locator("[data-conformance=passed]");
  await expect(check).toBeVisible({ timeout: 15_000 });
  await expect(check.getByRole("list", { name: "Releases checked" })).toContainText("Salt adherence v1");
  await expect(check.getByRole("list", { name: "Releases checked" })).toContainText("Salt exemplary v1");
  await expect(check).toContainText("Meets every selected Release");
  await expect(page.locator("[data-capture=done]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Accept as template" }).click();
  await page.waitForURL(/notice=accepted/);
});

test("blocks a page with a raw button, naming Salt exemplary, the Control, and the observed value (A Gap blocks acceptance)", async ({ page, db }) => {
  selectStarters(db);
  await continueToConfirmation(page, db, RAW_BUTTON);

  const check = page.locator("[data-conformance=blocked]");
  await expect(check).toBeVisible({ timeout: 15_000 });
  const blocking = check.getByRole("list", { name: "Findings that block acceptance" });
  await expect(blocking.locator("[data-blocking=gap]").filter({ hasText: "Salt exemplary v1 · No raw elements that Salt replaces" })).toContainText("Observed 1; expected 0");
  await expect(page.locator("[data-capture=done]")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Accept as template" })).toBeDisabled();

  await blocking.getByRole("link", { name: "Salt exemplary v1 · No raw elements that Salt replaces" }).click();
  await expect(page.getByRole("heading", { name: "No raw elements that Salt replaces" })).toBeVisible();
});

test("blocks an Indeterminate Finding, naming the missing evidence (Indeterminate blocks acceptance)", async ({ page, db }) => {
  const document = {
    ...blankDraftDocument(),
    controls: [
      { key: "mui-token-share", title: "Styles with MUI tokens", rationale: "Shares need a denominator.", severity: "medium", subject: "repository", applicability: { op: "contains", selector: "repository.design_systems", mode: "any", values: ["salt"] }, condition: { op: "compare", selector: "repository.design_system_token_share", parameter: "mui", comparator: "gte", value: 80 } },
    ],
  };
  select(db, [buildRelease(db, { document }).publicId]);
  await continueToConfirmation(page, db, SALT_PAGE);

  const check = page.locator("[data-conformance=blocked]");
  await expect(check).toBeVisible({ timeout: 15_000 });
  await expect(check.locator("[data-blocking=indeterminate]")).toContainText("Styles with MUI tokens: Indeterminate.");
  await expect(check.locator("[data-blocking=indeterminate]")).toContainText("nothing to divide");
  await expect(page.getByRole("button", { name: "Accept as template" })).toBeDisabled();
});

/** Confirms Accept once the card image is captured, and returns the new template's gallery card. */
async function confirmAcceptance(page: Page) {
  await expect(page.locator("[data-capture=done]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Accept as template" }).click();
  await page.waitForURL(/notice=accepted/);
  await page.goto("/templates");
  return page.locator("li").filter({ has: page.getByRole("link", { name: "Urgent payments queue" }) });
}

test("shows the Evaluation on the template: Meets on its card, and per-Release counts that open the matching Findings (Evaluated template)", async ({ page, db }) => {
  selectStarters(db);
  await continueToConfirmation(page, db, SALT_PAGE);
  await expect(page.locator("[data-conformance=passed]")).toBeVisible({ timeout: 15_000 });
  const card = await confirmAcceptance(page);

  await expect(card).toContainText("Meets selected Standards");
  await card.getByRole("link", { name: "Urgent payments queue" }).click();
  const standards = page.getByRole("table", { name: "Standard Releases" });
  await expect(standards.locator("tr", { hasText: "Salt adherence v1" })).toBeVisible();
  const exemplary = standards.locator("[data-standards-release='Salt exemplary v1']");
  await expect(exemplary.getByRole("link", { name: /^0 Gap, Salt exemplary v1$/ })).toBeVisible();
  const meets = exemplary.getByRole("link", { name: /Meets, Salt exemplary v1$/ });
  const count = Number(await meets.textContent());
  expect(count).toBeGreaterThan(0);

  await meets.click();
  await expect(page).toHaveURL(/\/evaluations\/evl_[a-z0-9]{16}\?release=1&outcome=meets$/);
  await expect(page.locator("#release-1")).toContainText(`${count} Finding`);
  await expect(page.locator("#release-0")).toHaveCount(0);
});

test.describe("Not evaluated", () => {
  test("accepts on checks alone while no Release is selected, links to the Salt starters, and says why on the template (No Release selected)", async ({ page, db }) => {
    const { prototypeId } = await fixturePrototype(page, { name: "Exception-first queue", scope: "page", title: "Urgent payments", code: SALT_PAGE });
    await page.goto(`/prototypes/${prototypeId}`);
    await waitForAudit(page);
    await page.getByRole("link", { name: /^Accept as template/ }).click();
    await page.getByLabel("Title").fill("Urgent payments queue");
    await page.getByLabel("Description").fill("Payments that need action before cut-off lead the queue.");
    await page.getByRole("button", { name: "Continue" }).click();

    const check = page.locator("[data-conformance=not-evaluated]");
    await expect(check).toContainText("Not evaluated: no Release is selected");
    await expect(check.getByRole("link", { name: "Start from a Salt starter" })).toHaveAttribute("href", "/standards/new");
    const card = await confirmAcceptance(page);

    await expect(card).toContainText("Not evaluated");
    await expect(card).not.toContainText("Meets selected Standards");
    await card.getByRole("link", { name: "Urgent payments queue" }).click();
    await expect(page.locator("[data-standards=not-evaluated]")).toContainText("No Release was selected on Salt Patterns when it was accepted.");
    expect(db.$client.prepare("select count(*) as n from assessments").get()).toEqual({ n: 0 });
  });

  test("says the worker isn't running, and checks again once it is", async ({ page, db }) => {
    test.slow();
    selectStarters(db);
    const { prototypeId } = await fixturePrototype(page, { name: "Exception-first queue", scope: "page", title: "Urgent payments", code: SALT_PAGE });
    await page.goto(`/prototypes/${prototypeId}`);
    await waitForAudit(page);
    await page.getByRole("link", { name: /^Accept as template/ }).click();
    await page.getByLabel("Title").fill("Urgent payments queue");
    await page.getByLabel("Description").fill("Payments that need action before cut-off lead the queue.");
    await page.getByRole("button", { name: "Continue" }).click();

    // No job runs, as with no worker, until the step gives up waiting.
    const stalled = page.locator("[data-conformance=stalled]");
    await expect(stalled).toContainText("The worker isn't running", { timeout: 40_000 });
    await expect(page.getByRole("button", { name: "Accept as template" })).toBeDisabled();
    await stalled.getByRole("button", { name: "Check again" }).click();
    await expect(page.locator("[data-conformance=running]")).toBeVisible();
    await drainJobs(db, jobHandlers(db, serverConfig()));
    await expect(page.locator("[data-conformance=passed]")).toBeVisible({ timeout: 15_000 });
  });

  test("never reads a template as meeting its Standards when its Evaluation can't be found (Evaluation unavailable)", async ({ page, db }) => {
    selectStarters(db);
    await continueToConfirmation(page, db, SALT_PAGE);
    await expect(page.locator("[data-conformance=passed]")).toBeVisible({ timeout: 15_000 });
    const card = await confirmAcceptance(page);
    const href = await card.getByRole("link", { name: "Urgent payments queue" }).getAttribute("href");
    const slug = href!.replace("/templates/", "");

    const response = await page.request.post("/api/test/prototypes/template", { data: { slug, standards: { status: "evaluated", assessmentId: "asm_missing000000000", evaluationId: "evl_missing000000000" } } });
    expect(response.status()).toBe(200);

    await page.reload();
    await expect(card).toContainText("Not evaluated");
    await expect(card).not.toContainText("Meets selected Standards");
    await card.getByRole("link", { name: "Urgent payments queue" }).click();
    await expect(page.locator("[data-standards=not-evaluated]")).toContainText("Its Evaluation is unavailable.");
  });
});

test("re-evaluates a template after a Salt upgrade, showing Regressed with the Control named (A Control regresses)", async ({ page, db }) => {
  test.slow();
  selectStarters(db);
  await continueToConfirmation(page, db, SALT_PAGE);
  await expect(page.locator("[data-conformance=passed]")).toBeVisible({ timeout: 15_000 });
  const card = await confirmAcceptance(page);
  const slug = (await card.getByRole("link", { name: "Urgent payments queue" }).getAttribute("href"))!.replace("/templates/", "");

  // As if a Salt upgrade stopped recognizing a token the template uses: its gates still pass.
  const upgraded = 'import { Text } from "@salt-ds/core";\nimport styles from "./Prototype.module.css";\nexport default function Prototype() {\n  return <Text className={styles.release}>Release payments</Text>;\n}\n';
  expect((await page.request.post("/api/test/prototypes/template", { data: { slug, code: upgraded, styles: ".release {\n  color: var(--salt-made-up-token);\n}\n" } })).status()).toBe(200);

  // The first visit starts the re-check and its Run; the worker evaluates it against the acceptance's Releases.
  await expect(async () => {
    await page.goto("/templates?origin=prototypes");
    await drainJobs(db, jobHandlers(db, serverConfig()));
    await page.reload();
    await expect(page.locator("li").filter({ has: page.getByRole("link", { name: "Urgent payments queue" }) })).toContainText("Regressed on Salt");
  }).toPass({ timeout: 60_000 });

  await page.getByRole("link", { name: "Urgent payments queue" }).click();
  await expect(page.locator("[data-control-changes=regressed]")).toContainText("Styles only with Salt tokens (Salt exemplary v1): Meets at acceptance, Gap now");
  await expect(page.getByRole("button", { name: "Use template" })).toBeEnabled();

  // Every re-check for this runtime build is done, so its upgrade report can be downloaded (Report after an upgrade).
  await page.goto("/templates?origin=prototypes");
  const markdown = await page.locator("[data-upgrade-report]").getByRole("link", { name: "Markdown" }).getAttribute("href");
  const report = await page.request.get(markdown!);
  expect(report.status()).toBe(200);
  const text = await report.text();
  expect(text).toContain("| Urgent payments queue | v1 | Salt exemplary v1 | Styles only with Salt tokens | passes | fails | regressed |");
  expect(text).toContain("don't cover appearance, CSS overrides, or behavior in a deployed environment");
});
