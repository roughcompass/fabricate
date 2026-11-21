import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { previewPreparations } from "../src/lib/db/schema";
import { previewDirectory } from "../src/lib/previews/storage";
import { profileDocument, profileOfSurvey } from "../src/lib/profiles/profile-records";
import { compileSet } from "../src/lib/mocks/compile";
import { resolveActiveSet } from "../src/lib/mocks/active";
import { setDirectory } from "../src/lib/mocks/storage";
import { E2E_PACKAGE_CACHE, E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { ORDERS_PORTAL_BRANDS, buildOrdersPortal, commitToOrdersPortal, ordersPortalRemote, previewOrdersPortal, saveOrdersPortalPreview } from "./support/fixture-app";
import { paths } from "./support/paths";
import { ORDERS_HAPPY_PATH, mockApplicationId, seedFailedCalls, seedMockSet, setDefault } from "./support/mock-sets";
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

test("saves previews of feature/new-nav and v1.1.0, each built and captured, served under its own preview path (restore-toolbar-tools-and-branch-previews, task 3.7)", async ({ page, db, request }) => {
  ordersPortalRemote();
  const { application } = await buildOrdersPortal(db);
  const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
  const tag = await saveOrdersPortalPreview(db, "refs/tags/v1.1.0");
  expect([feature.key, feature.kind, tag.key, tag.kind]).toEqual(["feature-new-nav", "branch", "v1.1.0", "tag"]);
  expect(new Set([application.current!.preview, feature.current!.preview, tag.current!.preview]).size).toBe(3);

  for (const [saved, brand] of [
    [feature, ORDERS_PORTAL_BRANDS.feature],
    [tag, ORDERS_PORTAL_BRANDS.release],
  ] as const) {
    const screenshot = await request.get(paths.applicationScreenshot(application.slug, saved.screenshot!.version, "card", saved.key));
    expect([screenshot.status(), screenshot.headers()["content-type"]], saved.label).toEqual([200, "image/webp"]);
    await page.goto(`/previews/${saved.current!.preview}/accounts`);
    await expect(page.getByText(brand, { exact: true })).toBeVisible();
  }
});

test("calls the orders API, which fails without a mock set, and its Profile reports the API (add-mock-sets, task 1.1)", async ({ page, db }) => {
  ordersPortalRemote();
  const { preview, base } = await buildOrdersPortal(db);
  // The build emits its page and the rates worker beside it.
  const output = path.join(previewDirectory(serverConfig(), preview.publicId), preview.artifact!);
  expect(fs.readdirSync(path.join(output, "assets")).some((file) => /^rates-worker-[\w-]+\.js$/.test(file))).toBe(true);

  // The Profile reports the orders API with the operations the code calls.
  const preparation = db.select().from(previewPreparations).where(eq(previewPreparations.id, preview.preparationId)).get()!;
  const document = profileDocument(profileOfSurvey(db, preparation.surveyId!)!).fact_document as { service_dependencies: { key: string; endpoint: { value: { origin?: string } }; operations: { value: unknown } }[] };
  const orders = document.service_dependencies.find((service) => service.key === "https://api.orders.test")!;
  expect(orders.endpoint.value.origin).toBe("https://api.orders.test");
  expect(orders.operations.value).toEqual(expect.arrayContaining([expect.objectContaining({ method: "GET", path: "/v1/orders" }), expect.objectContaining({ method: "POST", path: "/v1/orders/search" })]));

  // `.test` never resolves, so each part says it's unavailable, and the page itself still works.
  await page.goto(`${base}accounts`);
  await expect(page.getByText("Recent orders unavailable")).toBeVisible();
  await expect(page.getByText("Live orders unavailable")).toBeVisible();
  await expect(page.getByText("Rates unavailable")).toBeVisible();
  await expect(page.getByText("Ticker unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Search unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Export orders" }).click();
  await expect(page.getByText("Export unavailable")).toBeVisible();
  await page.getByRole("link", { name: "Northwind Traders" }).click();
  await expect(page.getByText("Account orders unavailable")).toBeVisible();
});

test("seeds a mock set, a default, and failed calls for both agents' specs (add-mock-sets, task 2.7)", async ({ db }) => {
  ordersPortalRemote();
  const { application } = await buildOrdersPortal(db);
  const happy = seedMockSet(db, application.slug, ORDERS_HAPPY_PATH, { default: true, byName: "Presenter" });
  const errors = seedMockSet(db, application.slug, [{ pattern: "/v1/orders", responses: [{ status: 503, json: { error: "Unavailable" } }] }], { name: "Errors", unmatched: "not_mocked" });
  expect([happy.ruleCount, happy.createdByName, errors.ruleCount]).toEqual([ORDERS_HAPPY_PATH.length, "Presenter", 1]);
  // Bodies sit in the server's preview storage, by digest.
  expect(fs.readdirSync(setDirectory(serverConfig(), happy.publicId)).every((file) => /^[0-9a-f]{64}$/.test(file))).toBe(true);
  const applicationId = mockApplicationId(db, application.slug);
  expect(resolveActiveSet(db, { applicationId, previewId: null, workspaceId: null })).toMatchObject({ set: { name: "Happy path" }, source: "application" });
  expect(compileSet(db, happy, serverConfig()).rules.map((rule) => rule.label)).toContain("GET /v1/exports/9");

  setDefault(db, application.slug, errors.publicId);
  expect(resolveActiveSet(db, { applicationId, previewId: null, workspaceId: null }).set?.name).toBe("Errors");
  setDefault(db, application.slug, null);
  expect(resolveActiveSet(db, { applicationId, previewId: null, workspaceId: null })).toEqual({ set: null, source: "none" });

  seedFailedCalls(db, application.slug, [
    { url: "https://api.orders.test/v1/orders?limit=5&_=1763650000000", kind: "connect", error: "net::ERR_NAME_NOT_RESOLVED" },
    { url: "https://api.orders.test/v1/rates", kind: "status", status: 503 },
  ]);
  expect(db.$client.prepare("select failed_calls from preview_screenshots s join applications a on a.current_preview_id = s.preview_id where a.slug = ?").get(application.slug)).toEqual({ failed_calls: 2 });
});
