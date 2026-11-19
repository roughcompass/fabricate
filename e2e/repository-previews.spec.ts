import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { resolveCloneUrl } from "../src/lib/catalog/catalog";
import { SourceBoundary } from "../src/lib/catalog/source-boundary";
import { type RepositorySource, insertSource } from "../src/lib/catalog/source-records";
import type { Db } from "../src/lib/db/client";
import { jobs, previewBuilds } from "../src/lib/db/schema";
import { requestPreparation } from "../src/lib/previews/preparation";
import { BUILD_PREVIEW } from "../src/lib/previews/records";
import { previewDirectory } from "../src/lib/previews/storage";
import { git } from "../test/support/git-fixture";
import { FEDERATED_WORKSPACE, NEXT_APP, type Tree, offlineFederatedRemote, offlineSingleSpaBundle, offlineViteApp, offlineViteLibrary } from "../test/support/preview-trees";
import { E2E_PREVIEWS, E2E_PREVIEW_REMOTES } from "./support/env";
import { expect as baseExpect, gitRepo, test } from "./support/fixtures";
import { serverConfig, runJobs } from "./support/results";

/*
 * Repository previews from the Repository page (openspec
 * add-repository-previews, tasks 6.1 to 6.4, 7.2, and 7.3): choosing a ref,
 * preparation and its refusals, package choice, the preview page with its
 * device frame and live log, Rebuild, Delete, and microfrontends previewed
 * through their own page or refused without one. Only the remotes at E2E_PREVIEW_REMOTES are enrolled. Jobs run
 * from the test process; builds run offline, since each fixture links its
 * dependencies and a stand-in for its build tool from its own vendor/
 * directory.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
// A build's states arrive through polling, after an install and a build.
const expect = baseExpect.configure({ timeout: 15_000 });
// Builds install and run npm, and a first visit compiles the pages.
test.setTimeout(120_000);

const [ORDERS, PORTAL] = E2E_PREVIEW_REMOTES as [string, string];
const previews = (db: Db) => db.select().from(previewBuilds).all();
const section = (page: Page) => page.getByRole("region", { name: "Previews" });
const notifications = (page: Page) => page.getByRole("region", { name: "Notifications" });
const frame = (page: Page) => page.frameLocator("[data-preview-frame]");
/** The preview's latest attempt state, announced as it changes. */
const state = (page: Page) => page.locator("[data-preview-state]");

test.afterEach(() => {
  for (const remote of E2E_PREVIEW_REMOTES) fs.rmSync(remote, { recursive: true, force: true });
});

/** A repository at the enrolled path +remote+: +tree+ on main, each of +branches+ on its own, and v1.0.0 annotated on main; registered as a Repository. */
function enrolled(db: Db, remote: string, tree: Tree, branches: Record<string, Tree> = {}): RepositorySource {
  fs.rmSync(remote, { recursive: true, force: true });
  gitRepo(remote, tree);
  for (const [branch, files] of Object.entries(branches)) {
    git(remote, ["checkout", "--quiet", "-b", branch]);
    git(remote, ["rm", "-rq", "."]);
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(remote, file)), { recursive: true });
      fs.writeFileSync(path.join(remote, file), content);
    }
    git(remote, ["add", "--all"]);
    git(remote, ["commit", "--quiet", "-m", branch]);
    git(remote, ["checkout", "--quiet", "main"]);
  }
  git(remote, ["tag", "-a", "v1.0.0", "-m", "Release 1.0.0"]);
  return insertSource(db, { name: path.basename(remote), ...resolveCloneUrl(`file://${remote}`, new SourceBoundary(serverConfig())), gitRef: null });
}

/** Prepares the default branch of +source+ and runs its jobs: preparation and, with one package, its build. */
async function built(db: Db, source: RepositorySource) {
  await requestPreparation(db, source.publicId, { kind: "ref", name: null }, { config: serverConfig() });
  await runJobs(db);
  return previews(db)[0]!;
}

const previewPage = (source: RepositorySource, preview: { publicId: string }) => `/repositories/${source.publicId}/previews/${preview.publicId}`;

test("offers no preview controls for a Repository whose remote isn't enrolled", async ({ page, db, sourcesDir }) => {
  const repository = gitRepo(path.join(sourcesDir, "ledger"), offlineViteApp());
  const source = insertSource(db, { name: "ledger", ...resolveCloneUrl(`file://${repository}`, new SourceBoundary(serverConfig())), gitRef: null });
  await page.goto(`/repositories/${source.publicId}`);
  await expect(page.getByText("Not profiled yet")).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare preview" })).toHaveCount(0);
});

