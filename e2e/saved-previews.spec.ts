import path from "node:path";
import type { Page } from "@playwright/test";
import { getApplication, getApplicationRow } from "../src/lib/applications/records";
import { findSavedPreview, savedPreviewsOf } from "../src/lib/applications/saved-previews";
import type { Db } from "../src/lib/db/client";
import { git } from "../test/support/git-fixture";
import { offlineViteApp } from "../test/support/preview-trees";
import { onboarded, publishSeededPreview, registered, seeded, seededPreview } from "./support/applications";
import { E2E_PREVIEWS } from "./support/env";
import { expect as baseExpect, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { runJobs } from "./support/results";

/*
 * An application's saved previews (restore-toolbar-tools-and-branch-
 * previews, tasks 3.1 and 3.2; applications/saved-previews spec): the
 * Previews section on the application's page, with its states, live
 * updates, and row actions, and New preview, which saves a branch or tag and
 * opens preview mode on it, with or without JavaScript.
 */

test.skip(!E2E_PREVIEWS, "Applications exist only while previews are on (E2E_PREVIEWS=0)");
const expect = baseExpect.configure({ timeout: 15_000 });
test.setTimeout(120_000);

const section = (page: Page) => page.getByRole("region", { name: "Previews" });
const rows = (page: Page) => section(page).locator("tbody tr");
const row = (page: Page, label: string) => section(page).locator("tbody tr").filter({ has: page.getByRole("link", { name: label, exact: true }) });

/** Orders portal from an offline Vite app on main, with feature/new-nav and the tag v1.1.0 on commits of their own; built. */
async function ordersPortal(db: Db, sourcesDir: string): Promise<string> {
  const remote = path.join(sourcesDir, "orders-web");
  const repository = registered(db, remote, offlineViteApp());
  git(remote, ["checkout", "--quiet", "-b", "feature/new-nav"]);
  git(remote, ["commit", "--quiet", "--allow-empty", "-m", "New nav"]);
  git(remote, ["checkout", "--quiet", "-b", "release/1.1", "main"]);
  git(remote, ["commit", "--quiet", "--allow-empty", "-m", "Release 1.1"]);
  git(remote, ["tag", "v1.1.0"]);
  git(remote, ["checkout", "--quiet", "main"]);
  const [created] = await onboarded(db, [repository, "Orders portal"]);
  await runJobs(db);
  return created!.publicId;
}

test("lists saved previews by name, with each one's image, kind, status, commit, and time, linked to preview mode (Three previews)", async ({ page, db }) => {
  const orders = seeded(db, "Orders portal");
  const tag = seededPreview(db, orders, "refs/tags/v1.1.0", { state: "building" });
  const feature = seededPreview(db, orders, "refs/heads/feature/new-nav");
  seededPreview(db, orders, "refs/heads/fix/totals", { state: "failed" });
  await page.goto(paths.application(orders.slug));

  // Between the overview and Builds.
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings.indexOf("Previews")).toBeLessThan(headings.indexOf("Builds"));
  await expect(rows(page).getByRole("link")).toHaveText(["feature/new-nav", "fix/totals", "v1.1.0"]);
  const ready = row(page, "feature/new-nav");
  await expect(ready.getByRole("img", { name: `Screenshot of Orders portal, feature/new-nav, at commit ${feature.current!.commitSha.slice(0, 7)}` })).toBeVisible();
  await expect(ready).toContainText("Branch");
  await expect(ready).toContainText("Ready");
  await expect(ready).toContainText(feature.current!.commitSha.slice(0, 7));
  await expect(row(page, "fix/totals")).toContainText("Build failed");
  await expect(row(page, "v1.1.0")).toContainText("Tag");
  await expect(row(page, "v1.1.0")).toContainText("Building");
  await expect(row(page, "v1.1.0").locator("[data-placeholder]")).toHaveCount(1);
  await expect(row(page, "v1.1.0")).toContainText("None yet");
  expect(tag.status).toBe("building");

  await ready.getByRole("link", { name: "feature/new-nav" }).click();
  await expect(page).toHaveURL(/\/applications\/orders-portal\/preview\?preview=feature-new-nav$/);
});

