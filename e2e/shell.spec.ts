import { expect, test } from "./support/fixtures";

test("renders the application shell with a skip link and current navigation", async ({ page, db: _db }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Initiatives · Fabricate");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
  await expect(page.getByRole("heading", { level: 1, name: "Initiatives" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(navigation.getByRole("link", { name: "Initiatives" })).toHaveAttribute("aria-current", "page");

  await navigation.getByRole("link", { name: "Sources" }).click();
  await expect(navigation.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "Initiatives" })).not.toHaveAttribute("aria-current", "page");
});
