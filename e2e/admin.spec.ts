import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });

const TOKEN = "BBDC-NzA2MzQ1NjYxMjM0OkxhYmNkZWZnaGlqa2xtbm9w";

test("saves a Bitbucket Server token, shows only its last four characters, and deletes it after confirming", async ({ page, db: _db }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/bitbucket-tokens$/);
  await expect(page.getByText("No Bitbucket tokens yet")).toBeVisible();

  await page.getByRole("link", { name: "Add token" }).first().click();
  await page.getByLabel("Server").fill("http://bitbucket.example.com");
  await page.getByLabel("Name").fill("Platform team");
  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Add token" }).click();
  // A refused submission keeps the server and name, never the token.
  await expect(page.getByText("The server must use https://")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Platform team");
  await expect(page.getByLabel("Token")).toHaveValue("");

  await page.getByLabel("Server").fill("https://bitbucket.example.com/bitbucket/");
  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Add token" }).click();
  await expect(page).toHaveURL(/\/admin\/bitbucket-tokens(\?|$)/);
  await expect(toasts(page).getByText("Platform team was saved.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Platform team" });
  await expect(row).toContainText("https://bitbucket.example.com/bitbucket");
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