test("offers Open full screen, Rebuild preview, and Remove preview in a ready preview's overflow menu (Row actions)", async ({ page, db }) => {
  const orders = seeded(db, "Orders portal");
  seededPreview(db, orders, "refs/heads/feature/new-nav");
  await page.goto(paths.application(orders.slug));
  await row(page, "feature/new-nav").getByRole("button", { name: "Actions for feature/new-nav" }).click();
  const menu = page.locator("[popover]:popover-open");
  await expect(menu.getByRole("link", { name: /Open full screen/ })).toHaveAttribute("href", "/run/orders-portal@feature-new-nav");
  await expect(menu.getByRole("button")).toHaveText(["Rebuild preview", "Remove preview"]);
});

test("shows an empty state that offers New preview (None saved)", async ({ page, db }) => {
  const orders = seeded(db, "Orders portal");
  await page.goto(paths.application(orders.slug));
  await expect(section(page).getByText("No saved previews")).toBeVisible();
  await expect(section(page)).toContainText("Previews keep a branch or tag built");
  await section(page).getByRole("link", { name: "New preview" }).click();
  await expect(page).toHaveURL(/\/applications\/orders-portal\/previews\/new$/);
});

test("updates while a preview builds, and announces it once (A preview finishes)", async ({ page, db }) => {
  const orders = seeded(db, "Orders portal");
  seededPreview(db, orders, "refs/heads/feature/new-nav", { state: "building" });
  await page.goto(paths.application(orders.slug));
  await expect(row(page, "feature/new-nav")).toContainText("Building");

  publishSeededPreview(db, orders, "feature-new-nav");
  await expect(row(page, "feature/new-nav")).toContainText("Ready");
  await expect(row(page, "feature/new-nav").getByRole("img", { name: /^Screenshot of Orders portal, feature\/new-nav/ })).toBeVisible();
  await expect(page.locator("[data-build-announcements]")).toHaveText("Orders portal (feature/new-nav): Ready.");
});

