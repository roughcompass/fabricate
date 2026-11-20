import type { Page } from "@playwright/test";
import { withOverrides } from "../../src/lib/config";
import { insertRepository } from "../../src/lib/repositories/repository-records";
import { onboard } from "../../test/support/applications";
import { expect, test } from "../support/fixtures";
import { paths } from "../support/paths";
import { serverConfig } from "../support/results";

// applications/onboarding spec, "Applications are available while previews
// are", with previews off (npm run test:previews-off): the menu has no
// Applications item, and applications' pages, running applications, share
// links, and workspace endpoints answer not found. An application created
// while previews were on is kept, and shows nowhere.

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });

test("Previews off: the primary menu has no Applications item", async ({ page, db: _db }) => {
  await page.goto("/");
  await expect(primary(page).getByRole("link")).toHaveText(["Home", "Repositories", "All Assessments", "Standards", "Adoption", "System", "Bitbucket tokens"]);
  await expect(primary(page).getByRole("link", { name: "Applications", exact: true })).toHaveCount(0);
});

test("Previews off: an application's pages, its running application, its share link, and the old template addresses answer not found", async ({ page, db }) => {
  // Created as it was while previews were on; turning them off deletes nothing.
  const repository = insertRepository(db, { name: "spa-orders", cloneUrl: "https://git.example.com/acme/spa-orders.git", canonicalUrl: "https://git.example.com/acme/spa-orders", gitRef: null });
  const application = onboard(db, withOverrides(serverConfig(), { previews: { enabled: true } }), repository, { name: "Orders portal" });

  for (const address of [paths.applications, paths.newApplication(), paths.application(application.slug), `${paths.application(application.slug)}/preview`, `${paths.application(application.slug)}/settings`, paths.runningApplication(application.slug, "/accounts"), "/templates", "/templates/market-watch/preview"]) {
    const response = await page.goto(address);
    expect(response?.status(), address).toBe(404);
  }
  // A share link always redirects, so it never says whether it exists; with previews off it lands on the not-found page.
  const shared = await page.goto("/s/any-token");
  expect(shared?.status()).toBe(404);
  await expect(page).toHaveURL(/\/run\/unavailable$/);
});

test("Previews off: the workspace and application endpoints answer not found", async ({ request, db: _db }) => {
  for (const address of ["/api/workspace/threads?application=orders-portal", "/api/applications/status?ids=app_x", "/api/applications/eligibility"]) {
    const response = await request.get(address);
    expect(response.status(), `GET ${address}`).toBe(404);
  }
  for (const address of ["/api/workspace/threads?application=orders-portal", "/api/workspace/shares?application=orders-portal", "/api/workspace/hints"]) {
    const response = await request.post(address, { data: {} });
    expect(response.status(), `POST ${address}`).toBe(404);
  }
});

test("Previews off: a Repository offers no Create application, and the marketing page doesn't claim Applications", async ({ page, db }) => {
  const repository = insertRepository(db, { name: "spa-orders", cloneUrl: "https://git.example.com/acme/spa-orders.git", canonicalUrl: "https://git.example.com/acme/spa-orders", gitRef: null });
  await page.goto(paths.repository(repository.publicId));
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByText("Re-profile", { exact: true })).toBeVisible();
  await expect(page.getByText("Create application", { exact: true })).toHaveCount(0);

  await page.goto("/about");
  const benefits = page.getByRole("region", { name: "Register once, and everyone who depends on your app gets an answer" });
  await expect(benefits.locator("dt")).toHaveText(["App owners", "Product managers", "Design-system teams", "Platform teams"]);
  await expect(page.getByText("Reviewers", { exact: true })).toHaveCount(0);
});
