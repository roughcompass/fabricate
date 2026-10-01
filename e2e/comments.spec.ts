import type { Page } from "@playwright/test";
import { waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** Comments anchored to rendered elements (template-demo/toolbar spec). */

const pin = (page: Page, number: number) => page.locator(`[data-comment-pin="${number}"]`);
const panel = (page: Page) => page.getByRole("dialog", { name: "Comments" });

async function comment(page: Page, anchor: string, text: string, name?: string) {
  await page.keyboard.press("c");
  await expect(page.getByText("Choose any element to comment on it. Press Esc to cancel.")).toBeVisible();
  await page.locator(`[data-demo-anchor="${anchor}"]`).click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  if (name) await composer.getByLabel("Your name").fill(name);
  await composer.getByLabel("Comment", { exact: true }).fill(text);
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(composer).toBeHidden();
}

test.beforeEach(async ({ page, db: _db }) => {
  await page.goto("/run/ref-payments-workspace");
  await waitForRegions(page);
});

test("comments on the Send payment button, asking for a name the first time", async ({ page }) => {
  await comment(page, "send-payment", "Make this primary", "Sam Rivera");
  await expect(pin(page, 1)).toBeVisible();
  await expect(pin(page, 1)).toHaveAccessibleName("Comment 1 by Sam Rivera: Make this primary");
  await expect(page.getByRole("button", { name: "Open comments" })).toContainText("1");
  const thread = page.getByRole("dialog", { name: "Comment 1" });
  await expect(thread).toContainText("Sam Rivera");
  await expect(thread).toContainText("Make this primary");

  // The name is remembered for the next comment.
  await thread.getByRole("button", { name: "Close comment" }).click();
  await page.keyboard.press("c");
  await page.locator('[data-demo-anchor="transfer-amount"]').click();
  await expect(page.getByRole("dialog", { name: "New comment" }).getByLabel("Your name")).toHaveCount(0);
});

test("keeps the pin on its button when the layout changes", async ({ page }) => {
  await comment(page, "send-payment", "Watch this button", "Sam Rivera");
  const inside = async () => {
    const button = (await page.locator('[data-demo-anchor="send-payment"]').boundingBox())!;
    const marker = (await pin(page, 1).boundingBox())!;
    const pointX = marker.x + 2;
    const pointY = marker.y + marker.height;
    return pointX >= button.x - 1 && pointX <= button.x + button.width + 1 && pointY >= button.y - 1 && pointY <= button.y + button.height + 1;
  };
  expect(await inside()).toBe(true);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(inside).toBe(true);
  await page.mouse.wheel(0, 200);
  await expect.poll(inside).toBe(true);
});

test("lists a comment on an older version as not visible, and goes to it", async ({ page }) => {
  await comment(page, "pay-lumen", "Wrong icon here", "Sam Rivera");
  await expect(pin(page, 1)).toBeVisible();

  await page.keyboard.press("m");
  const microfrontends = page.getByRole("dialog", { name: "Microfrontends" });
  await microfrontends.locator('[data-member="payee-list"]').click();
  await microfrontends.getByRole("radio", { name: /^2\.0\.0/ }).check();
  await microfrontends.getByRole("button", { name: "Reload preview" }).click();
  await expect(page.locator('[data-demo-mfe="payee-list"]')).toHaveAttribute("data-demo-version", "2.0.0");
  await expect(pin(page, 1)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open comments" }).click();
  await expect(panel(page)).toContainText("Not visible in this view · Payees · Payee list 1.4.2");
  await panel(page).getByRole("button", { name: "Go to comment" }).click();
  await expect(page.locator('[data-demo-mfe="payee-list"]')).toHaveAttribute("data-demo-version", "1.4.2");
  await expect(page.locator('[data-demo-mfe="payee-list"]')).toHaveAttribute("data-demo-state", "ready");
  await expect(pin(page, 1)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Comment 1" })).toBeVisible();
});

test("replies, resolves, and reopens a thread", async ({ page }) => {
  await comment(page, "send-payment", "Make this primary", "Sam Rivera");
  const thread = page.getByRole("dialog", { name: "Comment 1" });
  await thread.getByLabel("Reply").fill("Agreed, ship it");
  await thread.getByRole("button", { name: "Post reply" }).click();
  await expect(thread).toContainText("Agreed, ship it");

  await thread.getByRole("button", { name: "Resolve thread" }).click();
  await expect(pin(page, 1)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open comments" })).not.toContainText("1");

  await page.getByRole("button", { name: "Open comments" }).click();
  await expect(panel(page)).toContainText("0 open · 1 resolved");
  await panel(page).getByRole("button", { name: "Resolved (1)" }).click();
  await expect(panel(page)).toContainText("1 reply");
  await panel(page).getByRole("button", { name: "Reopen thread" }).click();
  await expect(panel(page)).toContainText("1 open · 0 resolved");
  await expect(pin(page, 1)).toBeVisible();
});

test("comments with the keyboard, and keeps comments after a reload", async ({ page }) => {
  await page.keyboard.press("c");
  await page.locator('[data-demo-mfe="transfer-form"]').getByLabel("Amount (USD)").focus();
  await page.keyboard.press("Enter");
  const composer = page.getByRole("dialog", { name: "New comment" });
  await expect(composer).toBeVisible();
  await composer.getByLabel("Your name").fill("Robin");
  await composer.getByLabel("Comment", { exact: true }).fill("Default the amount");
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(pin(page, 1)).toBeVisible();

  await page.reload();
  await waitForRegions(page);
  await expect(pin(page, 1)).toBeVisible();
});
