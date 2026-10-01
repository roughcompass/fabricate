import fs from "node:fs";
import path from "node:path";
import { listSources } from "../src/lib/catalog/source-records";
import { expect, expectNoHorizontalOverflow, gitRepo, test } from "./support/fixtures";
import { paths } from "./support/paths";

test("previews a directory without changing the catalog and imports exactly the selected candidates", async ({ page, db, sourcesDir }) => {
  gitRepo(path.join(sourcesDir, "orders"));
  gitRepo(path.join(sourcesDir, "billing"));
  fs.mkdirSync(path.join(sourcesDir, "notes"));
  gitRepo(path.join(sourcesDir, "fleet-kit"));

  await page.goto(paths.importRepositories);
  await page.getByLabel("Absolute path").fill(sourcesDir);
  await page.getByRole("button", { name: "Preview" }).click();

  const candidates = page.getByRole("table", { name: "Import candidates" });
  await expect(candidates).toContainText("billing");
  await expect(candidates).toContainText("orders");
  await expect(candidates).not.toContainText("notes");
  await expect(candidates).not.toContainText("fleet-kit");
  expect(listSources(db)).toEqual([]);

  await expect(page.getByRole("button", { name: "Add 2 Repositories" })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Import billing" }).uncheck();
  await page.getByRole("button", { name: "Add 1 Repository" }).click();

  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Added 1 Repository.")).toBeVisible();
  expect(listSources(db).map((source) => [source.name, source.cloneUrl])).toEqual([["orders", `file://${fs.realpathSync(path.join(sourcesDir, "orders"))}`]]);

  await page.goto(`${paths.importRepositories}?directory=${encodeURIComponent(sourcesDir)}`);
  await expect(page.getByText("Already registered as orders")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Import orders" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Import orders" })).not.toBeChecked();
});

test("rejects directories outside the allowed roots", async ({ page, db: _db }) => {
  await page.goto(`${paths.importRepositories}?directory=%2F`);

  await expect(page.getByText("is outside the allowed source roots")).toBeVisible();
  await expect(page.getByLabel("Absolute path")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: /^Add/ })).toHaveCount(0);
});

test("the import preview stays usable at mobile width", async ({ page, sourcesDir }) => {
  gitRepo(path.join(sourcesDir, "a-repository-with-a-rather-long-directory-name"));
  // A rejected candidate shows a long path in its reason.
  fs.symlinkSync("/usr", path.join(sourcesDir, "escape-to-a-directory-outside-the-allowed-roots"));
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto(`${paths.importRepositories}?directory=${encodeURIComponent(sourcesDir)}`);
  await expect(page.getByRole("checkbox", { name: "Import a-repository-with-a-rather-long-directory-name" })).toBeChecked();
  await expectNoHorizontalOverflow(page);
});

test("selects every candidate at once and will not add an empty selection", async ({ page, db, sourcesDir }) => {
  gitRepo(path.join(sourcesDir, "orders"));
  gitRepo(path.join(sourcesDir, "billing"));
  await page.goto(`${paths.importRepositories}?directory=${encodeURIComponent(sourcesDir)}`);

  const all = page.getByRole("checkbox", { name: "Select every importable repository" });
  await expect(all).toBeChecked();
  await all.uncheck();
  await expect(page.getByRole("checkbox", { name: "Import orders" })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Add 0 Repositories" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Import orders" }).check();
  await expect(all).toHaveJSProperty("indeterminate", true);
  await expect(page.getByRole("button", { name: "Add 1 Repository" })).toBeEnabled();
  expect(listSources(db)).toEqual([]);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("asks for a selection instead of adding nothing", async ({ page, db, sourcesDir }) => {
    gitRepo(path.join(sourcesDir, "orders"));
    await page.goto(`${paths.importRepositories}?directory=${encodeURIComponent(sourcesDir)}`);
    await page.getByRole("checkbox", { name: "Import orders" }).uncheck();
    await page.getByRole("button", { name: "Add selected Repositories" }).click();

    await expect(page.getByRole("alert")).toContainText("Select at least one repository to add.");
    await expect(page.getByText(/^Added/)).toHaveCount(0);
    expect(listSources(db)).toEqual([]);
  });
});