test("lists the remote's branches and tags, the configured reference first, and keeps the reference and commit entry when the remote can't be listed", async ({ page, db }) => {
  const source = enrolled(db, ORDERS, offlineViteApp(), { "feature/new-nav": offlineViteApp({ heading: "New nav" }) });
  await page.goto(`/repositories/${source.publicId}`);
  const choice = section(page).getByRole("combobox", { name: "Branch or tag" });
  await expect(choice.locator("option").first()).toHaveText("Default branch (main)");
  await expect(choice.locator("optgroup[label=Branches] option")).toHaveText(["feature/new-nav"]);
  await expect(choice.locator("optgroup[label=Tags] option")).toHaveText(["v1.0.0"]);

  // A prefix that names no commit is reported under the commit field, and nothing is prepared.
  await section(page).getByRole("textbox", { name: "Commit (optional)" }).fill("0000000");
  await section(page).getByRole("button", { name: "Prepare preview" }).click();
  await expect(section(page).getByText(/No branch, tag, or acquired commit of this Repository starts with 0000000/)).toBeVisible();
  await expect(page).not.toHaveURL(/preparation=/);

  // The remote is gone: only the configured reference and commit entry are offered, and the page says why.
  const unreachable = enrolled(db, PORTAL, offlineViteApp());
  fs.rmSync(PORTAL, { recursive: true, force: true });
  await page.goto(`/repositories/${unreachable.publicId}`);
  await expect(section(page).getByText(/The remote's other branches and tags couldn't be listed/)).toBeVisible();
  await expect(section(page).getByRole("combobox", { name: "Branch or tag" }).locator("option")).toHaveText(["Default branch"]);
  await expect(section(page).getByRole("textbox", { name: "Commit (optional)" })).toBeEditable();
});

test("refuses a server-rendered commit with each failed condition and its evidence, and queues no build", async ({ page, db }) => {
  const source = enrolled(db, ORDERS, offlineViteApp(), { "feature/ssr": NEXT_APP });
  await page.goto(`/repositories/${source.publicId}`);
  await section(page).getByRole("combobox", { name: "Branch or tag" }).selectOption({ label: "feature/ssr" });
  await section(page).getByRole("button", { name: "Prepare preview" }).click();
  await expect(page).toHaveURL(/preparation=ppr_/);
  const prepared = section(page).getByRole("region", { name: /^feature\/ssr at [0-9a-f]{12}$/ });
  await expect(prepared.getByRole("status")).toContainText("Profiling");

  await runJobs(db); // the page polls, and shows the decision when it's made
  await expect(prepared.getByRole("status")).toContainText("Not previewable");
  await expect(prepared).toContainText("Previews need a client-rendered single-page application whose build produces static files.");
  const conditions = prepared.getByRole("table", { name: "Why the commit can't be previewed" });
  const framework = conditions.getByRole("row").filter({ hasText: "Browser framework" });
  await expect(framework).toContainText("Next.js renders on a server");
  await expect(framework).toContainText("package.json");
  await expect(conditions.getByRole("row").filter({ hasText: "Build tool" })).toContainText("No supported build tool applies to this package");

  // Nothing was built, and nothing is listed.
  expect(previews(db)).toEqual([]);
  expect(db.select().from(jobs).where(eq(jobs.kind, BUILD_PREVIEW)).all()).toEqual([]);
  await expect(section(page).getByRole("table", { name: "Previews" })).toHaveCount(0);
});

test("keeps several qualifying packages selectable before any build, and builds the one chosen", async ({ page, db }) => {
  const source = enrolled(db, PORTAL, FEDERATED_WORKSPACE);
  await page.goto(`/repositories/${source.publicId}`);
  await section(page).getByRole("button", { name: "Prepare preview" }).click();
  await expect(page).toHaveURL(/preparation=ppr_/);
  await runJobs(db);

  const packages = section(page).getByRole("table", { name: "Packages that can be previewed" });
  await expect(packages.getByRole("button", { name: /^Build preview of / })).toHaveCount(3);
  await expect(section(page).getByText("3 packages can be previewed. Choose one to build.")).toBeVisible();
  const preparation = page.url();
  await expect(packages.getByRole("row").filter({ hasText: "admin" })).toContainText("a Module Federation remote");
  expect(previews(db)).toEqual([]);

  // Still selectable later: nothing is built until the operator chooses.
  await page.reload();
  await expect(packages.getByRole("button", { name: /^Build preview of / })).toHaveCount(3);
  expect(previews(db)).toEqual([]);

  await packages.getByRole("button", { name: "Build preview of shell" }).click();
  await expect(page).toHaveURL(/\/repositories\/src_\w+\/previews\/pvw_\w+$/);
  await expect(notifications(page).getByText("The build of shell is queued.")).toBeVisible();
  await expect(page.locator("[data-preview-state]")).toHaveText("Queued");
  expect(previews(db).map((preview) => [preview.packageDir, preview.attemptState])).toEqual([["apps/shell", "queued"]]);

  // The others stay selectable, and the chosen one opens its preview.
  await page.goto(preparation);
  await expect(packages.getByRole("button", { name: /^Build preview of / })).toHaveCount(2);
  await expect(packages.getByRole("row").filter({ hasText: "shell" }).getByRole("link", { name: "Open preview" })).toBeVisible();
  await expect(section(page).getByRole("table", { name: "Previews" }).getByRole("row").filter({ hasText: "shell" })).toContainText("Queued");
});

