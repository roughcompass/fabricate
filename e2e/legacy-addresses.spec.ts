import { onboardPortal } from "../test/support/onboarding";
import { expect, test } from "./support/fixtures";

// make-applications-first-class task 1.3: Web Onboarding's addresses, and the
// demo's create page and BitBucket import, redirect permanently to the pages
// that replaced them.

test("a bookmarked Portal page, and one of its Drafts, open its Navigation page", async ({ page, request, db }) => {
  const access = onboardPortal(db, "Access");
  const response = await request.get(`/onboarding/portals/${access.publicId}/draft/identity`, { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location!, "http://localhost").pathname).toBe(`/navigation/${access.publicId}`);
  await page.goto(`/onboarding/portals/${access.publicId}`);
  await expect(page).toHaveURL(new RegExp(`/navigation/${access.publicId}$`));
  await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Access");
});

test("an import form and the old create page open Add application", async ({ page, request, db: _db }) => {
  for (const address of ["/applications/import/PAY/payee-hub", "/new"]) {
    const response = await request.get(address, { maxRedirects: 0 });
    expect(response.status(), address).toBe(308);
    expect(new URL(response.headers().location!, "http://localhost").pathname, address).toBe("/applications/new");
  }
  await page.goto("/applications/import/PAY/payee-hub");
  await expect(page).toHaveURL(/\/applications\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "Let's build something new" })).toBeVisible();
});

test("the old catalogs open Applications across every Portal and the Navigation list", async ({ request, db: _db }) => {
  for (const [from, to] of [
    ["/onboarding", "/applications"],
    ["/onboarding/applications", "/applications?portal=all"],
    ["/onboarding/microfrontends", "/applications?portal=all"],
    ["/onboarding/reviews", "/navigation"],
  ]) {
    const response = await request.get(from!, { maxRedirects: 0 });
    expect(response.status(), from).toBe(308);
    const location = new URL(response.headers().location!, "http://localhost");
    expect(location.pathname + location.search, from).toBe(to);
  }
});
