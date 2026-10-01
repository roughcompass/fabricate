import { buildInitiative, buildSource } from "../test/support/builders";
import { expect, test } from "./support/fixtures";
import { paths } from "./support/paths";

// Addresses from before the interface vocabulary changed redirect permanently
// (operator-interface/page-patterns spec, "Every link opens the page it names").
// Redirects apply before routing, so these IDs only need the right shape.
const INITIATIVE = "ini_aaaaaaaaaaaaaaaa";
const ASSESSMENT = "asm_bbbbbbbbbbbbbbbb";
const SOURCE = "src_cccccccccccccccc";

/** The path and query a redirect's Location names. */
function target(location: string | undefined): string {
  const url = new URL(location ?? "", "http://localhost");
  return url.pathname + url.search;
}

const REDIRECTS: [from: string, to: string][] = [
  ["/initiatives/new", "/assessments/new"],
  [`/initiatives/${INITIATIVE}`, `/assessments/${INITIATIVE}`],
  [`/initiatives/${INITIATIVE}/edit`, `/assessments/${INITIATIVE}/edit`],
  [`/assessments/${ASSESSMENT}`, `/runs/${ASSESSMENT}`],
  [`/assessments/${ASSESSMENT}/map?view=nodes`, `/runs/${ASSESSMENT}/map?view=nodes`],
  [`/assessments/${ASSESSMENT}/evidence/ev_0123456789abcdef01234567`, `/runs/${ASSESSMENT}/evidence/ev_0123456789abcdef01234567`],
  ["/sources", "/repositories"],
  ["/sources/new", "/repositories/new"],
  ["/sources/import?directory=%2Fsrv", "/repositories/import?directory=%2Fsrv"],
  [`/sources/${SOURCE}/edit`, `/repositories/${SOURCE}/edit`],
];

for (const [from, to] of REDIRECTS) {
  test(`redirects ${from} permanently`, async ({ request }) => {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(target(response.headers().location)).toBe(to);
  });
}

test("redirects the create page's BitBucket import to the Applications import form", async ({ page, db: _db }) => {
  const response = await page.request.get("/new/import?project=PAY&repository=payee-hub", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location!, "http://localhost").pathname).toBe("/applications/import/PAY/payee-hub");
  await page.goto("/new/import?project=PAY&repository=payee-hub");
  await expect(page.getByRole("heading", { level: 1, name: "Import PAY/payee-hub" })).toBeVisible();
});

test("serves the new Assessment addresses without redirecting", async ({ request, db }) => {
  const initiative = buildInitiative(db, { name: "Redirect check", sources: [buildSource(db, { name: "redirect-check" })] });
  for (const path of [paths.assessments, paths.newAssessment, paths.assessment(initiative.publicId), paths.assessmentEdit(initiative.publicId)]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
});

test("sends the root address to the Assessments list", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(target(response.headers().location)).toBe(paths.assessments);
});
