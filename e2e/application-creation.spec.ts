import type { Page } from "@playwright/test";
import { applications } from "../src/lib/db/schema";
import { registerApplication } from "../test/support/applications";
import { onboardPortal } from "../test/support/onboarding";
import { expect, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

// web-onboarding/application-creation spec: Add application, the full
// catalog, and Create Application. The demo-off cases are in e2e/demo-off/.

const prompt = (page: Page) => page.getByLabel("Paste a Bitbucket or GitHub repository URL, or describe what you want to build");
const starters = (page: Page) => page.getByRole("list", { name: "Starters" }).getByRole("listitem");
const catalog = (page: Page) => page.getByRole("list", { name: "Starters and templates" }).getByRole("listitem");
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const portal = (page: Page) => page.getByRole("combobox", { name: "Portal", exact: true });

async function submitPrompt(page: Page, text: string) {
  await prompt(page).fill(text);
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Fills every field of Create Application but the ones +except+ names. */
async function fill(page: Page, values: Partial<Record<"sealId" | "name" | "description" | "repositoryUrl", string>> = {}) {
  const { sealId = "88001", name = "Payee Hub", description = "Manages the payees of a payments desk.", repositoryUrl = "https://github.com/acme/payee-hub" } = values;
  await page.getByLabel("SEAL ID").fill(sealId);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Description").fill(description);
  await page.getByLabel("Repository URL").fill(repositoryUrl);
}

test.describe("Add application", () => {
  test("Opening it: a focused page with Let's build something new, the prompt bar, four starters, and Browse all", async ({ page, db: _db }) => {
    await page.goto("/applications");
    await page.locator("[data-page-header]").getByRole("link", { name: "Add application" }).click();
    await expect(page).toHaveURL(/\/applications\/new$/);
    await expect(page).toHaveTitle("Let's build something new · DE FabLab");
    await expect(heading(page)).toHaveText("Let's build something new");
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(starters(page)).toHaveCount(4);
    await expect(page.getByRole("link", { name: "Browse all" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Applications" }).click();
    await expect(page).toHaveURL(/\/applications$/);
  });

  test("A GitHub URL opens Create with it filled in; a GitLab URL is refused at the prompt", async ({ page, db: _db }) => {
    await page.goto("/applications/new");
    await waitForHydration(page);
    await submitPrompt(page, "https://gitlab.com/acme/payee-hub");
    await expect(page.getByText("Only Bitbucket and GitHub repository URLs are accepted")).toBeVisible();
    await expect(prompt(page)).toHaveValue("https://gitlab.com/acme/payee-hub");
    await expect(page).toHaveURL(/\/applications\/new$/);

    await submitPrompt(page, "https://github.com/acme/payee-hub.git");
    await expect(page).toHaveURL(/\/applications\/new\/create\?repo=/);
    await expect(page.getByLabel("Repository URL")).toHaveValue("https://github.com/acme/payee-hub");
    await expect(page.getByText("GitHub", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to Let's build something new" }).click();
    await expect(page).toHaveURL(/\/applications\/new$/);
  });

  test("A description opens the catalog searched for it", async ({ page, db: _db }) => {
    await page.goto("/applications/new");
    await waitForHydration(page);
    await submitPrompt(page, "dashboard");
    await expect(page).toHaveURL(/\/applications\/new\/templates\?q=dashboard$/);
    await expect(page.getByRole("searchbox", { name: "Search starters and templates" })).toHaveValue("dashboard");
    await expect(catalog(page).first()).toContainText("Salt Dashboard");
  });

  test("The Kind filter: Agent leaves only Agent Starter, kept in the address, and an empty kind says so", async ({ page, db: _db }) => {
    await page.goto("/applications/new");
    await waitForHydration(page);
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("checkbox", { name: /^Agent/ }).check();
    await expect(page).toHaveURL(/kind=agent/);
    await expect(starters(page)).toHaveText([/Agent Starter/]);
    await page.goto("/applications/new?kind=agent&kind=dashboard");
    await expect(starters(page)).toHaveCount(2);
  });

  test.describe("at 375px", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("The starter cards stack in one column", async ({ page, db: _db }) => {
      await page.goto("/applications/new");
      const [first, second] = [(await starters(page).nth(0).boundingBox())!, (await starters(page).nth(1).boundingBox())!];
      expect(second.y).toBeGreaterThan(first.y + first.height - 1);
      expect(Math.abs(second.x - first.x)).toBeLessThan(1);
    });
  });

  test("Two columns at 1280px", async ({ page, db: _db }) => {
    await page.goto("/applications/new");
    const [first, second] = [(await starters(page).nth(0).boundingBox())!, (await starters(page).nth(1).boundingBox())!];
    expect(Math.abs(second.y - first.y)).toBeLessThan(1);
    expect(second.x).toBeGreaterThan(first.x);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("The sidebar is hidden from the first paint, and the prompt bar opens Create", async ({ page, db: _db }) => {
      await page.goto("/applications/new");
      await expect(page.locator("#sidebar")).toBeHidden();
      await submitPrompt(page, "https://github.com/acme/payee-hub");
      await expect(page).toHaveURL(/\/applications\/new\/create\?repo=/);
      await expect(page.getByLabel("Repository URL")).toHaveValue("https://github.com/acme/payee-hub");
    });
  });
});

test.describe("the full catalog", () => {
  test("Starters first, then the Salt Patterns templates; choosing Market watch opens Create with it chosen", async ({ page, db: _db }) => {
    await page.goto("/applications/new");
    await page.getByRole("link", { name: "Browse all" }).click();
    await expect(page).toHaveURL(/\/applications\/new\/templates$/);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(catalog(page).nth(0)).toContainText("DE Web Boilerplate");
    await expect(catalog(page).nth(4)).not.toContainText("Starter");
    await page.getByRole("link", { name: "Market watch", exact: true }).click();
    await expect(page).toHaveURL(/\/applications\/new\/create\?starter=market-watch/);
    await expect(page.getByRole("heading", { name: "Start from the Market watch template" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open its reference deployment/ })).toHaveAttribute("href", "/run/ref-market-watch");
    await page.getByRole("link", { name: "Back to Choose a starter or template" }).click();
    await expect(page).toHaveURL(/\/applications\/new\/templates$/);
  });

  test("A search with no starter offers Generate prototypes, which opens New prototype with that intent", async ({ page, db: _db }) => {
    await page.goto("/applications/new/templates?q=payments%20approval%20queue");
    await page.getByRole("link", { name: "Generate prototypes" }).first().click();
    await expect(page).toHaveURL(/\/prototypes\/new\?intent=payments(\+|%20)approval(\+|%20)queue/);
  });
});

test.describe("Create Application", () => {
  test("A starter's panel: its numbered steps with copy buttons, and that DE FabLab doesn't create the repository", async ({ page, db: _db }) => {
    await page.goto("/applications/new");
    await page.getByRole("link", { name: /Agent Starter/ }).click();
    await expect(page).toHaveURL(/starter=agent-starter&from=new/);
    const steps = page.getByRole("list", { name: "Scaffold steps" }).getByRole("listitem");
    expect(await steps.count()).toBeGreaterThan(1);
    await expect(page.getByRole("button", { name: /^Copy step \d+'s command$/ }).first()).toBeAttached();
    await expect(page.getByText(/DE FabLab doesn't create repositories\./).filter({ visible: true })).toBeVisible();
  });

  test("Missing repository: focus moves to it and the other values stay", async ({ page, db }) => {
    onboardPortal(db, "Access");
    await page.goto("/applications/new/create");
    await waitForHydration(page);
    await fill(page, { repositoryUrl: "" });
    await portal(page).selectOption({ label: "Access · Prototype" });
    await page.getByRole("button", { name: "Create Application" }).click();
    await expect(page.getByText("Enter the repository's URL")).toBeVisible();
    await expect(page.getByLabel("Repository URL")).toBeFocused();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Payee Hub");
    await expect(page.getByLabel("SEAL ID")).toHaveValue("88001");
  });

  test("The slug follows the name until it's edited, and the heading follows the name", async ({ page, db: _db }) => {
    await page.goto("/applications/new/create");
    await waitForHydration(page);
    await page.getByLabel("Name", { exact: true }).fill("Payee Hub 2");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create Payee Hub 2");
    await expect(page.locator('input[type="hidden"][name="slug"]')).toHaveValue("payee-hub-2");
    await page.getByRole("button", { name: "Edit slug" }).click();
    const slug = page.getByLabel("Slug");
    await expect(slug).toBeFocused();
    await slug.fill("payees");
    await page.getByLabel("Name", { exact: true }).fill("Payee Hub 3");
    await expect(slug).toHaveValue("payees");
  });

  test("A taken slug and a repository in use: each error links to the Application that has it", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    const existing = registerApplication(db, { name: "Payee Hub", portal: access });
    await page.goto("/applications/new/create");
    await waitForHydration(page);
    await fill(page, { name: "Payee Hub", repositoryUrl: "https://github.com/acme/payee-hub" });
    await portal(page).selectOption({ label: "Access · Prototype" });
    await page.getByRole("button", { name: "Create Application" }).click();
    await expect(page.getByText("The slug payee-hub belongs to Payee Hub")).toBeVisible();
    await expect(page.getByText("Payee Hub already uses this repository")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Payee Hub" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Open Payee Hub" }).first()).toHaveAttribute("href", `/applications/${existing.publicId}`);
  });

  test("A URL with credentials is refused without showing the token again", async ({ page, db }) => {
    onboardPortal(db, "Access");
    await page.goto("/applications/new/create");
    await waitForHydration(page);
    await fill(page, { repositoryUrl: "https://x-token:ghp_secret123@github.com/acme/payee-hub.git" });
    await portal(page).selectOption({ label: "Access · Prototype" });
    await page.getByRole("button", { name: "Create Application" }).click();
    await expect(page.getByText(/must not include credentials/)).toBeVisible();
    await expect(page.getByLabel("Repository URL")).toHaveValue("");
    expect(await page.content()).not.toContain("ghp_secret123");
  });

  test("The current Portal is preselected, and each Portal shows its lifecycle", async ({ page, db, baseURL }) => {
    onboardPortal(db, "Access");
    const markets = onboardPortal(db, "Markets");
    await page.context().addCookies([{ name: "fabricate-portal", value: markets.publicId, url: baseURL! }]);
    await page.goto("/applications/new/create");
    await expect(portal(page)).toHaveValue(markets.publicId);
    await expect(portal(page).locator("option")).toHaveText(["Choose a Portal", "Access · Prototype", "Markets · Prototype"]);
  });

  test("With no Portals, the form offers Create Portal", async ({ page, db: _db }) => {
    await page.goto("/applications/new/create");
    await expect(page.getByRole("link", { name: "Create Portal" })).toHaveAttribute("href", "/portals/new");
  });

  test("Creating: the dashboard opens with its toast and the assessment in progress", async ({ page, db }) => {
    const access = onboardPortal(db, "Access");
    await page.goto("/applications/new");
    await page.getByRole("link", { name: /Salt Starter/ }).click();
    await waitForHydration(page);
    await fill(page);
    await portal(page).selectOption(access.publicId);
    await page.getByRole("button", { name: "Create Application" }).click();
    await expect(page).toHaveURL(/\/applications\/wap_[a-z0-9]+$/);
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Payee Hub was created.");
    await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Payee Hub");
    const overview = page.getByRole("region", { name: "Overview" });
    await expect(overview).toContainText("Queued");
    await expect(overview).toContainText("Salt Starter");
    await expect(overview).toContainText("Access");
    const created = db.select().from(applications).all();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Payee Hub", slug: "payee-hub", portalId: access.id, starter: "salt-starter" });
  });
});
