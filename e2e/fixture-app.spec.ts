import fs from "node:fs";
import path from "node:path";
import { previewDirectory } from "../src/lib/previews/storage";
import { E2E_PACKAGE_CACHE, E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { buildOrdersPortal, commitToOrdersPortal, ordersPortalRemote, previewOrdersPortal } from "./support/fixture-app";
import { paths } from "./support/paths";
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
