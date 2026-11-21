import type { Page } from "@playwright/test";
import { withOverrides } from "../../src/lib/config";
import { insertRepository } from "../../src/lib/repositories/repository-records";
import { onboard } from "../../test/support/applications";
import { expect, test } from "../support/fixtures";
import { paths } from "../support/paths";
import { serverConfig } from "../support/results";
import { seedOperatorSurfaces } from "../support/surfaces";
import { createSet } from "../../src/lib/mocks/records";
import { routes } from "../../src/lib/web/routes";

// applications/onboarding spec, "Applications are available while previews
// are", with previews off (npm run test:previews-off): the menu has no
// Applications item, and applications' pages, running applications, share
// links, and workspace endpoints answer not found. An application created
// while previews were on is kept, and shows nowhere. Repositories,
// Assessments, Standards, and every other operator page work as before.

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

  // Saved previews' addresses too (restore-toolbar-tools-and-branch-previews, task 3.6).
  db.$client
    .prepare("insert into application_previews (public_id, application_id, key, ref, latest_commit_sha, latest_requested_at, created_at, updated_at) values ('apv_0000000000000001', ?, 'feature-new-nav', 'refs/heads/feature/new-nav', ?, 0, 0, 0)")
    .run(application.id, application.latestCommitSha);
  for (const address of [
    paths.applications,
    paths.newApplication(),
    paths.application(application.slug),
    `${paths.application(application.slug)}/preview`,
    paths.applicationPreview(application.slug, { preview: "feature-new-nav" }),
    `${paths.application(application.slug)}/settings`,
    paths.newApplicationPreview(application.slug),
    paths.runningApplication(application.slug, "/accounts"),
    paths.runningApplication(application.slug, "/accounts", undefined, "feature-new-nav"),
    paths.applicationScreenshot(application.slug, "v1", "full", "feature-new-nav"),
    "/templates",
    "/templates/market-watch/preview",
  ]) {
    const response = await page.goto(address);
    expect(response?.status(), address).toBe(404);
  }
  // A share link always redirects, so it never says whether it exists; with previews off it lands on the not-found page.
  const shared = await page.goto("/s/any-token");
  expect(shared?.status()).toBe(404);
  await expect(page).toHaveURL(/\/run\/unavailable$/);
});

test("Previews off: the workspace and application endpoints answer not found", async ({ request, db: _db }) => {
  for (const address of ["/api/workspace/threads?application=orders-portal", "/api/applications/status?ids=app_x", "/api/applications/status?ids=apv_0000000000000001", "/api/applications/eligibility"]) {
    const response = await request.get(address);
    expect(response.status(), `GET ${address}`).toBe(404);
  }
  for (const address of ["/api/workspace/threads?application=orders-portal", "/api/workspace/shares?application=orders-portal", "/api/workspace/hints"]) {
    const response = await request.post(address, { data: {} });
    expect(response.status(), `POST ${address}`).toBe(404);
  }
});

test("Previews off: the mock sets' endpoints answer not found (add-mock-sets, task 5.8)", async ({ request, db }) => {
  const repository = insertRepository(db, { name: "spa-orders", cloneUrl: "https://git.example.com/acme/spa-orders.git", canonicalUrl: "https://git.example.com/acme/spa-orders", gitRef: null });
  const application = onboard(db, withOverrides(serverConfig(), { previews: { enabled: true } }), repository, { name: "Orders portal" });
  const set = createSet(db, application.id, { name: "Happy path" }, null).publicId;
  const slug = application.slug;
  for (const address of [routes.mockSetsApi(slug), routes.compiledMockSet(slug, set, 1), routes.mockSetBody(slug, set, "a".repeat(64)), routes.mockSetHar(slug, set)]) {
    expect((await request.get(address)).status(), `GET ${address}`).toBe(404);
  }
  for (const address of [routes.mockSetsApi(slug), routes.mockRulesApi(slug, set), routes.mockSetImportsApi(slug)]) {
    expect((await request.post(address, { data: {} })).status(), `POST ${address}`).toBe(404);
  }
  expect((await request.put(routes.mockSetChoiceApi(slug), { data: { set: null } })).status()).toBe(404);
});

test("Previews off: the mock sets' pages answer not found (add-mock-sets, task 5.8)", async ({ page, db }) => {
  const repository = insertRepository(db, { name: "spa-orders", cloneUrl: "https://git.example.com/acme/spa-orders.git", canonicalUrl: "https://git.example.com/acme/spa-orders", gitRef: null });
  const application = onboard(db, withOverrides(serverConfig(), { previews: { enabled: true } }), repository, { name: "Orders portal" });
  const set = createSet(db, application.id, { name: "Happy path" }, null).publicId;
  const slug = application.slug;
  db.$client
    .prepare("insert into application_previews (public_id, application_id, key, ref, latest_commit_sha, latest_requested_at, created_at, updated_at) values ('apv_0000000000000002', ?, 'feature-new-nav', 'refs/heads/feature/new-nav', ?, 0, 0, 0)")
    .run(application.id, application.latestCommitSha);
  for (const address of [
    routes.mockSet(slug, set),
    routes.newMockSet(slug),
    routes.newMockSet(slug, { from: "failed-calls" }),
    routes.mockSetEdit(slug, set),
    routes.newMockRule(slug, set),
    routes.mockRule(slug, set, "mkr_0000000000000001"),
    routes.mockSetUpload(slug),
    routes.mockSetImport(slug, "mki_0000000000000001"),
    routes.savedPreviewMockSet(slug, "feature-new-nav"),
  ]) {
    expect((await page.goto(address))?.status(), address).toBe(404);
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

test("Previews off: Repositories, Assessments, Standards, and every other operator page work as before", async ({ page, db, sourcesDir }) => {
  const surfaces = (await seedOperatorSurfaces(db, sourcesDir)).filter(([name]) => name !== "09-not-found");
  expect(surfaces.map(([name]) => name)).toEqual(expect.arrayContaining(["03-repositories", "03-repository", "01-assessments", "02-assessment", "04-standards", "04-standard", "08-evaluation"]));
  for (const [name, url] of surfaces) {
    const response = await page.goto(url);
    expect(response?.status(), name).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first(), name).toBeAttached();
    await expect(primary(page).getByRole("link", { name: "Applications", exact: true }), name).toHaveCount(0);
  }
});
