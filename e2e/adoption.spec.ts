import { takeSnapshots } from "../src/lib/adoption/snapshots";
import { storeEntry } from "../src/lib/catalog/entries";
import type { Db } from "../src/lib/db/client";
import { buildRepository } from "../test/support/builders";
import { saltEntry } from "../test/support/catalog";
import { manifest } from "../test/support/profiles";
import { seedSurvey } from "../test/support/scenarios";
import { expect, test } from "./support/fixtures";
import { serverConfig } from "./support/results";
import { expectCurrentItem, pageHeader, pageTitle } from "./support/shell";

// adoption-analytics spec, and page-templates' Dashboard, Analysis, and Details hub.

const lockfile = (name: string, versions: Record<string, string>) =>
  JSON.stringify({ name, lockfileVersion: 3, packages: { "": { name }, ...Object.fromEntries(Object.entries(versions).map(([dependency, version]) => [`node_modules/${dependency}`, { version }])) } });

const WEB = {
  "package.json": manifest({ name: "web", version: "1.0.0", dependencies: { "@salt-ds/core": "1.75.0", "@salt-ds/theme": "1.48.0" } }),
  "src/App.tsx": 'import { Button } from "@salt-ds/core";\nexport const App = () => (\n  <main>\n    <Button appearance="solid">Save</Button>\n    <Button appearance="bordered" className="wide">Cancel</Button>\n    <button>Raw</button>\n  </main>\n);\n',
  "src/App.module.css": ".wide { padding: var(--salt-spacing-300); color: #0a6; }\n",
  "src/Button.stories.tsx": 'import { Button } from "@salt-ds/core";\nexport const Primary = () => <Button appearance="solid">Story</Button>;\n',
};

const ORDERS = {
  "package.json": manifest({ name: "orders", version: "1.0.0", dependencies: { "@salt-ds/core": "^1.75.0" } }),
  "package-lock.json": lockfile("orders", { "@salt-ds/core": "1.75.0" }),
  "src/Orders.tsx": 'import { Button, Text } from "@salt-ds/core";\nexport const Orders = () => (\n  <section>\n    <Text>Orders</Text>\n    <Button appearance="solid">Pay</Button>\n    <button>Refund</button>\n    <button>Void</button>\n  </section>\n);\n',
};

const PLAIN = {
  "package.json": manifest({ name: "plain", version: "1.0.0", dependencies: { react: "19.3.1" } }),
  "src/App.tsx": "export const App = () => <button>Go</button>;\n",
};

/** Salt's entry, three profiled Repositories, and one not yet profiled. */
async function seedFleet(db: Db) {
  storeEntry(db, saltEntry());
  await seedSurvey(db, buildRepository(db, { name: "web" }), { files: WEB });
  await seedSurvey(db, buildRepository(db, { name: "orders" }), { files: ORDERS });
  await seedSurvey(db, buildRepository(db, { name: "plain" }), { files: PLAIN });
  buildRepository(db, { name: "unprofiled" });
}

const figure = (scope: ReturnType<typeof pageHeader> | import("@playwright/test").Page, label: string) => scope.locator("dl[data-key-figures] > div").filter({ has: scope.getByText(label, { exact: true }) });

test("Adoption overview: covers the profiled Repositories, names the rest, and has a panel for each tracked design system and package", async ({ page, db }) => {
  await seedFleet(db);
  await page.goto("/adoption");
  await expect(page).toHaveTitle("Adoption · Frontend Registry");
  await expect(pageTitle(page)).toHaveText("Adoption");
  await expectCurrentItem(page, "Adoption");
  await expect(pageHeader(page)).toHaveAttribute("data-template", "dashboard");

  const alert = page.locator("#page-alerts");
  await expect(alert).toContainText("1 of 4 Repositories aren't covered");
  await expect(alert.getByRole("link", { name: "unprofiled" })).toBeVisible();
  await expect(figure(page, "Covered").locator("dd").first()).toHaveText("3");

  for (const panel of ["Salt", "@salt-ds/core", "@salt-ds/theme", "@salt-ds/icons"]) await expect(page.getByRole("region", { name: panel, exact: true })).toBeVisible();
  const salt = page.getByRole("region", { name: "Salt", exact: true });
  await expect(salt).toContainText("Repositories using it");
  await salt.getByRole("link", { name: "Salt adoption" }).click();
  await expect(page).toHaveURL(/\/adoption\/design-systems\/salt$/);
  await expect(pageTitle(page)).toHaveText("Salt");
});

