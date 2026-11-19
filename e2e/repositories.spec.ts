import type { Page } from "@playwright/test";
import { buildRepository } from "../test/support/builders";
import { listRepositories } from "../src/lib/repositories/repository-records";
import { versionsOf } from "../src/lib/profiling/versions";
import { moveSurvey, requestSurvey } from "../src/lib/surveys/records";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { toasts } from "./support/shell";

const rowMenu = async (page: Page, name: string) => {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  return page.locator("[popover]:popover-open");
};

test("adds and edits a Source with validation feedback", async ({ page, db: _db }) => {
  await page.goto(paths.repositories);
  await expect(page.getByText("No Repositories yet")).toBeVisible();
  await page.getByRole("link", { name: "New Repository" }).first().click();

  await page.getByLabel("Name").fill("orders");
  await page.getByLabel("Clone URL").fill("git@github.com:acme/orders.git");
  await page.getByRole("button", { name: "Create Repository" }).click();
  // Once, under the field, which takes focus.
  await expect(page.locator("#source-clone-url-error")).toContainText("scp-style shorthand");
  await expect(page.getByText("scp-style shorthand")).toHaveCount(1);
  await expect(page.getByLabel("Clone URL")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Clone URL")).toBeFocused();
  await expect(page.getByLabel("Name")).toHaveValue("orders");

  await page.getByLabel("Clone URL").fill("https://user:hunter2@git.example.com/acme/orders.git");
  await page.getByRole("button", { name: "Create Repository" }).click();
  await expect(page.locator("#source-clone-url-error")).toContainText("configure a credential helper");
  await expect(page.locator("body")).not.toContainText("hunter2");
  await expect(page.getByLabel("Clone URL")).not.toHaveValue(/hunter2/);

  await page.getByLabel("Clone URL").fill("https://git.example.com/acme/orders.git");
  await page.getByLabel("Reference").fill("main");
  await page.getByRole("button", { name: "Create Repository" }).click();
  await expect(toasts(page).getByText("orders was added.")).toBeVisible();

  await page.getByRole("link", { name: "New Repository" }).first().click();
  await page.getByLabel("Name").fill("duplicate");
  await page.getByLabel("Clone URL").fill("https://GIT.example.com/acme/orders");
  await page.getByRole("button", { name: "Create Repository" }).click();
  await expect(page.locator("#source-clone-url-error")).toContainText("already registered as orders (src_");
  await page.getByRole("link", { name: "Cancel" }).click();

  // A new Repository's first survey is requested in the background, and its name opens its page.
  await expect(page.getByRole("row", { name: /orders/ })).toContainText("Queued");
  await page.getByRole("link", { name: "orders", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "orders" })).toBeVisible();
  await expect(page.getByText("Not profiled yet")).toBeVisible();
  // Re-profile reads the reference at once, and says when it can't.
  await page.getByRole("button", { name: "Re-profile" }).click();
  await expect(toasts(page).getByText("orders's reference couldn't be read.")).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByLabel("Reference").fill("release");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toasts(page).getByText("Running and past Runs keep the configuration they started with.")).toBeVisible();
  await page.goto(paths.repositories);
  await expect(page.getByRole("row", { name: /orders/ })).toContainText("release");

  const menu = await rowMenu(page, "orders");
  await expect(menu.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(menu).not.toContainText("Disable");
});

test("deletes a Repository only after its effects are read and its name is typed", async ({ page, db }) => {
  const orders = buildRepository(db, { name: "orders" });
  buildRepository(db, { name: "billing" });

  await page.goto(`/repositories/${orders.publicId}/settings`);
  const zone = page.locator("#danger-zone");
  await expect(zone).toContainText("Once you delete a repository, there is no going back. Please be certain.");
  await zone.getByRole("button", { name: "Delete this repository" }).click();

  const dialog = page.getByRole("dialog", { name: "Delete orders" });
  await dialog.getByRole("button", { name: "I want to delete this repository" }).click();
  await expect(dialog).toContainText("Unexpected bad things will happen if you don't read this!");
  await dialog.getByRole("button", { name: "I have read and understand these effects" }).click();

  const remove = dialog.getByRole("button", { name: "Delete this repository" });
  await expect(remove).toBeDisabled();
  await dialog.getByLabel(/To confirm, type/).fill("order");
  await expect(remove).toBeDisabled();
  await dialog.getByLabel(/To confirm, type/).fill("orders");
  await expect(remove).toBeEnabled();
  await remove.click();

  await expect(toasts(page).getByText("orders was deleted.")).toBeVisible();
  await expect(page.getByRole("row", { name: /orders/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /billing/ })).toHaveCount(1);
  expect((await page.goto(`/repositories/${orders.publicId}`))!.status()).toBe(404);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("deletes a Repository from the name field on the page, in place of the dialog's button", async ({ page, db }) => {
    const orders = buildRepository(db, { name: "orders" });

    await page.goto(`/repositories/${orders.publicId}/settings`);
    const zone = page.locator("#danger-zone");
    await expect(zone.getByRole("button", { name: "Delete this repository" })).toHaveCount(1);
    await zone.getByLabel(/To confirm, type/).fill("order");
    await zone.getByRole("button", { name: "Delete this repository" }).click();
    await expect(page.getByText("Type orders to confirm")).toBeVisible();

    await page.locator("#danger-zone").getByLabel(/To confirm, type/).fill("orders");
    await page.locator("#danger-zone").getByRole("button", { name: "Delete this repository" }).click();
    await expect(page.getByText("orders was deleted.")).toBeVisible();
  });
});

