import path from "node:path";
import type { Page } from "@playwright/test";
import { createApplication } from "../src/lib/applications/applications";
import { launchApplicationAssessment } from "../src/lib/applications/assessment";
import type { Db } from "../src/lib/db/client";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { ana, onboardPortal } from "../test/support/onboarding";
import { expect, expectNoHorizontalOverflow, gitRepo, test } from "./support/fixtures";
import { serverConfig } from "./support/results";
import { waitForHydration } from "./support/shell";

// web-onboarding/application-dashboard spec: a registered Application's
// dashboard, its assessment as it runs, the rendering determination and its
// evidence, the Production checklist, and Edit details.

const MODULE_FEDERATION = {
  "package.json": '{ "name": "payee-hub", "version": "1.0.0" }\n',
  "webpack.config.mjs": `import { ModuleFederationPlugin } from "@module-federation/enhanced/webpack";

export default {
  plugins: [new ModuleFederationPlugin({ name: "mfPayees", exposes: { "./App": "./src/App" } })],
};
`,
  "src/App.js": "export default function App() { return null; }\n",
};

const overview = (page: Page) => page.getByRole("region", { name: "Overview" });
const shellHeading = (page: Page) => page.locator("[data-shell-header]").getByRole("heading", { level: 1 });

/** Payee Hub, registered in Access from a local repository with a Module Federation build. */
function payeeHub(db: Db, sourcesDir: string) {
  const work = gitRepo(path.join(sourcesDir, "payee-hub"), MODULE_FEDERATION);
  const access = onboardPortal(db, "Access");
  const application = createApplication(db, { sealId: "88001", name: "Payee Hub", description: "Manages the payees of a payments desk.", repositoryUrl: `file://${work}`, portal: access.publicId }, ana, serverConfig());
  return { access, application };
}

/** Starts Payee Hub's DE Web assessment, and runs it to the end when +finish+. */
async function assess(db: Db, publicId: string, { finish = true } = {}) {
  const launched = launchApplicationAssessment(db, publicId, serverConfig());
  if (finish) await drainJobs(db, jobHandlers(db, serverConfig()));
  return launched;
}