test("follows a build to Ready through its live log, and shows it in the device frame", async ({ page, db, sourcesDir }) => {
  const control = path.join(sourcesDir, "control.json");
  fs.writeFileSync(control, JSON.stringify({ hold: true }));
  const source = enrolled(db, ORDERS, offlineViteApp({ settings: { control } }));
  await page.goto(`/repositories/${source.publicId}`);
  await section(page).getByRole("button", { name: "Prepare preview" }).click();
  await expect(page).toHaveURL(/preparation=ppr_/);

  // One package qualifies, so its build starts without asking; the stand-in for Vite holds it.
  const running = runJobs(db);
  const prepared = section(page).getByRole("region", { name: /^main at / });
  await expect(prepared.getByRole("status")).toContainText("1 package can be previewed, so its build started.");
  await prepared.getByRole("link", { name: "Open preview" }).click();
  await expect(page).toHaveURL(/\/previews\/pvw_\w+$/);
  const preview = previews(db)[0]!;

  const summary = page.locator("[data-preview-summary]");
  await expect(state(page)).toHaveText("Building");
  await expect(summary).toContainText("Branch main");
  await expect(summary).toContainText(`Commit ${preview.commitSha.slice(0, 12)}`);
  const log = page.getByRole("figure", { name: "Attempt 1 log" });
  await expect(log).toContainText("==> install: npm ci in the repository root, with package-lock.json");
  await expect(log).toContainText("vite v5.4.0 building for production...");
  await expect(log).not.toContainText("==> ready");
  await expect(page.getByText("Waiting for a worker").or(page.getByText("The preview appears here when the build is ready."))).toBeVisible();

  // The log grows as the build runs, and the page turns Ready when it publishes.
  fs.writeFileSync(control, JSON.stringify({ hold: false }));
  await running;
  await expect(log).toContainText("built in 12ms");
  await expect(state(page)).toHaveText("Ready");
  await expect(log).toContainText("==> ready:");
  await expect(frame(page).getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(frame(page).locator("[data-route]")).toHaveText(`/previews/${preview.publicId}/`);
  await expect(page.getByRole("link", { name: /Open full screen/ })).toHaveAttribute("href", `/previews/${preview.publicId}/`);

  // The device and orientation are in the address.
  await page.getByRole("group", { name: "Device" }).getByRole("button", { name: "Mobile" }).click();
  await expect(page).toHaveURL(/device=mobile/);
  await expect(page.locator("[data-frame-size]")).toHaveText("390 × 844");
  await page.getByRole("button", { name: "Landscape" }).click();
  await expect(page).toHaveURL(/device=mobile&orientation=landscape/);
  await expect(page.locator("[data-frame-size]")).toHaveText("844 × 390");
  await expect(frame(page).getByRole("heading", { name: "Orders" })).toBeVisible();

  // The Repository's list shows it Ready, with its size.
  await page.getByRole("link", { name: "Back to orders-web" }).click();
  const row = section(page).getByRole("table", { name: "Previews" }).getByRole("row").filter({ hasText: "orders-web" });
  await expect(row).toContainText("Ready");
  await expect(row).toContainText("main");
  await expect(row).toContainText(preview.commitSha.slice(0, 12));
  await expect(row.getByRole("cell", { name: /\d+ B$/ })).toBeVisible();
});

test("shows a failed build's reason and log tail, and Rebuild queues the next attempt", async ({ page, db }) => {
  const source = enrolled(db, ORDERS, offlineViteApp({ broken: true }));
  const preview = await built(db, source);
  expect(preview.attemptState).toBe("failed");

  await page.goto(previewPage(source, preview));
  await expect(state(page)).toHaveText("Failed");
  const alert = page.locator("#page-alerts").getByText("Attempt 1 failed");
  await expect(alert).toBeVisible();
  await expect(page.locator("#page-alerts")).toContainText(`The build failed: npm run build -- --base=/previews/${preview.publicId}/ exited with code 1.`);
  const log = page.getByRole("figure", { name: "Attempt 1 log" });
  await expect(log).toContainText("[vite:build] src/main.js (1:7): Unexpected token");
  await expect(log).toContainText("==> failed: The build failed");
  await expect(page.getByText("Nothing to preview")).toBeVisible();
  await expect(page.locator("[data-preview-frame]")).toHaveCount(0);

  await page.getByRole("button", { name: "Rebuild orders-web" }).click();
  await expect(notifications(page).getByText("Attempt 2 of orders-web is queued.")).toBeVisible();
  await expect(state(page)).toHaveText("Queued");
  await expect(page.getByText("No log yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rebuild orders-web" })).toHaveCount(0);
  const rebuilt = previews(db)[0]!;
  expect([rebuilt.attempt, rebuilt.attemptState]).toEqual([2, "queued"]);
  expect(db.select().from(jobs).where(eq(jobs.idempotencyKey, `${BUILD_PREVIEW}:${preview.publicId}:2`)).get()?.state).toBe("queued");
});

