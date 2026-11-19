import path from "node:path";
import { listRuns } from "../src/lib/runs/run-records";
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
import { paths } from "./support/paths";
import { pageHeader } from "./support/shell";

// The server's configuration, so jobs run from the test process use its database, storage, and source root.
const config = () => loadConfig({ env: { ...process.env, ...E2E_ENV } });

test("shows an Assessment move through queued, active, finalizing, and terminal states while the page polls", async ({ page, db, sourcesDir }) => {
  const boundary = new SourceBoundary(config());
  for (const name of ["orders", "billing"]) {
    const repository = gitRepo(path.join(sourcesDir, name), { "package.json": `{ "name": "${name}", "version": "1.0.0" }\n` });
    insertSource(db, { name, ...resolveCloneUrl(`file://${repository}`, boundary), gitRef: null });
  }
  buildInitiative(db, { name: "Fleet assessment" });

  await page.goto(paths.assessment(listInitiatives(db)[0]!.publicId));
  await page.getByRole("button", { name: "Start Run" }).click();
  const started = page.getByRole("region", { name: "Notifications" }).getByText("Run #1 was started.");
  await expect(started).toBeVisible();
  // The outcome leaves the address at once, so no refresh can bring it back.
  await expect(page).not.toHaveURL(/notice=/);
  // The page header carries the status; the title is in the shell header.
  const header = pageHeader(page);
  await expect(header).toContainText("Queued");

  // Jobs run one at a time from the test process, using the inline queue.
  const step = () => drainJobs(db, jobHandlers(db, config()), { limit: 1 });
  const scope = page.getByRole("table", { name: "Run scope" });

  await step(); // the coordinator enqueues one job per target
  await step(); // the first target resolves its reference and waits on its commit's survey
  await step(); // and so does the second
  await expect(header).toContainText("Analyzing");
  await step(); // the first survey profiles its commit and completes the first target
  await expect(page.getByRole("progressbar", { name: "1 of 2 repositories finished" })).toBeVisible();
  await expect(scope.getByRole("row").filter({ hasText: "Complete" })).toHaveCount(1);
  await expect(scope.getByRole("row").filter({ hasText: "Analyzing" })).toHaveCount(1);

  await step(); // the last survey completes the last target, which hands the Assessment to its finalizer
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
  const run = listRuns(db, listInitiatives(db)[0]!.id)[0]!;
  const status = await (await page.request.get(paths.runStatus(run.publicId))).json();
  expect(status).toMatchObject({ terminal: true, run: { state: "complete", cancel_requested: false }, targets: [{ state: "complete", profile: true }, { state: "complete", profile: true }] });
  expect(JSON.stringify(status)).not.toContain(sourcesDir);
  expect(JSON.stringify(status)).not.toContain("file://");
});
