import type { Page } from "@playwright/test";
import { createRequire } from "node:module";
import { expectToolbarOnTop, openTool, startComment, waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";
import { useTheme } from "./support/shell";

/** Comments anchored to rendered elements (template-demo/toolbar spec). */

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const pin = (page: Page, number: number) => page.locator(`[data-comment-pin="${number}"]`);
const panel = (page: Page) => page.getByRole("dialog", { name: "Comments" });
const menuButton = (page: Page) => page.getByRole("button", { name: /^Open toolbar menu/ });

async function comment(page: Page, anchor: string, text: string, name?: string) {
  await startComment(page);
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
  await expect(menuButton(page)).toHaveAccessibleName("Open toolbar menu, 1 open comment");
  await expect(menuButton(page)).toContainText("1");
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

  await openTool(page, "comments");
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
  await expect(menuButton(page)).toHaveAccessibleName("Open toolbar menu");

  await openTool(page, "comments");
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

test.describe("the composer", () => {
  const composer = (page: Page) => page.getByRole("dialog", { name: "New comment" });
  const field = (page: Page) => composer(page).getByLabel("Comment", { exact: true });

  test("marks the chosen point, invites a new thread, and sends only something written", async ({ page }) => {
    await startComment(page);
    await page.locator('[data-demo-anchor="send-payment"]').click();
    await expect(page.locator("[data-comment-draft-pin]")).toBeVisible();
    await expect(field(page)).toHaveAttribute("placeholder", "Start a new thread…");
    // The first comment asks for a name, so focus starts there.
    await expect(composer(page).getByLabel("Your name")).toBeFocused();
    const send = composer(page).getByRole("button", { name: "Post comment" });
    await expect(send).toBeDisabled();
    await composer(page).getByLabel("Your name").fill("Sam Rivera");
    await field(page).fill("   ");
    await expect(send).toBeDisabled();
    await field(page).fill("Make this primary");
    await expect(send).toBeEnabled();
    // Cmd+Enter or Ctrl+Enter posts.
    await field(page).press("ControlOrMeta+Enter");
    await expect(composer(page)).toBeHidden();
    await expect(page.locator("[data-comment-draft-pin]")).toHaveCount(0);
    await expect(pin(page, 1)).toBeVisible();
  });

  test("formats the selected word, storing the marker and showing the style", async ({ page }) => {
    await startComment(page);
    await page.locator('[data-demo-anchor="send-payment"]').click();
    await composer(page).getByLabel("Your name").fill("Sam Rivera");
    await field(page).fill("Make this primary");
    await field(page).evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(10, 17));
    const toggle = composer(page).getByRole("button", { name: "Formatting" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const bar = composer(page).getByRole("group", { name: "Formatting" });
    for (const name of ["Bold", "Italic", "Strikethrough", "Code"]) await expect(bar.getByRole("button", { name })).toBeVisible();
    await bar.getByRole("button", { name: "Bold" }).click();
    await expect(field(page)).toHaveValue("Make this **primary**");
    // The selection stays on the word, so pressing Bold again takes the markers off, and once more puts them back.
    await bar.getByRole("button", { name: "Bold" }).click();
    await expect(field(page)).toHaveValue("Make this primary");
    await bar.getByRole("button", { name: "Bold" }).click();
    await composer(page).getByRole("button", { name: "Post comment" }).click();

    const thread = page.getByRole("dialog", { name: "Comment 1" });
    await expect(thread.locator("strong", { hasText: "primary" })).toBeVisible();
    await expect(thread).not.toContainText("**");
    const stored = await page.evaluate(async () => (await (await fetch(`/api/demo/threads?application=ref-payments-workspace`)).json()) as { threads: { comments: { body: string }[] }[] });
    expect(stored.threads[0]!.comments[0]!.body).toBe("Make this **primary**");
  });

  test("shows markup literally, creating no element or script", async ({ page }) => {
    await page.evaluate(() => ((window as unknown as { __alerted: boolean }).__alerted = false));
    page.on("dialog", (dialog) => void dialog.dismiss());
    await startComment(page);
    await page.locator('[data-demo-anchor="send-payment"]').click();
    await composer(page).getByLabel("Your name").fill("Sam Rivera");
    await field(page).fill("<img src=x onerror=alert(1)>");
    await composer(page).getByRole("button", { name: "Post comment" }).click();
    const thread = page.getByRole("dialog", { name: "Comment 1" });
    await expect(thread).toContainText("<img src=x onerror=alert(1)>");
    await expect(thread.locator("img")).toHaveCount(0);
    await page.reload();
    await waitForRegions(page);
    await pin(page, 1).click();
    await expect(page.getByRole("dialog", { name: "Comment 1" })).toContainText("<img src=x onerror=alert(1)>");
    await expect(page.locator('[data-thread-popover] img, [data-comment-pin] img')).toHaveCount(0);
  });

  test("opens to the left of the pill for an element beside it, without covering it", async ({ page }) => {
    // Dock the Send payment button to the right edge, level with the pill.
    await page.addStyleTag({ content: '[data-demo-anchor="send-payment"] { position: fixed !important; top: calc(50% - 20px) !important; right: 4px !important; z-index: 1 !important; }' });
    await startComment(page);
    const target = page.locator('[data-demo-anchor="send-payment"]');
    const box = (await target.boundingBox())!;
    // The middle of its left part, which is clear of the pill.
    await page.mouse.click(box.x + 6, box.y + box.height / 2);
    await expect(composer(page)).toBeVisible();
    const pill = (await page.getByRole("complementary", { name: "Toolbar", exact: true }).boundingBox())!;
    await expect.poll(async () => (await composer(page).boundingBox())!.x + (await composer(page).boundingBox())!.width).toBeLessThanOrEqual(pill.x);
    await expectToolbarOnTop(page);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no accessibility violations while open, with the formatting bar, in the ${theme} operator theme`, async ({ page, context, baseURL }) => {
      await useTheme(context, theme, baseURL!);
      await page.reload();
      await waitForRegions(page);
      await startComment(page);
      await page.locator('[data-demo-anchor="send-payment"]').click();
      await composer(page).getByRole("button", { name: "Formatting" }).click();
      if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: AXE });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
        const result = await axe.run({ include: [['[aria-label="New comment"]']] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
        return result.violations.map((violation) => violation.id);
      });
      expect(violations).toEqual([]);
    });
  }
});
