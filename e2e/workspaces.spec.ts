import type { Page } from "@playwright/test";
import { startComment } from "./support/toolbar";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { framedRun } from "./support/fixture-app";
import { buildQuotes } from "./support/quotes-fixtures";
import { application, resetFromApplications, runOrdersPortal, visitorContext, waitForPage, workspaceOf } from "./support/running-app";
import { choosePreset, chosenPreset, createPreset, listPresets } from "../src/lib/workspaces/presets";

/*
 * Anonymous workspaces on running applications (template-demo/demo-mode
 * spec, "Each visitor works in an anonymous workspace" and "Visitors can
 * reset their workspace's comments and share links"; add-applications, task
 * 8.7): every visitor sees the same application and only their own comments,
 * a returning browser finds them again, and Reset workspace, at the end of
 * the Applications page, clears one workspace alone. Session presets are the
 * application's, and only each workspace's choice of one is its own
 * (restore-toolbar-tools-and-branch-previews, task 10.6).
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(120_000);

const pins = (page: Page) => page.locator("[data-comment-pin]");

async function comment(page: Page, button: string, text: string, name: string) {
  await startComment(page);
  await application(page).getByRole("button", { name: button }).click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  await composer.getByLabel("Your name").fill(name);
  await composer.getByLabel("Comment", { exact: true }).fill(text);
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(composer).toBeHidden();
  await page.keyboard.press("Escape");
}

test("keeps two visitors' comments on the same application apart, and resets one without the other (Two visitors, Private until shared, Reset between presentations)", async ({ page, browser, baseURL, db }) => {
  const running = await runOrdersPortal(page, db);
  const visitor = await visitorContext(browser, db, baseURL!);
  const second = await visitor.newPage();
  await second.goto(framedRun(running, "/accounts"));
  await waitForPage(second, "Accounts");

  await comment(page, "Export orders", "Presenter's comment", "Alex");
  await comment(second, "Recalculate totals", "Visitor's comment", "Blake");
  // Each sees the application and only their own comment.
  for (const [viewer, own] of [
    [page, "Alex"],
    [second, "Blake"],
  ] as const) {
    await viewer.reload();
    await waitForPage(viewer, "Accounts");
    await expect(pins(viewer)).toHaveCount(1);
    await expect(pins(viewer).first()).toHaveAccessibleName(new RegExp(`by ${own}:`));
  }

  // The presenter resets; the visitor keeps their comment, and the application is unchanged.
  await resetFromApplications(page);
  await expect(page.getByRole("article").filter({ hasText: "Orders portal" })).toContainText("Ready");
  await page.goto(framedRun(running, "/accounts"));
  await waitForPage(page, "Accounts");
  await page.waitForLoadState("networkidle");
  await expect(pins(page)).toHaveCount(0);
  await second.reload();
  await waitForPage(second, "Accounts");
  await expect(pins(second)).toHaveCount(1);
  // The reset forgot the presenter's name, so their next comment asks for it again.
  await startComment(page);
  await application(page).getByRole("button", { name: "Export orders" }).click();
  await expect(page.getByRole("dialog", { name: "New comment" }).getByLabel("Your name")).toBeVisible();
  await visitor.close();
});

test("changes nothing when the reset is canceled (Reset cancels a pending choice)", async ({ page, db }) => {
  const running = await runOrdersPortal(page, db);
  await comment(page, "Export orders", "Keep me", "Alex");
  await page.goto("/applications");
  await page.getByRole("region", { name: "Reset workspace" }).getByRole("button", { name: "Reset workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset your workspace?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.goto(framedRun(running, "/accounts"));
  await waitForPage(page, "Accounts");
  await expect(pins(page)).toHaveCount(1);
});

test("finds a returning visitor's workspace and comments in the same browser profile (Returning visitor)", async ({ page, context, browser, baseURL, db }) => {
  const running = await runOrdersPortal(page, db);
  await comment(page, "Export orders", "Still here tomorrow", "Alex");
  // The browser closes, keeping its cookies, and comes back.
  const state = await context.storageState();
  await page.close();
  const returning = await browser.newContext({ baseURL, storageState: state });
  const again = await returning.newPage();
  await again.goto(framedRun(running, "/accounts"));
  await waitForPage(again, "Accounts");
  await expect(pins(again)).toHaveCount(1);
  await expect(pins(again).first()).toHaveAccessibleName(/by Alex: Still here tomorrow/);
  await returning.close();
});

test("Reset workspace clears the visitor's preset choices and leaves the application's presets (Presets are the application's, choices are the visitor's)", async ({ page, context, browser, baseURL, db }) => {
  const { desk } = await buildQuotes(db, { saved: false });
  const id = (db.$client.prepare("select id from applications where slug = ?").get(desk.application.slug) as { id: number }).id;
  await page.goto(framedRun(desk));
  await waitForPage(page, "Quotes desk");
  const admin = createPreset(db, id, { name: "Admin user", entries: [{ store: "local", name: "desk:user", value: '{"role":"admin"}' }] }, null);
  const presenter = await workspaceOf(context, db);
  choosePreset(db, presenter.id, id, admin.publicId);
  await page.reload();
  await waitForPage(page, "Quotes desk");
  await expect(application(page).locator("[data-startup-user]")).toHaveText("admin");

  // Another browser sees the preset, and starts with its own storage.
  const visitor = await visitorContext(browser, db, baseURL!);
  const second = await visitor.newPage();
  await second.goto(framedRun(desk));
  await waitForPage(second, "Quotes desk");
  await expect(application(second).locator("[data-startup-user]")).toHaveText("none");
  await second.keyboard.press("p");
  await expect(second.getByRole("dialog", { name: "Session" }).locator('[data-preset="Admin user"]')).toBeVisible();

  await resetFromApplications(page);
  expect(chosenPreset(db, presenter.id, id)).toBeNull();
  expect(listPresets(db, id).map((preset) => preset.name)).toEqual(["Admin user"]);
  await page.goto(framedRun(desk));
  await waitForPage(page, "Quotes desk");
  await expect(application(page).locator("[data-startup-user]")).toHaveText("none");
  await visitor.close();
});
