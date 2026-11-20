import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { generatePublicId } from "../src/lib/db/ids";
import { applications, commentThreads, threadComments } from "../src/lib/db/schema";
import { THREAD_LIMIT } from "../src/lib/workspaces/workspaces";
import type { Page } from "@playwright/test";
import { expectToolbarOnTop, openTool, startComment } from "./support/toolbar";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { removeSavedPreview } from "../src/lib/applications/saved-previews";
import { commitToOrdersPortal, rebuildOrdersPortal, saveOrdersPortalPreview } from "./support/fixture-app";
import { paths } from "./support/paths";
import { application, openBuild, runOrdersPortal, waitForPage, workspaceOf } from "./support/running-app";
import { useTheme } from "./support/shell";

/*
 * Comments on a running application's own elements (add-applications, task
 * 8.2; template-demo/toolbar spec, "Comments stay bound to their element,
 * route, and commit"), on the fixture application in its frame, kept in the
 * visitor's workspace and private to it until it shares a view.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(90_000);

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const pin = (page: Page, number: number) => page.locator(`[data-comment-pin="${number}"]`);
const panel = (page: Page) => page.getByRole("dialog", { name: "Comments" });
const menuButton = (page: Page) => page.getByRole("button", { name: /^Open toolbar menu/ });
const composer = (page: Page) => page.getByRole("dialog", { name: "New comment" });
const exportOrders = (page: Page) => application(page).getByRole("button", { name: "Export orders" });

async function comment(page: Page, element: ReturnType<typeof exportOrders>, text: string, name?: string) {
  await startComment(page);
  await element.click();
  if (name) await composer(page).getByLabel("Your name").fill(name);
  await composer(page).getByLabel("Comment", { exact: true }).fill(text);
  await composer(page).getByRole("button", { name: "Post comment" }).click();
  await expect(composer(page)).toBeHidden();
}

/** Whether pin +number+'s point is on +element+, where it was placed. */
async function pinnedTo(page: Page, number: number, element: ReturnType<typeof exportOrders>): Promise<boolean> {
  const box = (await element.boundingBox())!;
  const marker = (await pin(page, number).boundingBox())!;
  const x = marker.x + 2;
  const y = marker.y + marker.height;
  return x >= box.x - 1 && x <= box.x + box.width + 1 && y >= box.y - 1 && y <= box.y + box.height + 1;
}

test("comments on the Export orders button, asking for a name the first time, without the application seeing the click", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  await application(page).locator("body").evaluate(() => document.addEventListener("click", () => ((window as unknown as { clicks: number }).clicks = ((window as unknown as { clicks?: number }).clicks ?? 0) + 1)));
  await comment(page, exportOrders(page), "Make this primary", "Sam Rivera");
  expect(await application(page).locator("body").evaluate(() => (window as unknown as { clicks?: number }).clicks ?? 0)).toBe(0);
  await expect(pin(page, 1)).toBeVisible();
  await expect(pin(page, 1)).toHaveAccessibleName("Comment 1 by Sam Rivera: Make this primary");
  expect(await pinnedTo(page, 1, exportOrders(page))).toBe(true);
  await expect(menuButton(page)).toHaveAccessibleName("Open toolbar menu, 1 open comment");
  const thread = page.getByRole("dialog", { name: "Comment 1" });
  await expect(thread).toContainText("Sam Rivera");
  await expect(thread).toContainText("Make this primary");

  // The name is remembered for the next comment, which names its element and route.
  await thread.getByRole("button", { name: "Close comment" }).click();
  await page.keyboard.press("c");
  await application(page).getByRole("button", { name: "Recalculate totals" }).click();
  await expect(composer(page).getByLabel("Your name")).toHaveCount(0);
  await expect(composer(page)).toContainText('On button "Recalculate totals" at /accounts');
});

test("keeps the pin on its button when the layout changes and the application scrolls", async ({ page, db }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await runOrdersPortal(page, db, "/accounts/42");
  await comment(page, exportOrders(page), "Watch this button", "Sam Rivera");
  expect(await pinnedTo(page, 1, exportOrders(page))).toBe(true);
  await page.setViewportSize({ width: 900, height: 480 });
  await expect.poll(() => pinnedTo(page, 1, exportOrders(page))).toBe(true);
  await application(page).locator("body").evaluate(() => window.scrollBy(0, 60));
  await expect.poll(() => pinnedTo(page, 1, exportOrders(page))).toBe(true);
  // Scrolled out of the application's view, the pin isn't drawn over the page around it.
  await page.setViewportSize({ width: 900, height: 300 });
  await application(page).locator("body").evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(exportOrders(page)).not.toBeInViewport();
  await expect(pin(page, 1)).toHaveCount(0);
});