test("removes a preview after confirming, and keeps it when the confirmation is cancelled (Removing a preview, Cancelling)", async ({ page, db }) => {
  const orders = seeded(db, "Orders portal");
  seededPreview(db, orders, "refs/heads/fix/totals");
  seededPreview(db, orders, "refs/heads/feature/new-nav");
  await page.goto(paths.application(orders.slug));
  const remove = async () => {
    await row(page, "fix/totals").getByRole("button", { name: "Actions for fix/totals" }).click();
    await page.locator("[popover]:popover-open").getByRole("button", { name: "Remove preview" }).click();
    return page.getByRole("dialog", { name: "Remove the preview of fix/totals?" });
  };

  let dialog = await remove();
  await expect(dialog).toContainText("Comments placed on it stay.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(2);

  dialog = await remove();
  await dialog.getByRole("button", { name: "Remove preview" }).click();
  await expect(page.getByText("The saved preview was removed.", { exact: true })).toBeVisible();
  await expect(rows(page).getByRole("link")).toHaveText(["feature/new-nav"]);
  expect(savedPreviewsOf(db, orders.publicId).map((saved) => saved.key)).toEqual(["feature-new-nav"]);

  // Its preview mode address opens the tracked branch, saying so, and its running address answers not available.
  await page.goto(paths.applicationPreview(orders.slug, { preview: "fix-totals" }));
  await expect(page).toHaveURL(/\/preview\?notice=removed$/);
  await expect(page.getByText("That saved preview was removed")).toBeVisible();
  const response = await page.goto(paths.runningApplication(orders.slug, "", undefined, "fix-totals"));
  expect(response!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Application not available", level: 1 })).toBeVisible();
});

test("creates a preview from the application page, and preview mode opens on it as it builds (From the application page)", async ({ page, db, sourcesDir }) => {
  const id = await ordersPortal(db, sourcesDir);
  await page.goto(paths.application("orders-portal"));
  await section(page).getByRole("link", { name: "New preview" }).click();
  await expect(page.getByRole("heading", { name: "New preview", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link")).toHaveText(["Applications", "Orders portal"]);
  await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/heads/feature/new-nav");
  await page.getByRole("button", { name: "Create preview" }).click();

  await expect(page).toHaveURL(/\/applications\/orders-portal\/preview\?preview=feature-new-nav$/);
  await expect(page.getByRole("combobox", { name: "Branch or tag" })).toHaveValue("refs/heads/feature/new-nav");
  await expect(page.locator("[data-ref-state] [data-placeholder]")).toHaveCount(1);
  await runJobs(db);
  await expect(page.locator("[data-preview-frame]")).toHaveAttribute("title", /feature\/new-nav/);
  await expect(page.getByRole("link", { name: /Open full screen/ })).toHaveAttribute("href", "/run/orders-portal@feature-new-nav");
  // Saving changed neither the tracked branch nor the builds list.
  expect(getApplication(db, "orders-portal")).toMatchObject({ publicId: id, trackedBranch: "main" });

  // A ref already saved opens its existing preview, and nothing more is saved.
  await page.goto(paths.newApplicationPreview("orders-portal"));
  await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/heads/feature/new-nav");
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page).toHaveURL(/\?preview=feature-new-nav$/);
  expect(savedPreviewsOf(db, id)).toHaveLength(1);
});

test("refuses the tracked branch (The tracked branch)", async ({ page, db, sourcesDir }) => {
  await ordersPortal(db, sourcesDir);
  await page.goto(paths.newApplicationPreview("orders-portal"));
  await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/heads/main");
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("combobox", { name: "Branch or tag" })).toHaveAccessibleDescription(/main is already the application's tracked branch\./);
  expect(savedPreviewsOf(db, getApplication(db, "orders-portal").publicId)).toEqual([]);
});

test("refuses the 21st preview, and says how many remain once five or fewer do (At the limit)", async ({ page, db, sourcesDir }) => {
  const id = await ordersPortal(db, sourcesDir);
  const applicationId = getApplicationRow(db, id).id;
  const seed = (index: number) =>
    db.$client
      .prepare("insert into application_previews (public_id, application_id, key, ref, latest_commit_sha, latest_outcome, latest_reasons, latest_requested_at, created_at, updated_at) values (?, ?, ?, ?, ?, 'failed', '[{\"text\":\"no\"}]', 0, 0, 0)")
      .run(`apv_${String(index).padStart(16, "0")}`, applicationId, `old-${index}`, `refs/heads/old/${index}`, "e".repeat(40));
  for (let index = 0; index < 17; index++) seed(index);
  await page.goto(paths.newApplicationPreview("orders-portal"));
  await expect(page.getByRole("combobox", { name: "Branch or tag" })).toHaveAccessibleDescription(/3 more previews can be saved\./);

  for (let index = 17; index < 20; index++) seed(index);
  await page.reload();
  await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/heads/feature/new-nav");
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("combobox", { name: "Branch or tag" })).toHaveAccessibleDescription(/An application can keep 20 previews\. Remove a preview to save another\./);
  expect(findSavedPreview(db, id, "feature-new-nav")).toBeUndefined();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("creates a preview from New preview, and preview mode opens on it (Without JavaScript)", async ({ page, db, sourcesDir }) => {
    await ordersPortal(db, sourcesDir);
    await page.goto(paths.newApplicationPreview("orders-portal"));
    await page.getByRole("combobox", { name: "Branch or tag" }).selectOption("refs/tags/v1.1.0");
    await page.getByRole("button", { name: "Create preview" }).click();
    await expect(page).toHaveURL(/\/applications\/orders-portal\/preview\?preview=v1\.1\.0$/);
    expect(findSavedPreview(db, getApplication(db, "orders-portal").publicId, "v1.1.0")).toMatchObject({ kind: "tag", ref: "refs/tags/v1.1.0" });
  });
});