test.describe("a registered Application's dashboard", () => {
  test("Overview: the slug, SEAL ID, Portal with its badge, description, assessment linked to its Run, the determination, and the Source", async ({ page, db, sourcesDir }) => {
    const { application } = payeeHub(db, sourcesDir);
    await assess(db, application.publicId);
    await page.goto(`/applications/${application.publicId}`);
    await expect(page).toHaveTitle("Payee Hub · Applications · DE FabLab");
    await expect(shellHeading(page)).toHaveText("Payee Hub");
    await expect(page.locator("[data-page-header]").getByRole("navigation", { name: "Breadcrumb" }).getByRole("link")).toHaveText(["Applications"]);
    const facts = overview(page);
    await expect(facts).toContainText("payee-hub");
    await expect(facts).toContainText("88001");
    await expect(facts).toContainText("Access");
    await expect(facts).toContainText("Prototype");
    await expect(facts).toContainText("Manages the payees of a payments desk.");
    await expect(facts.getByRole("link", { name: "Assessed" })).toHaveAttribute("href", /^\/runs\/asm_/);
    await expect(facts).toContainText("Module Federation");
    await expect(facts).toContainText("Assessed at the default branch");
    await expect(page.locator("[data-page-header]").getByRole("button", { name: "Re-run assessment" })).toBeEnabled();
  });

  test("Determination: the disclosure shows the rule, the deciding fact linked to its evidence, and the Run", async ({ page, db, sourcesDir }) => {
    const { application } = payeeHub(db, sourcesDir);
    await assess(db, application.publicId);
    await page.goto(`/applications/${application.publicId}`);
    const determination = page.locator("#rendering");
    await determination.getByText("Module Federation", { exact: true }).click();
    await expect(determination).toContainText("A Module Federation build exposes a module");
    const deciding = determination.getByRole("list", { name: "Deciding facts" });
    await expect(deciding).toContainText("Module Federation build mfPayees exposes ./App");
    await expect(deciding.getByRole("link", { name: /webpack\.config\.mjs/ })).toHaveAttribute("href", /^\/runs\/asm_[a-z0-9]+\/evidence\//);
    await determination.getByRole("link", { name: "Open the Run" }).click();
    await expect(page).toHaveURL(/\/runs\/asm_/);
  });

  test("Live completion: the dashboard follows the Run without a reload, and Re-run is unavailable meanwhile", async ({ page, db, sourcesDir }) => {
    const { application } = payeeHub(db, sourcesDir);
    await assess(db, application.publicId, { finish: false });
    await page.goto(`/applications/${application.publicId}`);
    await waitForHydration(page);
    await expect(overview(page)).toContainText("Queued");
    await expect(overview(page)).toContainText("Waiting for a worker");
    const rerun = page.locator("[data-page-header]").getByRole("button", { name: "Re-run assessment" });
    await expect(rerun).toBeDisabled();
    await expect(page.locator("[data-page-header]")).toContainText("An assessment is already queued or running");

    await drainJobs(db, jobHandlers(db, serverConfig()));
    await expect(overview(page).getByRole("link", { name: "Assessed" })).toBeVisible({ timeout: 15_000 });
    await expect(overview(page)).toContainText("Module Federation");
    await expect(rerun).toBeEnabled();
  });

  test("Re-running: the earlier determination stays, labeled, until the new Run finishes", async ({ page, db, sourcesDir }) => {
    const { application } = payeeHub(db, sourcesDir);
    await assess(db, application.publicId);
    await page.goto(`/applications/${application.publicId}`);
    await waitForHydration(page);
    await page.locator("[data-page-header]").getByRole("button", { name: "Re-run assessment" }).click();
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("The assessment started again.");
    await expect(overview(page)).toContainText("Queued");
    await expect(overview(page)).toContainText("From the earlier assessment, Run #1");
    await expect(overview(page)).toContainText("Module Federation");
  });

  test("Production checklist: done items are struck through, Not available ones dimmed and left out of the count", async ({ page, db, sourcesDir }) => {
    const { application } = payeeHub(db, sourcesDir);
    await assess(db, application.publicId);
    await page.goto(`/applications/${application.publicId}`);
    const checklist = page.getByRole("list", { name: "Production checklist" });
    const items = checklist.getByRole("listitem");
    await expect(items).toHaveCount(8);
    const done = checklist.locator('li[data-state="done"]').first();
    await expect(done.locator("span, a").first()).toHaveCSS("text-decoration-line", "line-through");
    const unavailable = checklist.locator('li[data-state="not_available"]');
    await expect(unavailable.first()).toContainText("Not available");
    const color = (locator: typeof done) => locator.evaluate((element) => getComputedStyle(element).color);
    const todo = checklist.locator('li[data-state="open"]').first();
    expect(await color(unavailable.first())).not.toBe(await color(todo));
    const total = 8 - (await unavailable.count());
    const completed = await checklist.locator('li[data-state="done"]').count();
    await expect(page.getByRole("region", { name: "Production checklist" })).toContainText(`${completed}/${total}`);
  });

  test("Observability and Analytics are placeholders with no figures", async ({ page, db, sourcesDir }) => {
    const { application } = payeeHub(db, sourcesDir);
    await page.goto(`/applications/${application.publicId}`);
    for (const name of ["Observability", "Analytics"]) {
      const panel = page.getByRole("region", { name });
      await expect(panel).toContainText("Not available yet");
      await expect(panel.locator("svg[role='img'], canvas, table, button, input")).toHaveCount(0);
      expect((await panel.innerText()).match(/\d/)).toBeNull();
    }
  });

  test("Edit details: a save from an older version is refused, keeping what was entered", async ({ page, db, sourcesDir }) => {
    const { application } = payeeHub(db, sourcesDir);
    const other = await page.context().newPage();
    const edit = `/applications/${application.publicId}/edit`;
    await page.goto(edit);
    await other.goto(edit);
    await waitForHydration(page);
    await waitForHydration(other);
    await expect(page.getByText(/The slug payee-hub, the repository .*, and the Portal Access don't change\./)).toBeVisible();

    await page.getByLabel("Description").fill("Payees for every desk.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(new RegExp(`/applications/${application.publicId}\\?notice=edited$|/applications/${application.publicId}$`));
    await expect(overview(page)).toContainText("Payees for every desk.");

    await other.getByLabel("Name", { exact: true }).fill("Payee Hub Pro");
    await other.getByRole("button", { name: "Save changes" }).click();
    await expect(other.locator("#application-edit-alert")).toContainText(/changed/);
    await expect(other.getByLabel("Name", { exact: true })).toHaveValue("Payee Hub Pro");
    await other.close();
  });

  test("Unknown Application: the not-found page", async ({ page, db: _db }) => {
    for (const address of ["/applications/wap_aaaaaaaaaaaaaaaa", "/applications/nonsense"]) {
      const response = await page.goto(address);
      expect(response?.status(), address).toBe(404);
    }
  });
});

test.describe("layout", () => {
  test("At 1440px the checklist, Observability, and Analytics sit in one row", async ({ page, db, sourcesDir }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { application } = payeeHub(db, sourcesDir);
    await page.goto(`/applications/${application.publicId}`);
    const boxes = await Promise.all(["Production checklist", "Observability", "Analytics"].map(async (name) => (await page.getByRole("region", { name }).boundingBox())!));
    expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1);
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
    expect(boxes[2]!.x).toBeGreaterThan(boxes[1]!.x);
  });

  test("At 375px they stack, and nothing overflows", async ({ page, db, sourcesDir }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const { application } = payeeHub(db, sourcesDir);
    await page.goto(`/applications/${application.publicId}`);
    const boxes = await Promise.all(["Production checklist", "Observability", "Analytics"].map(async (name) => (await page.getByRole("region", { name }).boundingBox())!));
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
    expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height - 1);
    await expectNoHorizontalOverflow(page);
  });
});