test("lists a comment on another route as not visible in this view, and goes to it", async ({ page, db }) => {
  const { preview } = await runOrdersPortal(page, db);
  await comment(page, exportOrders(page), "Wrong label here", "Sam Rivera");
  await expect(pin(page, 1)).toBeVisible();

  await page.keyboard.press("Escape");
  await application(page).getByRole("link", { name: "Settings" }).click();
  await waitForPage(page, "Settings");
  await expect(pin(page, 1)).toHaveCount(0);

  await openTool(page, "comments");
  const listed = panel(page).locator("[data-thread]");
  await expect(listed).toContainText(`Not visible in this view · /accounts · button "Export orders" · Commit ${preview.commitSha.slice(0, 12)}`);
  await panel(page).getByRole("button", { name: "Go to comment" }).click();
  await waitForPage(page, "Accounts");
  await expect(pin(page, 1)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Comment 1" })).toBeVisible();
  await openTool(page, "comments");
  await expect(listed).toHaveAttribute("data-visible", "true");
  await expect(listed).not.toContainText("Not visible in this view");
});

test("keeps a pin on a newer build that still renders its element, and lists one whose element is gone with the commit it was placed on", async ({ page, db }) => {
  const first = await runOrdersPortal(page, db);
  await comment(page, exportOrders(page), "Rename this", "Sam Rivera");
  await page.keyboard.press("Escape");
  await comment(page, application(page).getByRole("button", { name: "Recalculate totals" }), "Too slow");

  // The next commit renames Export orders, so the first thread's element is gone.
  const renamed = commitToOrdersPortal({ "src/accounts.jsx": (source) => source.replace("Export orders", "Download orders") }, { message: "Rename Export orders" });
  const second = await rebuildOrdersPortal(db, first.application);
  expect(second.preview.commitSha).toBe(renamed);
  expect(second.preview.publicId).not.toBe(first.preview.publicId);
  await openBuild(page, second);
  await expect(application(page).getByRole("button", { name: "Download orders" })).toBeVisible();

  await expect(pin(page, 1)).toHaveCount(0);
  await expect(pin(page, 2)).toBeVisible();
  expect(await pinnedTo(page, 2, application(page).getByRole("button", { name: "Recalculate totals" }))).toBe(true);
  await openTool(page, "comments");
  const gone = panel(page).locator("[data-thread]").filter({ hasText: "Rename this" });
  await expect(gone).toContainText(`Not visible in this view · /accounts · button "Export orders" · Commit ${first.preview.commitSha.slice(0, 12)}`);
  // It's on this route, so there's nowhere to go.
  await expect(gone.getByRole("button")).toHaveCount(0);
  await expect(panel(page).locator("[data-thread]").filter({ hasText: "Too slow" })).toHaveAttribute("data-visible", "true");
});

test.describe("comments on saved previews (restore-toolbar-tools-and-branch-previews, task 4.3)", () => {
  test("pins a comment only on the saved preview it was placed on, lists it elsewhere as not visible naming the branch, and goes to it (Comment on a saved preview)", async ({ page, db }) => {
    const { application: orders } = await runOrdersPortal(page, db);
    const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
    await page.goto(paths.runningApplication(orders.slug, "/accounts", undefined, feature.key));
    await waitForPage(page, "Accounts");
    await comment(page, exportOrders(page), "Is this still primary on the new navigation?", "Sam Rivera");
    await expect(pin(page, 1)).toBeVisible();
    await page.keyboard.press("Escape");

    // On the tracked branch, the same element has no pin, and the list names the preview.
    await page.goto(paths.runningApplication(orders.slug, "/accounts"));
    await waitForPage(page, "Accounts");
    await expect(pin(page, 1)).toHaveCount(0);
    await openTool(page, "comments");
    const item = panel(page).locator("[data-thread]").first();
    await expect(item).toContainText("Not visible in this view · On feature/new-nav · /accounts");
    await item.getByRole("button", { name: "Go to comment" }).click();
    await expect(page).toHaveURL(paths.runningApplication(orders.slug, "/accounts", undefined, feature.key));
    await waitForPage(page, "Accounts");
    await expect(pin(page, 1)).toBeVisible();
  });

  test("keeps a removed preview's comments listed, saying the preview was removed (Comment on a removed preview)", async ({ page, db }) => {
    const { application: orders } = await runOrdersPortal(page, db);
    const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
    await page.goto(paths.runningApplication(orders.slug, "/accounts", undefined, feature.key));
    await waitForPage(page, "Accounts");
    await comment(page, exportOrders(page), "Before merging", "Sam Rivera");
    await page.keyboard.press("Escape");
    removeSavedPreview(db, orders.publicId, feature.key);

    await page.goto(paths.runningApplication(orders.slug, "/accounts"));
    await waitForPage(page, "Accounts");
    await expect(pin(page, 1)).toHaveCount(0);
    await openTool(page, "comments");
    const item = panel(page).locator("[data-thread]").first();
    await expect(item).toContainText("Before merging");
    await expect(item).toContainText("Not visible in this view · On feature/new-nav, a saved preview since removed · /accounts");
    await expect(item.getByRole("button", { name: "Go to comment" })).toHaveCount(0);
  });
});

test("refuses a thread past the workspace's limit, saying how to make room (Thread limit)", async ({ page, context, db }) => {
  const { application: orders, preview } = await runOrdersPortal(page, db);
  await comment(page, exportOrders(page), "The first one", "Sam Rivera");
  const workspace = await workspaceOf(context, db);
  const now = new Date();
  db.insert(commentThreads)
    .values(Array.from({ length: THREAD_LIMIT - 1 }, () => ({ publicId: generatePublicId("thr"), applicationId: db.select({ id: applications.id }).from(applications).where(eq(applications.publicId, orders.publicId)).get()!.id, viewWorkspaceId: workspace.id, route: "/settings", commitSha: preview.commitSha, anchor: { path: "body", tag: "body", fingerprint: "" }, offsetX: 0.5, offsetY: 0.5, createdAt: now })))
    .run();
  await page.keyboard.press("Escape");
  await startComment(page);
  await application(page).getByRole("button", { name: "Recalculate totals" }).click();
  await composer(page).getByLabel("Comment", { exact: true }).fill("One too many");
  await composer(page).getByRole("button", { name: "Post comment" }).click();
  await expect(composer(page)).toContainText("This workspace has 500 open comment threads, the most it can hold. Resolve some threads, or reset the workspace from Applications, to start another.");
  await expect(pin(page, 501)).toHaveCount(0);
  await composer(page).getByRole("button", { name: "Cancel" }).click();

  // Reopening a resolved thread is starting one again: refused at the limit, with the same message.
  db.update(commentThreads).set({ status: "resolved", resolvedAt: now }).where(eq(commentThreads.route, "/settings")).run();
  const applicationId = db.select({ id: applications.id }).from(applications).where(eq(applications.publicId, orders.publicId)).get()!.id;
  const opened = db
    .insert(commentThreads)
    .values(Array.from({ length: THREAD_LIMIT - 1 }, () => ({ publicId: generatePublicId("thr"), applicationId, viewWorkspaceId: workspace.id, route: "/orders", commitSha: preview.commitSha, anchor: { path: "body", tag: "body", fingerprint: "" }, offsetX: 0.5, offsetY: 0.5, createdAt: now })))
    .returning({ id: commentThreads.id })
    .all();
  // Every thread has its first comment, as one started in the toolbar does.
  const commentless = db.select({ id: commentThreads.id }).from(commentThreads).all().filter((thread) => !db.select().from(threadComments).where(eq(threadComments.threadId, thread.id)).get());
  db.insert(threadComments)
    .values(commentless.map((thread) => ({ publicId: generatePublicId("cmt"), threadId: thread.id, authorWorkspaceId: workspace.id, authorName: "Sam Rivera", body: "Seeded", createdAt: now })))
    .run();
  expect(opened).toHaveLength(THREAD_LIMIT - 1);
  await page.reload();
  await waitForPage(page, "Accounts");
  await openTool(page, "comments");
  await expect(panel(page)).toContainText("500 open · 499 resolved");
  await panel(page).getByRole("button", { name: "Resolved (499)" }).click();
  const resolved = panel(page).locator("[data-thread]").first();
  await resolved.getByRole("button", { name: "Reopen thread" }).click();
  await expect(resolved.getByRole("alert")).toHaveText("This workspace has 500 open comment threads, the most it can hold. Resolve some threads, or reset the workspace from Applications, to start another.");
  await expect(resolved.getByRole("button", { name: "Reopen thread" })).toBeVisible();
});

test("replies, resolves, and reopens a thread", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  await comment(page, exportOrders(page), "Make this primary", "Sam Rivera");
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

test("comments with the keyboard inside the application, and keeps comments after a reload", async ({ page, db }) => {
  await runOrdersPortal(page, db);
  await page.keyboard.press("c");
  await application(page).getByRole("button", { name: "Recalculate totals" }).focus();
  await expect(page.locator("[data-comment-outline]")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(composer(page)).toBeVisible();
  // The key chose the element: the application's button didn't run.
  await expect(application(page).getByText("Totals haven't been calculated yet.")).toBeVisible();
  await composer(page).getByLabel("Your name").fill("Robin");
  await composer(page).getByLabel("Comment", { exact: true }).fill("Show the total first");
  await composer(page).getByRole("button", { name: "Post comment" }).click();
  await expect(pin(page, 1)).toBeVisible();

  await page.reload();
  await waitForPage(page, "Accounts");
  await expect(pin(page, 1)).toBeVisible();
});

test.describe("the composer", () => {
  const field = (page: Page) => composer(page).getByLabel("Comment", { exact: true });

  test("marks the chosen point, invites a new thread, and sends only something written", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    await startComment(page);
    await exportOrders(page).click();
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

  test("formats the selected word, storing the marker and showing the style", async ({ page, db }) => {
    const { application: running } = await runOrdersPortal(page, db);
    await startComment(page);
    await exportOrders(page).click();
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
    const stored = await page.evaluate(async (slug) => (await (await fetch(`/api/workspace/threads?application=${slug}`)).json()) as { threads: { route: string; commit: string; anchor: { tag: string; fingerprint: string }; comments: { body: string }[] }[] }, running.slug);
    expect(stored.threads[0]!.comments[0]!.body).toBe("Make this **primary**");
    expect(stored.threads[0]).toMatchObject({ route: "/accounts", anchor: { tag: "button", fingerprint: "Export orders" } });
  });

  test("shows markup literally, creating no element or script", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    page.on("dialog", (dialog) => void dialog.dismiss());
    await startComment(page);
    await exportOrders(page).click();
    await composer(page).getByLabel("Your name").fill("Sam Rivera");
    await field(page).fill("<img src=x onerror=alert(1)>");
    await composer(page).getByRole("button", { name: "Post comment" }).click();
    const thread = page.getByRole("dialog", { name: "Comment 1" });
    await expect(thread).toContainText("<img src=x onerror=alert(1)>");
    await expect(thread.locator("img")).toHaveCount(0);
    await page.reload();
    await waitForPage(page, "Accounts");
    await pin(page, 1).click();
    await expect(page.getByRole("dialog", { name: "Comment 1" })).toContainText("<img src=x onerror=alert(1)>");
    await expect(page.locator("[data-thread-popover] img, [data-comment-pin] img")).toHaveCount(0);
  });

  test("opens to the left of the pill for the application's Feedback tab beside it, without covering it", async ({ page, db }) => {
    await runOrdersPortal(page, db);
    await startComment(page);
    const feedback = application(page).getByRole("button", { name: "Feedback" });
    const box = (await feedback.boundingBox())!;
    const pill = (await page.getByRole("complementary", { name: "Toolbar", exact: true }).boundingBox())!;
    // The tab sits under the pill, at the middle of the right edge; its left part is clear of it.
    expect(box.x + box.width).toBeGreaterThan(pill.x);
    await page.mouse.click(box.x + 4, box.y + box.height / 2);
    await expect(composer(page)).toContainText('On button "Feedback" at /accounts');
    await expect.poll(async () => (await composer(page).boundingBox())!.x + (await composer(page).boundingBox())!.width).toBeLessThanOrEqual(pill.x);
    await expectToolbarOnTop(page);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no accessibility violations while open, with the formatting bar, in the ${theme} operator theme`, async ({ page, db, context, baseURL }) => {
      await useTheme(context, theme, baseURL!);
      await runOrdersPortal(page, db);
      await startComment(page);
      await exportOrders(page).click();
      await composer(page).getByRole("button", { name: "Formatting" }).click();
      if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: AXE });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
        const result = await axe.run({ include: [['[aria-label="New comment"]']] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"], iframes: false });
        return result.violations.map((violation) => violation.id);
      });
      expect(violations).toEqual([]);
    });
  }
});