test("keeps showing the published output while a rebuild runs and after it fails", async ({ page, db, sourcesDir }) => {
  const control = path.join(sourcesDir, "control.json");
  const source = enrolled(db, ORDERS, offlineViteApp({ settings: { control } }));
  const preview = await built(db, source);
  expect(preview.attemptState).toBe("ready");

  await page.goto(previewPage(source, preview));
  await expect(frame(page).getByRole("heading", { name: "Orders" })).toBeVisible();
  fs.writeFileSync(control, JSON.stringify({ fail: true }));
  await page.getByRole("button", { name: "Rebuild orders-web" }).click();
  await expect(page.locator("#page-alerts")).toContainText("Showing attempt 1's output");
  await expect(frame(page).getByRole("heading", { name: "Orders" })).toBeVisible();

  await runJobs(db);
  await expect(page.locator("[data-preview-state]")).toHaveText("Failed");
  await expect(page.locator("#page-alerts")).toContainText("Attempt 2 failed");
  await expect(page.locator("#page-alerts")).toContainText("The output of attempt 1 is still shown.");
  await expect(page.getByRole("figure", { name: "Attempt 2 log" })).toContainText("Unexpected token");
  await expect(frame(page).getByRole("heading", { name: "Orders" })).toBeVisible();
});

test("warns that only HTML asset references were rewritten, and deletes the preview with its files after confirmation", async ({ page, db, request }) => {
  const source = enrolled(db, ORDERS, offlineViteApp({ settings: { ignoreBase: true } }));
  const preview = await built(db, source);
  expect(preview.attemptState).toBe("ready");
  const directory = previewDirectory(serverConfig(), preview.publicId);
  expect(fs.existsSync(directory)).toBe(true);

  await page.goto(previewPage(source, preview));
  await expect(page.locator("#page-alerts")).toContainText("Only the page's asset references were rewritten");
  await expect(page.locator("#page-alerts")).toContainText("deep links may not work");
  await expect(frame(page).getByRole("heading", { name: "Orders" })).toBeVisible();

  // Cancel keeps it.
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete the preview of orders-web?" });
  await expect(dialog).toContainText(`/previews/${preview.publicId}/ stops answering`);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(previews(db)[0]!.deletedAt).toBeNull();

  await page.getByRole("button", { name: "Delete" }).click();
  await dialog.getByRole("button", { name: "Delete preview" }).click();
  await expect(page).toHaveURL(new RegExp(`/repositories/${source.publicId}(\\?|#|$)`));
  await expect(notifications(page).getByText(`The preview of orders-web at ${preview.commitSha.slice(0, 12)} was deleted.`)).toBeVisible();
  await expect(section(page).getByRole("table", { name: "Previews" })).toHaveCount(0);
  expect(previews(db)[0]!.deletedAt).not.toBeNull();
  expect(fs.existsSync(directory)).toBe(false);
  expect((await request.get(`/previews/${preview.publicId}/`)).status()).toBe(404);
  expect((await page.goto(previewPage(source, preview)))!.status()).toBe(404);
});

