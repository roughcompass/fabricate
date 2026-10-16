import { type Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { generate, previewFrame, waitForAudit, waitForFrame } from "./support/prototypes";

// prototypes/learning and preview specs: ratings and element notes.

const INTENT = "Review and release today's urgent payments before cut-off";

async function keptPrototype(page: Page): Promise<string> {
  await generate(page, { intent: INTENT, personas: ["Maya Lindqvist"], variants: 1 });
  await page.getByRole("button", { name: "Keep" }).click();
  await page.getByRole("link", { name: "Exception-first queue" }).click();
  await page.waitForURL(/\/prototypes\/pro_[a-z0-9]{16}$/);
  return page.url();
}

test("replaces an earlier rating, and shows the rating beside the fit (Rating a version)", async ({ page, db: _db }) => {
  const prototype = await keptPrototype(page);
  await page.goto(`${prototype}?tab=feedback`);
  await page.getByRole("group", { name: "Rate this version" }).getByLabel("4").check();
  await page.getByRole("button", { name: "Save rating" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your rating was saved." })).toBeVisible();
  await expect(page.locator("[data-version-summary]")).toContainText("fit 4.3, rated 4 of 5");
  await page.getByRole("group", { name: "Your rating" }).getByLabel("2").check();
  await page.getByLabel("Note").fill("Too many columns; the approver only needs payee, amount, cut-off, and status");
  await page.getByRole("button", { name: "Replace rating" }).click();
  await expect(page.locator("[data-version-summary]")).toContainText("rated 2 of 5");
  await expect(page.locator("[data-feedback-kind=rating]")).toHaveCount(1);
  await expect(page.locator("[data-feedback-kind=rating]")).toContainText("Too many columns");
});

test("pins a note to the Approve button, which follows the button from Desktop to Tablet (Pinning a note; Pin follows resizing)", async ({ page, db: _db }) => {
  const prototype = await keptPrototype(page);
  await page.goto(prototype);
  await waitForFrame(page);
  await waitForAudit(page);
  await page.getByRole("button", { name: "Comment" }).click();
  const frame = previewFrame(page);
  const approve = frame.getByRole("button", { name: "Approve" }).first();
  // A dispatched click: at the desktop width the frame is scaled down, so a pointer click can't reach every element.
  await approve.dispatchEvent("click");
  await expect(page.locator("[data-note-target]")).toHaveText(/^Note on the Button “approve”$/i);
  await page.getByLabel("Note", { exact: true }).fill("Needs a confirm step for amounts over 1m");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("list", { name: "Open notes" })).toContainText("Needs a confirm step for amounts over 1m (Button)");

  const pin = frame.locator(".prototypeHost-pin");
  await expect(pin).toHaveText("1");
  const near = async () => {
    const [pinBox, buttonBox] = [await pin.boundingBox(), await approve.boundingBox()];
    return Math.abs(pinBox!.x + pinBox!.width / 2 - (buttonBox!.x + buttonBox!.width)) < 20 && Math.abs(pinBox!.y + pinBox!.height / 2 - buttonBox!.y) < 20;
  };
  await expect.poll(near).toBe(true);
  await page.getByRole("group", { name: "Device" }).getByRole("button", { name: "Tablet" }).click();
  await expect(page).toHaveURL(/device=tablet/);
  await expect.poll(near).toBe(true);
});

test("marks a note addressed when a refinement on the version addresses it (Note addressed by a refinement)", async ({ page, db: _db }) => {
  const prototype = await keptPrototype(page);
  await page.goto(prototype);
  await waitForFrame(page);
  await waitForAudit(page);
  await page.getByRole("button", { name: "Comment" }).click();
  await previewFrame(page).getByRole("button", { name: "Approve" }).first().dispatchEvent("click");
  await page.getByLabel("Note", { exact: true }).fill("Needs a confirm step for amounts over 1m");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("list", { name: "Open notes" })).toBeVisible();
  await page.getByLabel("Ask for a change").fill("Add the confirmation step the note asks for");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("[data-version-chip='2']")).toBeVisible({ timeout: 30_000 });
  await page.goto(`${prototype}?v=1&tab=feedback`);
  const note = page.locator("[data-feedback-kind=note]");
  await expect(note).toContainText("Addressed");
  await expect(note).toContainText("Addressed in v2");
  await note.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.locator("[data-feedback-kind=note]")).toContainText("Resolved");
});
