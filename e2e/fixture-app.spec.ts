import fs from "node:fs";
import path from "node:path";
import { previewDirectory } from "../src/lib/previews/storage";
import { E2E_PACKAGE_CACHE, E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { buildOrdersPortal, commitToOrdersPortal, ordersPortalRemote, previewOrdersPortal } from "./support/fixture-app";
import { paths } from "./support/paths";
import { buildQuotes, quotesComposition } from "./support/quotes-fixtures";
import { serverConfig } from "./support/results";

/*
 * The fixture application, onboarded through the application records and
 * built through the preview pipeline (add-applications, task 9.1): a real
 * `npm ci` and `vite build`, served under /previews/, with a screenshot of
 * its current build, and its packages from the kept package cache once a run
 * has filled it.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
// The first run in a fresh checkout downloads the packages.
test.setTimeout(180_000);

/** The attempt's log, without the colors Vite writes. */
const log = (preview: { publicId: string; attemptLog: string | null }) =>
  fs
    .readFileSync(path.join(previewDirectory(serverConfig(), preview.publicId), preview.attemptLog!), "utf8")
    .replace(/\u001b\[\d+(;\d+)*m/g, "");

test("onboards the orders portal to Ready, built with Vite, with a screenshot, serving both routes under its preview path", async ({ page, db, request }) => {
  const commit = ordersPortalRemote();
  const { application, preview, base } = await buildOrdersPortal(db);
  expect(preview.commitSha).toBe(commit);
  expect(application).toMatchObject({ name: "Orders portal", slug: "orders-portal", status: "ready", trackedBranch: "main", current: { preview: preview.publicId, commitSha: commit } });
  expect(application.facts).toMatchObject({ frameworks: ["React"], buildTool: "Vite" });
  const screenshot = await request.get(paths.applicationScreenshot(application.slug, application.screenshot!.version));
  expect([screenshot.status(), screenshot.headers()["content-type"]]).toEqual([200, "image/webp"]);
  expect([preview.packageDir, preview.packageManager]).toEqual([".", expect.stringMatching(/^npm/)]);
  expect(log(preview)).toContain("==> install: npm ci in the repository root, with package-lock.json");
  expect(log(preview)).toMatch(/vite v8\.\d+\.\d+ building client environment for production/);

  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible();
  // The root takes the application to its first route.
  await expect(page).toHaveURL(`${base}accounts`);
  await page.getByRole("link", { name: "Northwind Traders" }).click();
  await expect(page).toHaveURL(`${base}accounts/42`);
  await expect(page.getByRole("heading", { name: "Northwind Traders", level: 2 })).toBeVisible();

  // Settings loads as its own chunk, and a deep link to it opens it.
  const chunk = page.waitForResponse((response) => /\/assets\/settings-[\w-]+\.js$/.test(response.url()));
  await page.getByRole("link", { name: "Settings" }).click();
  await chunk;
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.goto(`${base}settings`);
  await expect(page.getByLabel("Display name")).toHaveValue("Orders team");
});

test("installs from the kept package cache with no registry to reach", async ({ db }) => {
  ordersPortalRemote();
  await buildOrdersPortal(db);
  expect(fs.readdirSync(E2E_PACKAGE_CACHE)).toContain("_cacache");

  // The same lockfile against a registry nothing answers on: every package must come from the cache.
  commitToOrdersPortal({ ".npmrc": (npmrc) => npmrc.replace("registry=https://registry.npmjs.org/", "registry=http://127.0.0.1:9/") }, { branch: "offline", message: "Install from an unreachable registry" });
  const preview = await previewOrdersPortal(db, { ref: "offline" });
  expect(preview.attemptState).toBe("ready");
  expect(log(preview)).toContain("==> ready");
});

test("onboards Quotes panel and Quotes desk, built with Rspack, each Profile reporting its composition and Salt", async ({ page, db }) => {
  const { desk, panel, commits, blueQuotes, darkBlotter } = await buildQuotes(db);
  expect(panel.application).toMatchObject({ name: "Quotes panel", status: "ready", current: { commitSha: commits.panel } });
  expect(desk.application).toMatchObject({ name: "Quotes desk", status: "ready", current: { commitSha: commits.desk } });
  // Each feature branch is a saved preview, built and captured.
  expect(blueQuotes).toMatchObject({ key: "feature-blue-quotes", label: "feature/blue-quotes", status: "ready", current: { commitSha: commits.blueQuotes } });
  expect(darkBlotter).toMatchObject({ key: "feature-dark-blotter", label: "feature/dark-blotter", status: "ready", current: { commitSha: commits.darkBlotter } });
  expect(blueQuotes!.screenshot).not.toBeNull();
  for (const build of [panel, desk]) expect(build.application.facts).toMatchObject({ frameworks: ["React"], buildTool: "Rspack" });

  // The remote exposes ./Quotes, is a single-spa application through its ticker, and renders Salt's provider.
  expect(quotesComposition(db, panel)).toEqual({ packageName: "@fixtures/quotes-panel", remotes: [], imports: [], singleSpa: { rootConfig: false, application: true }, containers: [{ name: "quotesPanel", exposes: ["./Quotes"] }], saltProvider: true });
  // The host loads it at its development address, maps the ticker in its import map, and starts single-spa.
  expect(quotesComposition(db, desk)).toEqual({
    packageName: "@fixtures/quotes-desk",
    remotes: [{ alias: "quotesPanel", container: "quotesPanel", entry: "http://127.0.0.1:9311/remoteEntry.js" }],
    imports: [{ specifier: "@fixtures/quotes-panel", url: "http://127.0.0.1:9312/ticker.js" }],
    singleSpa: { rootConfig: true, application: false },
    containers: [],
    saltProvider: true,
  });

  // The remote's own page renders its exposed module, and ships the ticker beside it.
  await page.goto(panel.base);
  await expect(page.getByRole("heading", { name: "Quotes panel", level: 2 })).toBeVisible();
  expect((await page.request.get(`${panel.base}ticker.js`)).status()).toBe(200);
  expect((await page.request.get(`${panel.base}remoteEntry.js`)).status()).toBe(200);

  // As built, the host's remote and ticker point where nothing listens.
  await page.goto(desk.base);
  await expect(page.getByRole("heading", { name: "Quotes desk", level: 1 })).toBeVisible();
  await expect(page.getByText("Quotes unavailable")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Ticker" })).toHaveText("Ticker unavailable");
  await page.goto(`${desk.base}blotter`);
  await expect(page.getByRole("heading", { name: "Blotter", level: 1 })).toBeVisible();

  // The saved previews build their branches.
  await page.goto(`/previews/${blueQuotes!.current!.preview}/`);
  await expect(page.getByRole("heading", { name: "Blue quotes panel", level: 2 })).toBeVisible();
  expect(await (await page.request.get(`/previews/${blueQuotes!.current!.preview}/ticker.js`)).text()).toContain("Blue ticker: ");
  await page.goto(`/previews/${darkBlotter!.current!.preview}/blotter`);
  await expect(page.getByRole("heading", { name: "Dark blotter", level: 1 })).toBeVisible();
});
