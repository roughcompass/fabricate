import type { Page } from "@playwright/test";
import { visitorContext, waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** Two visitors' workspaces never mix (template-demo/demo-mode spec). */

async function comment(page: Page, path: string, anchor: string, text: string, name: string) {
  await page.goto(path);
  await waitForRegions(page);
  await page.keyboard.press("c");
  await page.locator(`[data-demo-anchor="${anchor}"]`).click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  if (await composer.getByLabel("Your name").count()) await composer.getByLabel("Your name").fill(name);
  await composer.getByLabel("Comment", { exact: true }).fill(text);
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByRole("dialog", { name: "New comment" })).toBeHidden();
}

async function pins(page: Page, path: string): Promise<number> {
  await page.goto(path);
  await waitForRegions(page);
  // Threads load after the regions; give them a moment before counting.
  await page.waitForLoadState("networkidle");
  return page.locator("[data-comment-pin]").count();
}

test("keeps two visitors' comments and resets apart", async ({ page, browser, baseURL, db }) => {
  test.setTimeout(180_000);
  const other = await visitorContext(browser, db, baseURL!);
  const second = await other.newPage();

  // Each visitor comments on a reference deployment.
  await comment(page, "/run/ref-market-watch", "order-symbol", "Alex on the reference deployment", "Alex");
  await comment(second, "/run/ref-payments-workspace", "send-payment", "Blake on the reference deployment", "Blake");

  // Comments on a reference deployment stay private to the workspace that wrote them.
  expect(await pins(page, "/run/ref-market-watch")).toBe(1);
  expect(await pins(second, "/run/ref-market-watch")).toBe(0);
  expect(await pins(second, "/run/ref-payments-workspace")).toBe(1);
  expect(await pins(page, "/run/ref-payments-workspace")).toBe(0);

  // One visitor's reset leaves the other's work alone.
  await page.goto("/templates");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("dialog", { name: "Reset the demo?" }).getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("The demo was reset.")).toBeVisible();
  expect(await pins(page, "/run/ref-market-watch")).toBe(0);
  expect(await pins(second, "/run/ref-payments-workspace")).toBe(1);
  await other.close();
});
