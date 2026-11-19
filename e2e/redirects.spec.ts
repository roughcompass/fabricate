import { buildInitiative, buildSource } from "../test/support/builders";
import { expect, test } from "./support/fixtures";
import { paths } from "./support/paths";

// Recently retired addresses redirect permanently, and addresses retired more
// than 30 days ago open the not-found page (operator-interface/page-patterns
// spec, "Links open the pages they name"). Redirects apply before routing, so
// these IDs only need the right shape.
const INITIATIVE = "ini_aaaaaaaaaaaaaaaa";
const SOURCE = "src_cccccccccccccccc";

/** The path and query a redirect's Location names. */
function target(location: string | undefined): string {
  const url = new URL(location ?? "", "http://localhost");
  return url.pathname + url.search;
}

const REDIRECTS: [from: string, to: string][] = [[`/repositories/${SOURCE}/edit`, `/repositories/${SOURCE}/settings`]];

for (const [from, to] of REDIRECTS) {
  test(`redirects ${from} permanently`, async ({ request }) => {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(target(response.headers().location)).toBe(to);
  });
}

test("Retired address: an Initiative address opens the not-found page without redirecting", async ({ request, page }) => {
  for (const address of [`/initiatives/${INITIATIVE}`, "/sources/new"]) {
    const response = await request.get(address, { maxRedirects: 0 });
    expect(response.status(), address).toBe(404);
    expect(response.headers().location, address).toBeUndefined();
  }
  await page.goto(`/initiatives/${INITIATIVE}`);
  await expect(page.getByText("This page does not exist", { exact: false })).toBeVisible();
});

test("serves the new Assessment addresses without redirecting", async ({ request, db }) => {
  const initiative = buildInitiative(db, { name: "Redirect check", sources: [buildSource(db, { name: "redirect-check" })] });
  for (const path of [paths.assessments, paths.newAssessment, paths.assessment(initiative.publicId), paths.assessmentEdit(initiative.publicId)]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
});

test("Root address: opens Home without redirecting to the Assessments list", async ({ request, page, db: _db }) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers().location).toBeUndefined();
  await page.goto(paths.home);
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle("Home · Frontend Registry");
  await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Home");
});
