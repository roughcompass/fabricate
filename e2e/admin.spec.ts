import { catalogConfiguration } from "../src/lib/catalog/configuration";
import { queueBuild } from "../src/lib/catalog/build";
import { storeEntry } from "../src/lib/catalog/entries";
import { jobHandlers } from "../src/lib/jobs/registry";
import { drainJobs } from "../src/lib/jobs/worker";
import { currentRecipe, moveSurvey, requestSurvey } from "../src/lib/surveys/records";
import { buildRepository } from "../test/support/builders";
import { saltEntry } from "../test/support/catalog";
import { manifest } from "../test/support/profiles";
import { seedSurvey } from "../test/support/scenarios";
import { expect, test } from "./support/fixtures";
import { serverConfig } from "./support/results";
import { expectCurrentItem, pageHeader, pageTitle, toasts } from "./support/shell";


const TOKEN = "BBDC-NzA2MzQ1NjYxMjM0OkxhYmNkZWZnaGlqa2xtbm9w";

test("saves a Bitbucket Server token, shows only its last four characters, and deletes it after confirming", async ({ page, db: _db }) => {
  await page.goto("/admin/bitbucket-tokens");
  await expect(page.getByText("No Bitbucket tokens yet")).toBeVisible();

  await page.getByRole("link", { name: "Add token" }).click();
  // The owner comes first.
  await expect(page.locator("form input:not([type=hidden])").first()).toHaveAccessibleName(/Owner/);
  await page.getByLabel("Owner").fill("Platform team");
  await page.getByLabel("Server").fill("http://bitbucket.example.com");
  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Add token" }).click();
  // A refused submission keeps the owner and server, never the token.
  await expect(page.getByText("The server must use https://")).toBeVisible();
  await expect(page.getByLabel("Owner")).toHaveValue("Platform team");
  await expect(page.getByLabel("Token")).toHaveValue("");

  await page.getByLabel("Server").fill("https://bitbucket.example.com/bitbucket/");
  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Add token" }).click();
  await expect(page).toHaveURL(/\/admin\/bitbucket-tokens(\?|$)/);
  await expect(toasts(page).getByText("Platform team was saved.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Platform team" });
  await expect(row).toContainText("https://bitbucket.example.com/bitbucket");
  await expect(page.getByRole("columnheader").first()).toHaveText("Owner");
  await expect(row).toContainText("••••bm9w");
  expect(await page.content()).not.toContain(TOKEN);

  await row.getByRole("button", { name: "Actions for Platform team" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Platform team?" });
  await expect(dialog).toContainText("doesn't revoke it in Bitbucket");
  await dialog.getByRole("button", { name: "Delete token" }).click();
  await expect(toasts(page).getByText("Platform team was deleted.")).toBeVisible();
  await expect(page.getByText("No Bitbucket tokens yet")).toBeVisible();
});

// repository-git-credentials spec, "Another owner submits a token for the same server" and "A removed token can be replaced".
test("refuses a second token for a server, whoever owns it, until the server's token is deleted", async ({ page, db: _db }) => {
  const add = async (owner: string, server: string, token: string) => {
    await page.goto("/admin/bitbucket-tokens/new");
    await page.getByLabel("Owner").fill(owner);
    await page.getByLabel("Server").fill(server);
    await page.getByLabel("Token").fill(token);
    await page.getByRole("button", { name: "Add token" }).click();
  };
  await add("Platform team", "https://bitbucket.example.com/bitbucket", TOKEN);
  await expect(toasts(page).getByText("Platform team was saved.")).toBeVisible();

  await add("Web team", "https://BITBUCKET.example.com:443/bitbucket/", "BBDC-another-token-0001");
  const server = page.getByLabel("Server");
  await expect(server).toHaveAccessibleDescription("This server already has a token, saved for Platform team; delete it to save a new one");
  await expect(server).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Token")).toHaveValue("");

  await page.goto("/admin/bitbucket-tokens");
  await expect(page.getByRole("row").filter({ hasText: "bitbucket.example.com" })).toHaveCount(1);
  await page.getByRole("row").filter({ hasText: "Platform team" }).getByRole("button", { name: "Actions for Platform team" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete Platform team?" }).getByRole("button", { name: "Delete token" }).click();
  await expect(toasts(page).getByText("Platform team was deleted.")).toBeVisible();

  await add("Web team", "https://BITBUCKET.example.com:443/bitbucket/", "BBDC-another-token-0001");
  await expect(toasts(page).getByText("Web team was saved.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Web team" })).toContainText("https://bitbucket.example.com/bitbucket");
});

// page-patterns spec, "Empty list".
test("Empty list: the empty state offers Add token as the page's only primary action, and the page header doesn't repeat it", async ({ page, db: _db }) => {
  await page.goto("/admin/bitbucket-tokens");
  const primaries = page.getByRole("main").locator('[data-variant="primary"]');
  await expect(primaries).toHaveCount(1);
  await expect(primaries).toHaveText("Add token");
  await expect(pageHeader(page).getByRole("link", { name: "Add token" })).toHaveCount(0);
  await expect(page.getByRole("main").getByText("No Bitbucket tokens yet")).toBeVisible();
});

const SALT_APP = {
  "package.json": manifest({ name: "current", version: "1.0.0", dependencies: { "@salt-ds/core": "1.75.0" } }),
  "src/App.tsx": 'import { Button } from "@salt-ds/core";\nexport const App = () => <Button>Save</Button>;\n',
};

// operator-interface/system-status spec.
test.describe("System status", () => {
  const FAR_FUTURE = new Date("2100-01-01T00:00:00.000Z");

  test("Catalog build failed: shows the failure with its time and reason, and the entries still in use", async ({ page, db }) => {
    const config = serverConfig();
    storeEntry(db, saltEntry());
    queueBuild(db, catalogConfiguration(config).things[0]!, "1.76.0", "published");
    // The browser tests' registry is unreachable; draining at a later time runs every retry.
    await drainJobs(db, jobHandlers(db, config), { now: () => FAR_FUTURE });

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/system$/);
    await expect(page).toHaveTitle("System · Frontend Registry");
    await expect(pageTitle(page)).toHaveText("System");
    await expectCurrentItem(page, "System");

    const alert = page.locator("#page-alerts");
    await expect(alert).toContainText("The latest Catalog build, of Salt 1.76.0, failed");
    await expect(alert).toContainText("The package registry couldn't be reached.");
    await expect(alert).toContainText("The entries in use below are unchanged.");

    const builds = page.getByRole("table", { name: "Catalog builds" });
    const failed = builds.getByRole("row").filter({ hasText: "Salt 1.76.0" });
    await expect(failed).toContainText("Newest release");
    await expect(failed).toContainText("Failed");
    await expect(failed).toContainText("The package registry couldn't be reached.");
    await expect(failed.locator("time")).toBeVisible();
    // The Catalog Builder's reason is in the details, not the overview.
    await expect(failed.getByText("registry_unreachable")).toBeHidden();
    await failed.getByText("Details").click();
    await expect(failed.getByText("registry_unreachable")).toBeVisible();

    const entries = page.getByRole("table", { name: "Reference Catalog entries" });
    await expect(entries.getByRole("row").filter({ hasText: "Salt 1.75.0" })).toContainText("@salt-ds/core");
    await expect(entries.getByRole("row").filter({ hasText: "Salt 1.75.0" })).toContainText("as of 2026-03-31");
    await expect(page.getByText("Surveyor release", { exact: true })).toBeVisible();
  });

  test("Re-survey progress: counts current, waiting, and failed Repositories, each a link to those Repositories (After a Surveyor upgrade)", async ({ page, db }) => {
    const config = serverConfig();
    storeEntry(db, saltEntry());
    // A Salt app's survey records the Salt entry it was given, as a real survey does.
    await seedSurvey(db, buildRepository(db, { name: "current" }), { files: SALT_APP });
    const earlier = buildRepository(db, { name: "earlier" });
    requestSurvey(db, { repositoryId: earlier.id, commitSha: "a".repeat(40), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", ...currentRecipe(config), surveyorRelease: "0.6.0" });
    const failing = buildRepository(db, { name: "failing" });
    const { survey } = requestSurvey(db, { repositoryId: failing.id, commitSha: "b".repeat(40), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", ...currentRecipe(config) });
    moveSurvey(db, survey, "failed", { failureCode: "source_unavailable", failureMessage: "The remote is down" });
    buildRepository(db, { name: "unsurveyed" });

    await page.goto("/admin/system");
    const figure = (label: string) => page.locator("dl[data-key-figures] > div").filter({ hasText: label });
    await expect(figure("Current recipe").locator("dd").first()).toHaveText("1");
    await expect(figure("Waiting").locator("dd").first()).toHaveText("2");
    await expect(figure("Failed").locator("dd").first()).toHaveText("1");

    for (const [label, names] of [["Current recipe", ["current"]], ["Waiting", ["earlier", "unsurveyed"]], ["Failed", ["failing"]]] as const) {
      await page.goto("/admin/system");
      await figure(label).getByRole("link").click();
      await expect(page).toHaveURL(/\/repositories\?recipe=/);
      const table = page.getByRole("table", { name: "Repositories" });
      await expect(table.locator("tbody tr td:first-child a"), label).toHaveText([...names]);
    }
  });
});
