import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative, updateReleaseSelections } from "../src/lib/initiatives/initiative-records";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { publishDraft } from "../src/lib/standards/publish";
import { createStandard } from "../src/lib/standards/standard-records";
import { STARTERS } from "../src/lib/standards/starters";
import { expect, test } from "./support/fixtures";
import { waitForFrame } from "./support/prototypes";
import { serverConfig } from "./support/results";

// template-gallery spec: "Using a hero template" and "Illustrative templates"; template-preview spec: the Code tab shows a hero's real source.

const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });
const card = (page: Page, title: string) => page.locator("li").filter({ has: page.getByRole("link", { name: title, exact: true }) });

function selectStarters(db: Db): void {
  const releases = STARTERS.map((starter) => {
    const { standard, draft } = createStandard(db, { name: starter.name, purpose: starter.purpose }, starter.document);
    return publishDraft(db, standard.publicId, draft.lockVersion).publicId;
  });
  updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative(db).lockVersion, releases);
}

test("starts a page prototype from the Payments hero, marked as started from it (Using a hero template)", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace");
  await page.getByRole("button", { name: "Use template" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/prototypes/pro_"));
  await expect(toasts(page).getByText("Started from the template Payments workspace v3.2.0.")).toBeVisible();
  await expect(page.locator("[data-version-chip]")).toHaveCount(1);
  await waitForFrame(page);
  await page.getByRole("link", { name: "Provenance" }).click();
  const provenance = page.locator("[data-provenance]");
  await expect(provenance).toContainText("Started from the template Payments workspace v3.2.0");
  await expect(provenance).toContainText("Page");
});

test("shows the Payments hero's Evaluation against the selected Salt starters on its detail page", async ({ page, db }) => {
  selectStarters(db);
  await page.goto("/templates/payments-workspace");
  await expect(page.locator("[data-standards=not-evaluated]")).toContainText("Its Evaluation is running.");
  await drainJobs(db, jobHandlers(db, serverConfig()));
  await page.reload();
  const releases = page.getByRole("table", { name: "Standard Releases" });
  for (const release of ["Salt adherence v1", "Salt exemplary v1"]) {
    const row = releases.locator(`[data-standards-release="${release}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: `0 Gap, ${release}` })).toBeVisible();
  }
  await expect(page.locator("dl").first()).toContainText("Meets selected Standards");
});

test("labels a non-hero built-in Illustrative on its card, detail page, and Code tab (Illustrative templates)", async ({ page, db: _db }) => {
  await page.goto("/templates");
  await expect(card(page, "Corporate card controls").locator("[data-illustrative]")).toHaveText("Illustrative");
  await expect(card(page, "Payments workspace").locator("[data-illustrative]")).toHaveCount(0);

  await page.goto("/templates/corporate-card-controls");
  await expect(page.locator("dl").first()).toContainText("Illustrative: its code is generated from the catalog, not real Salt.");
  await page.goto("/templates/corporate-card-controls/preview?view=code");
  await expect(page.locator("[data-illustrative]")).toContainText("These files are illustrative");
});

test("shows a hero's real Salt source on the Code tab, with package.json naming its Salt packages", async ({ page, db: _db }) => {
  await page.goto("/templates/payments-workspace/preview?view=code");
  await expect(page.locator("[data-illustrative]")).toHaveCount(0);
  await expect(page.getByRole("figure", { name: "package.json" })).toContainText('"@salt-ds/core"');
  await expect(page.getByRole("figure", { name: "package.json" })).toContainText('"@deweb/portal"');
  const files = page.getByRole("navigation", { name: "Files" });
  await files.getByRole("link", { name: "src/payee-list.tsx" }).click();
  const source = page.getByRole("figure", { name: "src/payee-list.tsx" });
  await expect(source).toContainText('from "@salt-ds/core"');
  await expect(source).toContainText('from "./data"');
});
