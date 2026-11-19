import path from "node:path";
import type { Page } from "@playwright/test";
import { repositories } from "../src/lib/db/schema";
import { insertRepository } from "../src/lib/repositories/repository-records";
import { decidedPreparation, qualifyingVerdict, refusedVerdict } from "../test/support/applications";
import { git } from "../test/support/git-fixture";
import { SCALA_SERVICE, offlineViteApp } from "../test/support/preview-trees";
import { manifest } from "../test/support/profiles";
import { registered, seeded } from "./support/applications";
import { E2E_PREVIEWS } from "./support/env";
import { expect as baseExpect, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { runJobs } from "./support/results";
import { expectCurrentItem, pageTitle } from "./support/shell";

/*
 * Onboarding (add-applications tasks 5.1 to 5.6; applications/onboarding
 * spec): a focused flow opened from Applications or a Repository, choosing or
 * adding the repository, the branch with its eligibility checked from a
 * survey of its commit, the package of a workspace, and the details and trust
 * confirmation that create the application, enroll its remote, and queue its
 * first build. Jobs run from the test process, as the worker would.
 */

test.skip(!E2E_PREVIEWS, "Applications exist only while previews are on (E2E_PREVIEWS=0)");
const expect = baseExpect.configure({ timeout: 15_000 });
test.setTimeout(120_000);

const back = (page: Page) => page.locator("[data-shell-header='focused']").getByRole("link", { name: /^Back to / });
const step = (page: Page) => page.getByRole("navigation", { name: "Steps" });

/** The Orders portal fixture: an offline Vite app named @acme/orders-portal, described, with a develop branch, registered as +directory+'s name. */
function ordersPortal(db: Parameters<typeof registered>[0], directory: string) {
  const tree = offlineViteApp();
  const pkg = JSON.parse(tree["package.json"]!) as Record<string, unknown>;
  const repository = registered(db, directory, { ...tree, "package.json": manifest({ ...pkg, name: "@acme/orders-portal", description: "Order tracking for partners" }) });
  git(directory, ["branch", "develop"]);
  return repository;
}

test("From the Applications page: New application opens onboarding with no repository chosen, and its back button returns to Applications", async ({ page, db }) => {
  seeded(db, "Payments hub");
  await page.goto(paths.applications);
  await page.getByRole("link", { name: "New application" }).click();
  await expect(page).toHaveURL(/\/applications\/new$/);
  await expect(page).toHaveTitle("New application · Frontend Registry");
  await expect(pageTitle(page)).toHaveText("New application");
  await expect(step(page)).toContainText("Step 1 of 4");
  // A focused page: the sidebar is hidden, the menu still marks Applications.
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(back(page)).toHaveAccessibleName("Back to Applications");
  await back(page).click();
  await expect(page).toHaveURL(/\/applications$/);
  await expectCurrentItem(page, "Applications");
});

test("From a Repository: Create application opens onboarding with it chosen, and its back button returns to the Repository's page", async ({ page, db, sourcesDir }) => {
  const repository = ordersPortal(db, path.join(sourcesDir, "spa-orders"));
  await page.goto(paths.repository(repository.publicId));
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Create application" }).or(page.getByRole("link", { name: "Create application" })).click();
  await expect(page).toHaveURL(new RegExp(`/applications/new\\?repository=${repository.publicId}&from=repository$`));
  await expect(step(page)).toContainText("Step 2 of 4");
  await expect(page.getByText("Repository spa-orders")).toBeVisible();
  await expect(back(page)).toHaveAccessibleName("Back to spa-orders");
  await back(page).click();
  await expect(page).toHaveURL(new RegExp(`/repositories/${repository.publicId}$`));
});

test("The repository step: search the catalog, add a new clone URL, reuse a known one, and show the catalog's reason for a rejected one", async ({ page, db, sourcesDir }) => {
  const existing = ordersPortal(db, path.join(sourcesDir, "spa-orders"));
  await page.goto(paths.newApplication());
  const search = page.getByRole("searchbox", { name: "Search Repositories" });
  await search.fill("orders");
  await search.press("Enter");
  await expect(page.getByRole("list", { name: "Matching Repositories" })).toContainText("spa-orders");
  await page.getByRole("link", { name: "Choose spa-orders" }).click();
  await expect(page).toHaveURL(new RegExp(`repository=${existing.publicId}`));

  // A rejected URL shows the catalog's reason and doesn't continue.
  await page.goto(paths.newApplication());
  const url = page.getByRole("textbox", { name: "Clone URL" });
  await url.fill("https://user:secret@git.example.com/acme/orders.git");
  await page.getByRole("button", { name: "Use this clone URL" }).click();
  await expect(page.getByText("HTTPS clone URLs cannot contain a username, password, or access token; configure a credential helper instead")).toBeVisible();
  await expect(page).toHaveURL(/\/applications\/new$/);

  // A URL the catalog has, in another form, chooses that Repository rather than registering another.
  const count = () => db.select().from(repositories).all().length;
  const before = count();
  await url.fill(`file://${path.join(sourcesDir, "spa-orders")}/`);
  await page.getByRole("button", { name: "Use this clone URL" }).click();
  await expect(page).toHaveURL(new RegExp(`repository=${existing.publicId}`));
  expect(count()).toBe(before);

  // A new one is registered, and onboarding continues with it.
  const fresh = path.join(sourcesDir, "spa-admin");
  git(sourcesDir, ["init", "--quiet", "-b", "main", fresh]);
  git(fresh, ["commit", "--quiet", "--allow-empty", "-m", "initial"]);
  await page.goto(paths.newApplication());
  await page.getByRole("textbox", { name: "Clone URL" }).fill(`file://${fresh}`);
  await page.getByRole("button", { name: "Use this clone URL" }).click();
  await expect(step(page)).toContainText("Step 2 of 4");
  await expect(page.getByText("Repository spa-admin")).toBeVisible();
  expect(count()).toBe(before + 1);
});

test("An eligible app: the configured reference first, Checking… while the commit is surveyed, then the details prefilled from its manifest, and Create opens Applications with its card building", async ({ page, db, sourcesDir }) => {
  const repository = ordersPortal(db, path.join(sourcesDir, "spa-orders"));
  await page.goto(paths.newApplication({ repository: repository.publicId }));
  const branch = page.getByRole("combobox", { name: "Branch to track" });
  await expect(branch.locator("option")).toHaveText(["main", "develop"]);
  await expect(branch).toHaveValue("main");
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(step(page)).toContainText("Step 3 of 4");
  await expect(page.getByRole("status").filter({ hasText: "Checking…" })).toBeVisible();

  // The page shows the result without a reload when the survey and decision finish.
  await runJobs(db);
  await expect(step(page)).toContainText("Step 4 of 4");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Orders portal");
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue("Order tracking for partners");

  // Without the trust confirmation, nothing is created (Trust not confirmed).
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page.getByText("Confirm that you trust this repository's code. Creating the application builds and serves it.")).toBeVisible();
  await expect(page).toHaveURL(/\/applications\/new\?/);

  await page.getByRole("checkbox", { name: /I trust this repository's code/ }).check();
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page).toHaveURL(/\/applications\?notice=created&application=orders-portal$|\/applications$/);
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Orders portal was created.")).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: "Orders portal" });
  await expect(card).toContainText("Building");
  await expect(card.locator("[data-placeholder]")).toHaveCount(1);
});

test("Another branch is checked on that branch's commit", async ({ page, db, sourcesDir }) => {
  const directory = path.join(sourcesDir, "spa-orders");
  const repository = ordersPortal(db, directory);
  const develop = git(directory, ["rev-parse", "develop"]).trim();
  await page.goto(paths.newApplication({ repository: repository.publicId }));
  await page.getByRole("combobox", { name: "Branch to track" }).selectOption("develop");
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(page.getByText(`Branch develop at ${develop.slice(0, 7)}`)).toBeVisible();
});

test("A repository in another language: each failed condition is named, and no Create action appears (A repository in another language)", async ({ page, db, sourcesDir }) => {
  const repository = registered(db, path.join(sourcesDir, "ledger"), SCALA_SERVICE);
  await page.goto(paths.newApplication({ repository: repository.publicId }));
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Checking…" })).toBeVisible();
  await runJobs(db);
  await expect(page.getByText("ledger can't become an application")).toBeVisible();
  await expect(page.getByText(/Applications need a client-rendered single-page application whose build produces static files/)).toBeVisible();
  const conditions = page.getByRole("table", { name: "Why the branch can't become an application" });
  await expect(conditions).toContainText("browser framework");
  await expect(page.getByRole("button", { name: "Create application" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveCount(0);
});

test("A workspace: several packages to choose from, one that's already an application shown as taken with a link, and a duplicate name refused (Shell and remotes)", async ({ page, db }) => {
  const repository = insertRepository(db, { name: "orders-monorepo", cloneUrl: "https://git.example.com/acme/orders-monorepo.git", canonicalUrl: "https://git.example.com/acme/orders-monorepo", gitRef: null });
  seeded(db, "Orders portal");
  const preparation = decidedPreparation(db, repository, [qualifyingVerdict("apps/shell", { name: "@acme/shell" }), qualifyingVerdict("apps/admin", { name: "@acme/admin-remote" }), qualifyingVerdict("apps/billing", { name: "@acme/billing-remote" }), refusedVerdict("packages/bus")]);
  seeded(db, "Billing", { repository, packageDir: "apps/billing" });
  await page.goto(paths.newApplication({ repository: repository.publicId, branch: "main", preparation: preparation.publicId }));
  await expect(step(page)).toContainText("Step 3 of 4");
  const packages = page.getByRole("table", { name: "Packages that can be previewed" });
  await expect(packages.getByRole("row")).toHaveCount(4);
  await expect(packages.getByRole("row").filter({ hasText: "@acme/billing-remote" }).getByRole("link", { name: "Billing" })).toHaveAttribute("href", "/applications/billing");
  await expect(page.getByText(/One other package can't be previewed: ledger/)).toBeVisible();

  await packages.getByRole("link", { name: "Choose @acme/admin-remote" }).click();
  await expect(step(page)).toContainText("Step 4 of 4");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Admin remote");
  await page.getByRole("textbox", { name: "Name" }).fill("orders PORTAL");
  await page.getByRole("checkbox", { name: /I trust this repository's code/ }).check();
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page.getByText("Orders portal is already the name of an application. Choose another name.")).toBeVisible();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("every step works: search, choose, check, check again, and create", async ({ page, db, sourcesDir }) => {
    ordersPortal(db, path.join(sourcesDir, "spa-orders"));
    await page.goto(paths.newApplication());
    await page.getByRole("searchbox", { name: "Search Repositories" }).fill("spa-orders");
    await page.getByRole("searchbox", { name: "Search Repositories" }).press("Enter");
    await page.getByRole("link", { name: "Choose spa-orders" }).click();
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(page.getByText("Checking…")).toBeVisible();
    await runJobs(db);
    await page.getByRole("link", { name: "Check again" }).click();
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Orders portal");
    await page.getByRole("checkbox", { name: /I trust this repository's code/ }).check();
    await page.getByRole("button", { name: "Create application" }).click();
    await expect(page).toHaveURL(/\/applications\?notice=created&application=orders-portal$/);
    await expect(page.getByRole("article").filter({ hasText: "Orders portal" })).toContainText("Building");
  });
});