test("Salt overview: components tracked and used, app usages, the most used charted, and a table whose rows open each component", async ({ page, db }) => {
  await seedFleet(db);
  await page.goto("/adoption/design-systems/salt");
  await expect(pageHeader(page)).toHaveAttribute("data-template", "analysis");
  await expectCurrentItem(page, "Adoption", "true");
  await expect(pageHeader(page).getByRole("navigation", { name: "Breadcrumb" }).getByRole("link")).toHaveText(["Adoption"]);
  await expect(pageHeader(page)).toContainText("Covers 3 of 4 Repositories");
  await expect(pageHeader(page)).toContainText("Salt 1.75.0 entry");
  // Salt's published data is a snapshot of its main branch, so the page says how old it is.
  await expect(pageHeader(page)).toContainText("Published data as of 2026-03-31");

  await expect(figure(page, "Components used").locator("dd").first()).toHaveText("2");
  await expect(figure(page, "Components used")).toContainText(`of ${saltEntry().content.components!.length} tracked`);
  await expect(figure(page, "Usages in app code").locator("dd").first()).toHaveText("4");
  await expect(figure(page, "Repositories using it").locator("dd").first()).toHaveText("2");
  await expect(page.getByRole("table", { name: "Usages of the most used Salt components" })).toBeAttached();

  const table = page.getByRole("table", { name: "Components" });
  await expect(table.locator("tbody tr").first()).toContainText("Button");
  await table.getByRole("link", { name: "Button", exact: true }).click();
  await expect(page).toHaveURL(/\/adoption\/design-systems\/salt\/components\/Button$/);
});

test("filters the components by usage and name, in the address, and clears them", async ({ page, db }) => {
  await seedFleet(db);
  await page.goto("/adoption/design-systems/salt?usage=unused");
  const table = page.getByRole("table", { name: "Components" });
  await expect(page.getByRole("status").filter({ hasText: "unused" })).toHaveText(/^Showing \d+ of \d+ components: unused$/);
  await expect(table.getByRole("link", { name: "Button", exact: true })).toHaveCount(0);
  await page.goto("/adoption/design-systems/salt?q=butt");
  await expect(table.locator("tbody tr td:first-child a")).toContainText(["Button"]);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/adoption\/design-systems\/salt$/);
});

test("Replaceable HTML: lists button with Salt's Button as its replacement, its usages, and the Salt Repositories that write it", async ({ page, db }) => {
  await seedFleet(db);
  await page.goto("/adoption/design-systems/salt");
  await page.getByRole("navigation", { name: "Salt views" }).getByRole("link", { name: "Replaceable HTML" }).click();
  const row = page.getByRole("table", { name: "Replaceable HTML" }).getByRole("row").filter({ hasText: "Button" }).first();
  await expect(row.locator("td").first()).toHaveText("button");
  // Counted in the Repositories that use Salt: orders writes two, web one; plain doesn't use Salt.
  await expect(row.locator("td").nth(2)).toHaveText("3");
  await expect(row).toContainText("2 Repositories");
  for (const name of ["orders", "web"]) await expect(row.getByRole("link", { name })).toBeVisible();
});