test.describe("microfrontends", () => {
  test("previews a Module Federation remote through the page its build emits, like any other application", async ({ page, db, request }) => {
    const source = enrolled(db, PORTAL, offlineFederatedRemote());
    const preview = await built(db, source);
    expect([preview.attemptState, preview.artifactLayout, preview.artifactEntry]).toEqual(["ready", "standalone", { file: "index.html", rebase: false }]);
    const base = `/previews/${preview.publicId}/`;

    await page.goto(previewPage(source, preview));
    // The remote's own bootstrap renders its exposed module, whose chunk loads beside its container entry.
    await expect(frame(page).getByRole("heading", { name: "Admin header" })).toBeVisible();
    await expect(frame(page).locator("[data-route]")).toHaveText(base);
    await expect(page.locator("[data-preview-frame]")).toHaveAttribute("src", base);
    await expect(page.getByRole("link", { name: /Open full screen/ })).toHaveAttribute("href", base);
    await expect(page.getByRole("navigation", { name: "Exposed modules" })).toHaveCount(0);
    await expect(page.locator("#page-alerts")).toBeEmpty();
    await page.getByText("Details", { exact: true }).click();
    await expect(page.getByText("A Module Federation remote, shown through its own page")).toBeVisible();

    // Nothing under the preview's path is Fabricate's: __host is a route of the remote's page like any other.
    const host = await request.get(`${base}__host`, { headers: { "sec-fetch-dest": "document" } });
    expect(host.status()).toBe(200);
    expect(await host.text()).toContain("<title>Admin remote</title>");
  });

  test("fails a single-spa bundle whose build emits no page, publishing nothing", async ({ page, db, request }) => {
    const source = enrolled(db, ORDERS, offlineSingleSpaBundle());
    const preview = await built(db, source);
    const reason = "The output has no index.html. Previews need a page that loads the application on its own.";
    expect(preview).toMatchObject({ attemptState: "failed", attemptReason: reason, artifact: null, artifactLayout: null, artifactEntry: null });
    expect((await request.get(`/previews/${preview.publicId}/`)).status()).toBe(404);

    await page.goto(previewPage(source, preview));
    await expect(state(page)).toHaveText("Failed");
    await expect(page.locator("#page-alerts")).toContainText(reason);
    await expect(page.getByRole("figure", { name: "Attempt 1 log" })).toContainText(`==> failed: ${reason}`);
    await expect(page.getByText("Nothing to preview")).toBeVisible();
    await expect(page.locator("[data-preview-frame]")).toHaveCount(0);
  });

  test("refuses a Vite single-spa library with no committed page before building, naming the page", async ({ page, db }) => {
    const source = enrolled(db, ORDERS, offlineViteLibrary());
    await page.goto(`/repositories/${source.publicId}`);
    await section(page).getByRole("button", { name: "Prepare preview" }).click();
    await expect(page).toHaveURL(/preparation=ppr_/);
    await runJobs(db);

    const prepared = section(page).getByRole("region", { name: /^main at / });
    await expect(prepared.getByRole("status")).toContainText("Not previewable");
    const row = prepared.getByRole("table", { name: "Why the commit can't be previewed" }).getByRole("row").filter({ hasText: "orders-spa" }).filter({ hasText: "Page" });
    await expect(row).toContainText("No index.html is committed at index.html, the page Vite builds from. Previews need a page that loads the application on its own.");
    await expect(row).toContainText("vite.config.js");
    expect(previews(db)).toEqual([]);
    expect(db.select().from(jobs).where(eq(jobs.kind, BUILD_PREVIEW)).all()).toEqual([]);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("prepares a tag and shows its decision on the next visit", async ({ page, db }) => {
    const source = enrolled(db, ORDERS, offlineViteApp());
    await page.goto(`/repositories/${source.publicId}`);
    await section(page).getByRole("combobox", { name: "Branch or tag" }).selectOption({ label: "v1.0.0" });
    await section(page).getByRole("button", { name: "Prepare preview" }).click();
    await expect(page).toHaveURL(/preparation=ppr_/);
    const prepared = section(page).getByRole("region", { name: /^v1\.0\.0 at [0-9a-f]{12}$/ });
    await expect(prepared).toContainText("Profiling");

    await runJobs(db);
    await page.reload();
    await expect(prepared).toContainText("1 package can be previewed, so its build started.");
    await prepared.getByRole("link", { name: "Open preview" }).click();
    await expect(page.locator("[data-preview-summary]")).toContainText("Tag v1.0.0");
    await expect(page.locator("[data-preview-state]")).toHaveText("Ready");
    await expect(page.getByRole("figure", { name: "Attempt 1 log" })).toContainText("==> ready:");
  });
});
