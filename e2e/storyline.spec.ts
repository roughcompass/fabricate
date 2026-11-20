import { resetWorkspace } from "../src/lib/demo/workspaces";
import { openTool } from "./support/demo";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { buildOrdersPortal, ordersPortalRemote } from "./support/fixture-app";
import { paths } from "./support/paths";
import { pageHeader } from "./support/shell";
import { application, visitorContext, waitForPage, workspaceOf } from "./support/running-app";

/*
 * The presenter storyline in one flow, ported from the template demo's to an
 * application (add-applications, task 9.2): from Applications to the
 * application's page, preview mode, and the running application, its
 * toolbar's audit, Timing, a comment, and a share link a colleague replies
 * through, then a reset. Run it three times in a row (`--repeat-each=3`) to
 * rehearse. Reset workspace's section is placed on the Applications page
 * when it's merged; until then the reset runs as its action does.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");

test("runs the presenter storyline from Applications to a reset", async ({ page, context, browser, baseURL, db }) => {
  test.setTimeout(180_000);
  ordersPortalRemote();
  await buildOrdersPortal(db);

  // Applications, then the application's page, then preview mode at tablet size.
  await page.goto(paths.applications);
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Orders portal", exact: true }) });
  await expect(card).toContainText("Ready");
  await card.getByRole("link", { name: "Orders portal" }).click();
  await expect(page).toHaveURL(paths.application("orders-portal"));
  await pageHeader(page).getByRole("link", { name: "Preview application" }).click();
  await page.getByRole("group", { name: "Device" }).getByRole("button", { name: "Tablet" }).click();
  await expect(page.locator("[data-frame-size]")).toHaveText("820 × 1180");

  // Open the running application full screen.
  const [app] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: /Open full screen/ }).click()]);
  await waitForPage(app, "Accounts");
  expect(new URL(app.url()).pathname).toBe(paths.runningApplication("orders-portal", "/accounts"));

  // Audit, navigate inside the application, and audit again.
  await openTool(app, "accessibility");
  const audit = app.getByRole("dialog", { name: "Accessibility" });
  await audit.getByRole("button", { name: "Run audit" }).click();
  await expect(audit.locator("[data-audit-result]")).toHaveCount(1);
  await expect(audit.getByRole("button", { name: /Form elements must have labels/ })).toBeVisible();
  await app.keyboard.press("Escape");
  await application(app).getByRole("link", { name: "Settings" }).click();
  await waitForPage(app, "Settings");
  await openTool(app, "accessibility");
  await expect(audit.locator("[data-audit-stale]")).toBeVisible();
  await audit.getByRole("button", { name: "Run audit again" }).click();
  await expect(audit.getByRole("status")).toHaveText("No violations found.");
  await app.keyboard.press("Escape");

  // Timing: the planted slow button is rated Poor.
  await application(app).getByRole("link", { name: "Accounts" }).click();
  await waitForPage(app, "Accounts");
  await application(app).getByRole("button", { name: "Recalculate totals" }).click();
  await app.keyboard.press("t");
  const timing = app.getByRole("dialog", { name: "Timing" });
  await expect(timing.locator('[data-vital="INP"]')).toHaveAttribute("data-rating", "poor");
  await expect(timing.locator("[data-slowest-interaction]")).toContainText('on button "Recalculate totals" at /accounts');
  await app.keyboard.press("Escape");

  // Comment on Export orders, then share the view.
  await app.keyboard.press("c");
  await application(app).getByRole("button", { name: "Export orders" }).click();
  const composer = app.getByRole("dialog", { name: "New comment" });
  await composer.getByLabel("Your name").fill("Sam Rivera");
  await composer.getByLabel("Comment", { exact: true }).fill("Make this the primary action");
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(app.locator('[data-comment-pin="1"]')).toBeVisible();
  await openTool(app, "share");
  await expect(app.getByRole("dialog", { name: "Share" }).getByLabel("Link to this view")).toHaveValue(/\/s\//);
  const link = await app.getByRole("dialog", { name: "Share" }).getByLabel("Link to this view").inputValue();

  // A colleague opens the link in their own browser and replies.
  const colleague = await visitorContext(browser, db, baseURL!);
  const recipient = await colleague.newPage();
  await recipient.goto(link);
  await waitForPage(recipient, "Accounts");
  await recipient.locator('[data-comment-pin="1"]').click();
  const thread = recipient.getByRole("dialog", { name: "Comment 1" });
  await thread.getByLabel("Your name").fill("Robin Chen");
  await thread.getByLabel("Reply").fill("Agreed, ship it");
  await thread.getByRole("button", { name: "Post reply" }).click();
  await expect(thread).toContainText("Agreed, ship it");

  await app.reload();
  await waitForPage(app, "Accounts");
  await app.locator('[data-comment-pin="1"]').click();
  await expect(app.getByRole("dialog", { name: "Comment 1" })).toContainText("Agreed, ship it");

  // Reset: the comments and the share link are gone, and the application is unchanged.
  resetWorkspace(db, (await workspaceOf(context, db)).id);
  expect((await recipient.request.get(link)).status()).toBe(404);
  await app.reload();
  await waitForPage(app, "Accounts");
  await app.waitForLoadState("networkidle");
  await expect(app.locator("[data-comment-pin]")).toHaveCount(0);
  await colleague.close();
});
