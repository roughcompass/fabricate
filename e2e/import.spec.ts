import fs from "node:fs";
import path from "node:path";
import { listSources } from "../src/lib/catalog/source-records";
import { expect, expectNoHorizontalOverflow, gitRepo, test } from "./support/fixtures";

test("previews a directory without changing the catalog and imports exactly the selected candidates", async ({ page, db, sourcesDir }) => {
  gitRepo(path.join(sourcesDir, "orders"));
  gitRepo(path.join(sourcesDir, "billing"));
  fs.mkdirSync(path.join(sourcesDir, "notes"));
  gitRepo(path.join(sourcesDir, "fleet-kit"));

  await page.goto("/sources/import");
  await page.getByLabel("Absolute path").fill(sourcesDir);
  await page.getByRole("button", { name: "Preview" }).click();

  const candidates = page.getByRole("table", { name: "Import candidates" });
  await expect(candidates).toContainText("billing");
  await expect(candidates).toContainText("orders");
  await expect(candidates).not.toContainText("notes");
  await expect(candidates).not.toContainText("fleet-kit");
  expect(listSources(db)).toEqual([]);

  await page.getByRole("checkbox", { name: "Import billing" }).uncheck();
  await page.getByRole("button", { name: "Add selected sources" }).click();

  await expect(page.getByText("Added 1 source.")).toBeVisible();
  expect(listSources(db).map((source) => [source.name, source.cloneUrl])).toEqual([["orders", `file://${fs.realpathSync(path.join(sourcesDir, "orders"))}`]]);

  await page.goto(`/sources/import?directory=${encodeURIComponent(sourcesDir)}`);
  await expect(page.getByText("Already registered as orders")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Import orders" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Import orders" })).not.toBeChecked();
});

test("rejects directories outside the allowed roots", async ({ page, db: _db }) => {
  await page.goto("/sources/import?directory=%2F");

  await expect(page.getByText("is outside the allowed source roots")).toBeVisible();
  await expect(page.getByLabel("Absolute path")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Add selected sources" })).toHaveCount(0);
});

test("the import preview stays usable at mobile width", async ({ page, sourcesDir }) => {
  gitRepo(path.join(sourcesDir, "a-repository-with-a-rather-long-directory-name"));
  // A rejected candidate shows a long path in its reason.
  fs.symlinkSync("/usr", path.join(sourcesDir, "escape-to-a-directory-outside-the-allowed-roots"));
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto(`/sources/import?directory=${encodeURIComponent(sourcesDir)}`);
  await expect(page.getByRole("checkbox", { name: "Import a-repository-with-a-rather-long-directory-name" })).toBeChecked();
  await expectNoHorizontalOverflow(page);
});
