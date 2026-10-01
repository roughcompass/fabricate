import { templateBySlug } from "../src/lib/demo/catalog";
import { createApplication, validateDeployInput } from "../src/lib/demo/deployments";
import { WORKSPACE_COOKIE } from "../src/lib/demo/workspace-key";
import { createProfile } from "../src/lib/demo/profiles";
import { ensureWorkspace } from "../src/lib/demo/workspaces";
import { openTool, setView, waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** Sharing a view of a running application (template-demo/toolbar spec). */

test("opens a shared view elsewhere with its versions, theme, and comments, and takes replies", async ({ page, context, browser, db }) => {
  await page.goto("/templates");
  const key = (await context.cookies()).find((cookie) => cookie.name === WORKSPACE_COOKIE)!.value;
  const workspace = ensureWorkspace(db, key);
  const application = createApplication(db, workspace.id, templateBySlug("payments-workspace")!, validateDeployInput({ name: "Shared payments", environment: "sandbox", project: "", repository: "" }), new Date(Date.now() - 60_000));

  await page.goto(`/run/${application.publicId}`);
  await waitForRegions(page);
  await setView(page, { theme: "dark", overrides: { "payee-list": { version: "2.0.0", environment: "sandbox" } } });
  await page.keyboard.press("c");
  await page.locator('[data-demo-anchor="pay-lumen"]').click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  await composer.getByLabel("Your name").fill("Sam Rivera");
  await composer.getByLabel("Comment", { exact: true }).fill("Ship version 2");
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(page.locator('[data-comment-pin="1"]')).toBeVisible();

  await openTool(page, "share");
  const share = page.getByRole("dialog", { name: "Share" });
  await expect(share).toContainText("Anyone with the link can view this application and its comments, and add comments.");
  const link = await share.getByLabel("Link to this view").inputValue();
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
  await expect(share.getByRole("button", { name: "Copy link" })).toBeVisible();

  // A private window: another browser with no workspace of its own.
  const other = await browser.newContext();
  const recipient = await other.newPage();
  await recipient.goto(link);
  await expect(recipient).toHaveURL(new RegExp(`/run/${application.publicId}/payees$`));
  await waitForRegions(recipient);
  // A first-time visitor gets the guided hints, which open the toolbar menu; this one dismisses them.
  await recipient.locator("[data-hint]").getByRole("button", { name: "Dismiss hints" }).click();
  await expect(recipient.getByRole("dialog", { name: "Demo toolbar" })).toBeHidden();
  await expect(recipient.locator('[data-demo-mfe="payee-list"]')).toHaveAttribute("data-demo-version", "2.0.0");
  await expect(recipient.locator("[data-demo-portal]")).toHaveAttribute("data-theme", "dark");
  await expect(recipient.locator('[data-comment-pin="1"]')).toBeVisible();

  await recipient.locator('[data-comment-pin="1"]').click();
  const thread = recipient.getByRole("dialog", { name: "Comment 1" });
  await expect(thread).toContainText("Ship version 2");
  await thread.getByLabel("Your name").fill("Robin");
  await thread.getByLabel("Reply").fill("Looks good to me");
  await thread.getByRole("button", { name: "Post reply" }).click();
  await expect(thread).toContainText("Looks good to me");

  // The recipient's own changes stay in their browser.
  await setView(recipient, { theme: "light" });
  await expect(recipient.locator("[data-demo-portal]")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await waitForRegions(page);
  await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-theme", "dark");
  await page.locator('[data-comment-pin="1"]').click();
  await expect(page.getByRole("dialog", { name: "Comment 1" })).toContainText("Robin");
  await expect(page.getByRole("dialog", { name: "Comment 1" })).toContainText("Looks good to me");
  await other.close();
});

test("shares a custom profile as a snapshot that never joins the recipient's profiles", async ({ page, context, browser, db }) => {
  await page.goto("/run/ref-payments-workspace");
  await waitForRegions(page);
  const key = (await context.cookies()).find((cookie) => cookie.name === WORKSPACE_COOKIE)!.value;
  const priya = createProfile(db, ensureWorkspace(db, key).id, { name: "Priya Shah", persona: "Approver", region: "Mumbai" });
  await setView(page, { profileId: priya.id });
  await expect(page.locator('[data-demo-anchor="portal-session"]')).toContainText("Priya Shah");

  await openTool(page, "share");
  const share = page.getByRole("dialog", { name: "Share" });
  await expect(share).toContainText("Priya Shah signed in");
  const link = await share.getByLabel("Link to this view").inputValue();

  const other = await browser.newContext();
  const recipient = await other.newPage();
  await recipient.goto(link);
  await waitForRegions(recipient);
  await expect(recipient.locator('[data-demo-anchor="portal-session"]')).toContainText("Priya Shah");
  await expect(recipient.locator('[data-demo-anchor="portal-session"]')).toContainText("Approver · Mumbai");
  await expect(recipient.locator('[data-demo-mfe="payment-activity"]').getByRole("button", { name: /^Approve / }).first()).toBeVisible();

  // The snapshot comes first in Session, read-only and marked, and is not one of the recipient's own profiles.
  await openTool(recipient, "session");
  const session = recipient.getByRole("dialog", { name: "Session" });
  const first = session.getByRole("radio").first();
  await expect(first).toBeChecked();
  expect(await first.evaluate((input) => input.closest("label")?.textContent)).toBe("Priya ShahApprover · Mumbai · From share link");
  await expect(session.getByRole("button", { name: /^(Edit|Delete) Priya Shah/ })).toHaveCount(0);
  await expect(session.getByRole("list", { name: "Your profiles" })).toHaveCount(0);
  expect(await (await recipient.request.get("/api/demo/profiles")).json()).toEqual({ profiles: [] });

  // Choosing another profile there leaves the sharer signed in as Priya Shah.
  await session.getByRole("radio", { name: /^Sam Rivera/ }).check();
  await expect(recipient.locator('[data-demo-anchor="portal-session"]')).toContainText("Sam Rivera");
  await page.reload();
  await waitForRegions(page);
  await expect(page.locator('[data-demo-anchor="portal-session"]')).toContainText("Priya Shah");
  await other.close();
});

test("refuses an unknown share link with a way back to Applications", async ({ page, db: _db }) => {
  const response = await page.goto(`/s/${"A".repeat(43)}`);
  expect(response?.status()).toBe(404);
  await expect(page).toHaveURL(/\/run\/unavailable$/);
  await expect(page.getByRole("heading", { level: 1, name: "Application not available" })).toBeVisible();
  await expect(page.getByText("This link no longer opens an application.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Applications" })).toHaveAttribute("href", "/applications");
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
});

test("shares a reference deployment view, including its otherwise private comments", async ({ page, browser, db: _db }) => {
  await page.goto("/run/ref-market-watch");
  await waitForRegions(page);
  await page.keyboard.press("c");
  await page.locator('[data-demo-anchor="order-symbol"]').click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  await composer.getByLabel("Your name").fill("Sam");
  await composer.getByLabel("Comment", { exact: true }).fill("Private until shared");
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(page.locator('[data-comment-pin="1"]')).toBeVisible();

  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto("/run/ref-market-watch");
  await waitForRegions(stranger);
  await expect(stranger.locator("[data-comment-pin]")).toHaveCount(0);

  await openTool(page, "share");
  const link = await page.getByRole("dialog", { name: "Share" }).getByLabel("Link to this view").inputValue();
  await stranger.goto(link);
  await waitForRegions(stranger);
  await expect(stranger.locator('[data-comment-pin="1"]')).toBeVisible();
  await other.close();
});
