import path from "node:path";
import { listAssessments } from "../src/lib/assessments/assessment-records";
import { resolveCloneUrl } from "../src/lib/catalog/catalog";
import { SourceBoundary } from "../src/lib/catalog/source-boundary";
import { insertSource } from "../src/lib/catalog/source-records";
import { loadConfig } from "../src/lib/config";
import { listInitiatives } from "../src/lib/initiatives/initiative-records";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { buildInitiative } from "../test/support/builders";
import { E2E_ENV } from "./support/env";
import { expect, gitRepo, test } from "./support/fixtures";

// The server's configuration, so jobs run from the test process use its database, storage, and source root.
const config = () => loadConfig({ env: { ...process.env, ...E2E_ENV } });

test("shows an Assessment move through queued, active, finalizing, and terminal states while the page polls", async ({ page, db, sourcesDir }) => {
  const boundary = new SourceBoundary(config());
  for (const name of ["orders", "billing"]) {
    const repository = gitRepo(path.join(sourcesDir, name), { "package.json": `{ "name": "${name}", "version": "1.0.0" }\n` });
    insertSource(db, { name, ...resolveCloneUrl(`file://${repository}`, boundary), gitRef: null });
  }
  buildInitiative(db, { name: "Fleet assessment" });

  await page.goto(`/initiatives/${listInitiatives(db)[0]!.publicId}`);
  await page.getByRole("button", { name: "Start Assessment" }).click();
  const started = page.getByRole("region", { name: "Notifications" }).getByText("Assessment #1 was started.");
  await expect(started).toBeVisible();
  // The outcome leaves the address at once, so no refresh can bring it back.
  await expect(page).not.toHaveURL(/notice=/);
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await expect(header).toContainText("Queued");

  // Jobs run one at a time from the test process, using the inline queue.
  const step = () => drainJobs(db, jobHandlers(db, config()), { limit: 1 });
  const scope = page.getByRole("table", { name: "Assessment scope" });

  await step(); // the coordinator enqueues one job per target
  await step(); // the first target is acquired and analyzed
  await expect(header).toContainText("Analyzing");
  await expect(page.getByRole("progressbar", { name: "1 of 2 repositories finished" })).toBeVisible();
  await expect(scope.getByRole("row").filter({ hasText: "Complete" })).toHaveCount(1);
  await expect(scope.getByRole("row").filter({ hasText: "Pending" })).toHaveCount(1);

  await step(); // the last target hands the Assessment to its finalizer
  await expect(header).toContainText("Finalizing");

  await step(); // the finalizer writes the map and the outcome
  await expect(header).toContainText("Complete");
  await expect(scope.getByRole("row").filter({ hasText: "Complete" })).toHaveCount(2);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(started).toHaveCount(await started.count() > 0 ? 1 : 0);

  // A finished Assessment stops polling.
  let polls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/status")) polls++;
  });
  await page.waitForTimeout(4_000);
  expect(polls).toBe(0);
  await page.reload();
  await expect(page.getByText("was started")).toHaveCount(0);

  // The status payload carries states and codes only: no clone URL, path, or failure message.
  const assessment = listAssessments(db, listInitiatives(db)[0]!.id)[0]!;
  const status = await (await page.request.get(`/api/assessments/${assessment.publicId}/status`)).json();
  expect(status).toMatchObject({ terminal: true, assessment: { state: "complete", cancel_requested: false }, targets: [{ state: "complete", profile: true }, { state: "complete", profile: true }] });
  expect(JSON.stringify(status)).not.toContain(sourcesDir);
  expect(JSON.stringify(status)).not.toContain("file://");
});