test("Button detail: the Repositories using it, the values of appearance, the props no usage passes, customization, and stories", async ({ page, db }) => {
  await seedFleet(db);
  await page.goto("/adoption/design-systems/salt/components/Button");
  await expect(page).toHaveTitle("Button · Salt · Adoption · Frontend Registry");
  await expect(pageHeader(page)).toHaveAttribute("data-template", "details");
  await expectCurrentItem(page, "Adoption", "true");
  await expect(pageHeader(page).getByRole("navigation", { name: "Breadcrumb" }).getByRole("link")).toHaveText(["Adoption", "Salt"]);

  const appearance = page.getByRole("table", { name: "Props" }).getByRole("row").filter({ hasText: "appearance" });
  await expect(appearance).toContainText("3");
  await expect(appearance).toContainText("solid");
  await expect(appearance).toContainText("bordered");
  await expect(page.getByRole("region", { name: "Props no usage passes" }).getByText("disabled", { exact: true })).toBeVisible();
  await expect(figure(page, "Customized")).toContainText("1 of 3 app usages");
  await expect(page.getByRole("region", { name: "Stories" }).getByRole("link", { name: "web" })).toBeVisible();

  // The hub previews the Repositories using it and opens them all in their own view.
  const used = page.getByRole("region", { name: "Used by" });
  await expect(used.getByRole("link", { name: "orders" })).toBeVisible();
  await page.getByRole("navigation", { name: "Button views" }).getByRole("link", { name: /Repositories/ }).click();
  await expect(page.getByRole("table", { name: "Repositories using Button" }).locator("tbody tr")).toHaveCount(2);
});

test("Salt core versions: the versions Repositories resolve, with how many are on each, and those without a lockfile resolving it", async ({ page, db }) => {
  await seedFleet(db);
  await page.goto("/adoption/packages/@salt-ds/core");
  await expect(pageTitle(page)).toHaveText("@salt-ds/core");
  await expect(pageHeader(page)).toHaveAttribute("data-template", "analysis");
  await expect(page.locator("#page-alerts")).toContainText("1 Repository declares it without a lockfile resolving it");
  await expect(page.locator("#page-alerts").getByRole("link", { name: "web" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Repositories on each version of @salt-ds/core" })).toContainText("1.75.0 (newest)");
  const repositories = page.getByRole("table", { name: "Repositories declaring @salt-ds/core" });
  await expect(repositories.getByRole("row").filter({ hasText: "orders" })).toContainText("^1.75.0");
  await expect(repositories.getByRole("row").filter({ hasText: "web" })).toContainText("No lockfile resolves it");
});

test("Weekly change: each figure shows its change since the previous snapshot, and any two snapshots compare", async ({ page, db }) => {
  await seedFleet(db);
  const config = serverConfig();
  takeSnapshots(db, config, "2026-11-12T00:00:00.000Z", new Date("2026-11-12T00:00:00.000Z"));
  await seedSurvey(db, buildRepository(db, { name: "billing" }), { files: { ...ORDERS, "package.json": manifest({ name: "billing", version: "1.0.0", dependencies: { "@salt-ds/core": "^1.75.0" } }) } });
  takeSnapshots(db, config, "2026-11-19T00:00:00.000Z", new Date("2026-11-19T00:00:00.000Z"));

  await page.goto("/adoption/design-systems/salt");
  await expect(figure(page, "Repositories using it")).toContainText("+1 since the Nov 12 snapshot");
  await page.getByRole("navigation", { name: "Salt views" }).getByRole("link", { name: "Snapshots" }).click();
  const comparison = page.getByRole("table", { name: "Snapshot comparison" });
  await expect(comparison.getByRole("row").filter({ hasText: "Repositories using it" })).toContainText("+1");
});

test("an unknown design system or component is not found", async ({ page, db }) => {
  await seedFleet(db);
  for (const address of ["/adoption/design-systems/carbon", "/adoption/design-systems/salt/components/NoSuchThing"]) {
    expect((await page.goto(address))!.status(), address).toBe(404);
    await expect(page.getByRole("link", { name: "Go to Adoption" })).toHaveAttribute("href", "/adoption");
  }
});