test("asks for the clone URL first and names the Repository after its owner and repository until a name is typed", async ({ page, db: _db }) => {
  await page.goto(`${paths.repositories}/new`);
  const fields = page.locator("form input:not([type=hidden])");
  await expect(fields.nth(0)).toHaveAccessibleName(/Clone URL/);
  await expect(fields.nth(1)).toHaveAccessibleName(/Name/);

  const url = page.getByLabel("Clone URL");
  const name = page.getByLabel("Name");
  await url.fill("https://github.com/vickykatoch/helios.git");
  await expect(name).toHaveValue("vickykatoch-helios");

  await name.fill("Helios");
  await url.fill("https://github.com/vickykatoch/helios-docs.git");
  await expect(name).toHaveValue("Helios");

  await name.fill("");
  await url.fill("https://github.com/vickykatoch/helios.git");
  await expect(name).toHaveValue("vickykatoch-helios");
  await page.getByRole("button", { name: "Create Repository" }).click();
  await expect(toasts(page).getByText("vickykatoch-helios was added.")).toBeVisible();
});

test("adds Repositories in bulk, keeps the refused lines to fix, and shows what is being profiled", async ({ page, db }) => {
  await page.goto(paths.repositories);
  await page.getByRole("link", { name: "Add in bulk" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Add Repositories" })).toBeVisible();

  await page.getByLabel("Clone URLs").fill(["https://github.com/vickykatoch/helios.git", "git@github.com:acme/scp.git", "https://github.com/openmrs/openmrs-esm-core.git main"].join("\n"));
  await page.getByRole("button", { name: "Add Repositories" }).click();
  await expect(page.getByText("Added 2 of 3 Repositories")).toBeVisible();
  await expect(page.getByRole("table", { name: "Lines that couldn't be added" })).toContainText("scp-style shorthand");
  await expect(page.getByLabel("Clone URLs")).toHaveValue("git@github.com:acme/scp.git");

  await page.getByLabel("Clone URLs").fill("ssh://git@github.com/acme/scp.git");
  await page.getByRole("button", { name: "Add Repositories" }).click();
  await expect(toasts(page).getByText("Added 1 Repository.")).toBeVisible();
  await expect(page.getByRole("row", { name: /vickykatoch-helios/ })).toContainText("Queued");

  // Each one's reference resolves in the background, which queues its first version.
  for (const [index, repository] of listRepositories(db).entries()) {
    const commitSha = (index + 1).toString(16).padStart(40, "0");
    requestSurvey(db, { repositoryId: repository.id, commitSha, reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", surveyorRelease: "0.0.0", configurationDigest: "f".repeat(64), profileSchemaVersion: 2 });
  }
  await page.reload();
  await expect(page.getByRole("row", { name: /vickykatoch-helios/ })).toContainText("Version 1 queued");
  await expect(page.locator("[data-profiling-activity]")).toHaveText(/3 queued/);

  // A version the worker has started shows as profiling, with a pulsing indicator.
  const helios = listRepositories(db).find((repository) => repository.name === "vickykatoch-helios")!;
  moveSurvey(db, versionsOf(db, helios.id)[0]!.survey, "running", { attempts: 1 });
  await page.reload();
  await expect(page.getByRole("row", { name: /vickykatoch-helios/ }).locator("[data-profiling=profiling]")).toContainText("Profiling version 1");
  await expect(page.locator("[data-profiling-activity]")).toHaveText(/Profiling 1 Repository.*2 queued/);
});

test("searches Sources by name or clone URL, keeping the search in the address", async ({ page, db }) => {
  buildRepository(db, { name: "orders" });
  buildRepository(db, { name: "billing", cloneUrl: "https://git.example.com/acme/ledger-ordinals.git" });
  buildRepository(db, { name: "accounts" });

  await page.goto(paths.repositories);
  const search = page.getByRole("searchbox", { name: "Search Repositories" });
  await expect(search).toHaveAttribute("placeholder", "Search by name or clone URL");
  await search.fill("ord");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=ord/);
  const rows = page.getByRole("table", { name: "Repositories" }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "accounts" })).toHaveCount(0);
  await expect(page.getByText("2 Repositories of 3")).toBeVisible();

  await search.fill("nothing-matches");
  await search.press("Enter");
  await expect(page.getByText("No matching Repositories")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(rows).toHaveCount(3);
});

test("the removed claim and DE Console addresses respond as not found, and a former ownership filter is ignored", async ({ page, db }) => {
  buildRepository(db, { name: "orders" });
  buildRepository(db, { name: "billing" });
  for (const removed of ["/repositories/claim", "/repositories/de-console"]) {
    const response = await page.goto(removed);
    expect(response?.status(), removed).toBe(404);
  }

  await page.goto(`${paths.repositories}?ownership=unclaimed`);
  await expect(page.getByRole("table", { name: "Repositories" }).locator("tbody tr")).toHaveCount(2);
  await expect(page.getByLabel("Ownership")).toHaveCount(0);
});

test("keeps every row one height, with or without a Reference", async ({ page, db }) => {
  buildRepository(db, { name: "orders", gitRef: "main" });
  buildRepository(db, { name: "billing" });
  await page.goto(paths.repositories);
  const heights = await page.locator("tbody tr").evaluateAll((rows) => rows.map((row) => row.querySelector("td")!.clientHeight));
  expect(new Set(heights).size).toBe(1);
});

test("the catalog stays usable at mobile width", async ({ page, db }) => {
  buildRepository(db, { name: "orders-with-a-long-name", cloneUrl: "https://git.example.com/acme/orders-with-a-very-long-repository-name-for-testing.git" });
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto(paths.repositories);
  await expect(page.getByText("orders-with-a-long-name")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole("link", { name: "New Repository" })).toBeVisible();
});
