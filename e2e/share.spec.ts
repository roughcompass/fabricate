import type { Page } from "@playwright/test";
import { deleteApplication } from "../src/lib/applications/records";
import { deletePreview } from "../src/lib/previews/lifecycle";
import { openTool, startComment } from "./support/toolbar";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { removeSavedPreview } from "../src/lib/applications/saved-previews";
import { ORDERS_PORTAL_BRANDS, commitToOrdersPortal, commitToRemote, framedRun, rebuildOrdersPortal, saveOrdersPortalPreview } from "./support/fixture-app";
import { QUOTES_DESK_REMOTE, buildQuotes } from "./support/quotes-fixtures";
import { choosePreset, chosenPreset, createPreset, deletePreset } from "../src/lib/workspaces/presets";
import { paths } from "./support/paths";
import { runJobs, serverConfig } from "./support/results";
import { buildSavedPreview } from "../src/lib/applications/pipeline";
import { application, resetFromApplications, runOrdersPortal, visitorContext, waitForPage, workspaceOf } from "./support/running-app";

/*
 * Sharing a view of a running application (template-demo/toolbar spec,
 * "Visitors can share an application view" and "Shared links open the
 * captured view"; add-applications, task 8.6): a link captures the
 * application, the commit of the build shown, and the route, and opens them
 * anywhere with the view's comments, or the current build with a notice once
 * the shared build is gone.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(120_000);

const pin = (page: Page, number: number) => page.locator(`[data-comment-pin="${number}"]`);

/** Comments on Export orders as +name+ the first time. */
async function comment(page: Page, text: string, name?: string) {
  await startComment(page);
  await application(page).getByRole("button", { name: "Export orders" }).click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  if (name) await composer.getByLabel("Your name").fill(name);
  await composer.getByLabel("Comment", { exact: true }).fill(text);
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(composer).toBeHidden();
}

/** Opens Share and returns the link it made. */
async function shareLink(page: Page): Promise<string> {
  await openTool(page, "share");
  const share = page.getByRole("dialog", { name: "Share" });
  await expect(share.getByLabel("Link to this view")).toHaveValue(/\/s\/[A-Za-z0-9_-]{43}$/);
  return share.getByLabel("Link to this view").inputValue();
}

test("captures the application, commit, and route, opens them elsewhere with the comment pinned, and takes replies (Creating a link, Opening a shared link elsewhere, Reply through a share link)", async ({ page, browser, db }) => {
  const { application: orders, preview } = await runOrdersPortal(page, db, "/accounts/42");
  await comment(page, "Ship this account view", "Sam Rivera");
  await expect(pin(page, 1)).toBeVisible();
  await page.keyboard.press("Escape");

  await openTool(page, "share");
  const share = page.getByRole("dialog", { name: "Share" });
  await expect(share).toContainText("Anyone with the link can view this application and its comments, and add comments.");
  await expect(share.locator("[data-share-view]")).toHaveText(`The link opens Orders portal at /accounts/42, built from commit ${preview.commitSha.slice(0, 12)}, with this view's comments.`);
  await expect(share.getByRole("button", { name: "Copy link" })).toBeVisible();
  const link = await share.getByLabel("Link to this view").inputValue();
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);

  // A private window: another browser with no workspace of its own.
  const other = await browser.newContext();
  const recipient = await other.newPage();
  await recipient.goto(link);
  await expect(recipient).toHaveURL(new RegExp(`/run/${orders.slug}/accounts/42\\?share=[A-Za-z0-9_-]{43}$`));
  // A first-time visitor gets the guided hints, which open the toolbar menu; this one dismisses them.
  await recipient.locator("[data-hint]").getByRole("button", { name: "Dismiss hints" }).click();
  await waitForPage(recipient, "Accounts");
  await expect(application(recipient).getByRole("heading", { name: "Northwind Traders", level: 2 })).toBeVisible();
  await expect(pin(recipient, 1)).toBeVisible();
  await expect(recipient.locator("[data-run-notice]")).toHaveCount(0);

  await pin(recipient, 1).click();
  const thread = recipient.getByRole("dialog", { name: "Comment 1" });
  await expect(thread).toContainText("Ship this account view");
  await thread.getByLabel("Your name").fill("Robin");
  await thread.getByLabel("Reply").fill("Looks good to me");
  await thread.getByRole("button", { name: "Post reply" }).click();
  await expect(thread).toContainText("Looks good to me");

  // The presenter sees the reply after reloading.
  await page.reload();
  await waitForPage(page, "Accounts");
  await pin(page, 1).click();
  await expect(page.getByRole("dialog", { name: "Comment 1" })).toContainText("Robin");
  await expect(page.getByRole("dialog", { name: "Comment 1" })).toContainText("Looks good to me");
  await other.close();
});

test("opens the captured commit's build, or the current build with a notice once the shared build is gone (Shared build pruned)", async ({ page, browser, db, baseURL }) => {
  const first = await runOrdersPortal(page, db, "/accounts");
  await comment(page, "On the first build", "Sam Rivera");
  await page.keyboard.press("Escape");
  const link = await shareLink(page);

  // A newer build becomes current; the link still opens the build it captured.
  commitToOrdersPortal({ "src/accounts.jsx": (source) => source.replace("Every account the orders team serves", "Every account we serve") }, { message: "Shorter lead" });
  const second = await rebuildOrdersPortal(db, first.application);
  const colleague = await visitorContext(browser, db, baseURL!);
  const recipient = await colleague.newPage();
  await recipient.goto(link);
  await waitForPage(recipient, "Accounts");
  await expect(recipient.locator("[data-target-frame]")).toHaveAttribute("src", `${first.base}accounts`);
  await expect(application(recipient).getByText("Every account the orders team serves")).toBeVisible();
  await expect(recipient.locator("[data-run-notice]")).toHaveCount(0);

  // Once that build is deleted, the current one opens at the captured route, saying so.
  expect(await deletePreview(db, first.preview.publicId, serverConfig())).toBe(true);
  await recipient.goto(link);
  await waitForPage(recipient, "Accounts");
  await expect(recipient.locator("[data-target-frame]")).toHaveAttribute("src", `${second.base}accounts`);
  await expect(application(recipient).getByText("Every account we serve")).toBeVisible();
  const notice = recipient.locator("[data-run-notice]");
  await expect(notice).toContainText(`The shared commit ${first.preview.commitSha.slice(0, 12)} is no longer available, so this is the current build.`);
  // The shared view's comment is listed, placed on the commit that's gone.
  await openTool(recipient, "comments");
  await expect(recipient.getByRole("dialog", { name: "Comments" })).toContainText(`Commit ${first.preview.commitSha.slice(0, 12)}`);
  await recipient.keyboard.press("Escape");
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  await colleague.close();
});

test.describe("a saved preview's share link (restore-toolbar-tools-and-branch-previews, task 4.2)", () => {
  test("shares a saved preview: the link opens it at its own address, at the captured route, with the comment (Sharing a saved preview)", async ({ page, browser, db, baseURL }) => {
    const { application: orders } = await runOrdersPortal(page, db, "/");
    const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
    await page.goto(paths.runningApplication(orders.slug, "/accounts/42", undefined, feature.key));
    await waitForPage(page, "Accounts");
    await comment(page, "Check the new navigation", "Sam Rivera");
    await page.keyboard.press("Escape");
    await openTool(page, "share");
    await expect(page.getByRole("dialog", { name: "Share" }).locator("[data-share-view]")).toHaveText(`The link opens Orders portal (feature/new-nav) at /accounts/42, built from commit ${feature.current!.commitSha.slice(0, 12)}, with this view's comments.`);
    const link = await page.getByRole("dialog", { name: "Share" }).getByLabel("Link to this view").inputValue();

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await expect(recipient).toHaveURL(new RegExp(`/run/${orders.slug}@feature-new-nav/accounts/42\\?share=[A-Za-z0-9_-]{43}$`));
    await waitForPage(recipient, "Accounts");
    await expect(application(recipient).getByText(ORDERS_PORTAL_BRANDS.feature, { exact: true })).toBeVisible();
    await expect(pin(recipient, 1)).toBeVisible();
    await expect(recipient.locator("[data-run-notice]")).toHaveCount(0);
    await colleague.close();
  });

  test("falls back to the preview's current build once the captured one is gone (Shared saved preview moved on)", async ({ page, browser, db, baseURL }) => {
    const { application: orders } = await runOrdersPortal(page, db, "/");
    const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
    await page.goto(paths.runningApplication(orders.slug, "/accounts", undefined, feature.key));
    await waitForPage(page, "Accounts");
    const link = await shareLink(page);

    // The branch moves, its new build becomes current, and the captured build is deleted.
    commitToOrdersPortal({ "src/accounts.jsx": (source) => source.replace("Every account the orders team serves", "Every account on the new navigation") }, { branch: "feature/new-nav", message: "New lead" });
    await buildSavedPreview(db, feature.publicId, { config: serverConfig() });
    await runJobs(db);
    expect(await deletePreview(db, feature.current!.preview, serverConfig())).toBe(true);

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await waitForPage(recipient, "Accounts");
    await expect(application(recipient).getByText("Every account on the new navigation")).toBeVisible();
    await expect(recipient.locator("[data-run-notice]")).toContainText(`The shared commit ${feature.current!.commitSha.slice(0, 12)} is no longer available, so this is feature/new-nav's current build.`);
    await colleague.close();
  });

  test("falls back to the application's current build after the preview was removed, saying so (Shared saved preview removed)", async ({ page, browser, db, baseURL }) => {
    const { application: orders, base } = await runOrdersPortal(page, db, "/");
    const feature = await saveOrdersPortalPreview(db, "refs/heads/feature/new-nav");
    await page.goto(paths.runningApplication(orders.slug, "/accounts", undefined, feature.key));
    await waitForPage(page, "Accounts");
    const link = await shareLink(page);
    removeSavedPreview(db, orders.publicId, feature.key);

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await expect(recipient).toHaveURL(new RegExp(`/run/${orders.slug}/accounts\\?share=[A-Za-z0-9_-]{43}$`));
    await waitForPage(recipient, "Accounts");
    await expect(recipient.locator("[data-target-frame]")).toHaveAttribute("src", `${base}accounts`);
    await expect(application(recipient).getByText(ORDERS_PORTAL_BRANDS.main, { exact: true })).toBeVisible();
    await expect(recipient.locator("[data-run-notice]")).toContainText("The shared preview of feature/new-nav was removed, so this is the application's current build.");
    await colleague.close();
  });
});

test("stops working when the sharer resets their workspace or the application is deleted, leading back to Applications", async ({ page, db }) => {
  const { application: orders } = await runOrdersPortal(page, db);
  await comment(page, "Ship it", "Sam Rivera");
  await page.keyboard.press("Escape");
  const before = await shareLink(page);
  await page.keyboard.press("Escape");

  await resetFromApplications(page);
  const response = await page.goto(before);
  expect(response!.status()).toBe(404);
  await expect(page).toHaveURL(/\/run\/unavailable$/);
  await expect(page.getByRole("heading", { name: "Application not available", level: 1 })).toBeVisible();
  await expect(page.getByText("This link no longer opens an application.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Go to Applications" })).toHaveAttribute("href", paths.applications);
  expect((await page.request.get(paths.applications)).status()).toBe(200);

  await page.goto(paths.runningApplication(orders.slug));
  await waitForPage(page, "Accounts");
  const after = await shareLink(page);
  deleteApplication(db, orders.publicId);
  expect((await page.goto(after))!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Application not available", level: 1 })).toBeVisible();
});

test("refuses an unknown share link with a way back that opens a page", async ({ page, db: _db }) => {
  const response = await page.goto(`/s/${"A".repeat(43)}`);
  expect(response?.status()).toBe(404);
  await expect(page).toHaveURL(/\/run\/unavailable$/);
  await expect(page.getByRole("heading", { level: 1, name: "Application not available" })).toBeVisible();
  const back = page.getByRole("link", { name: /^Go to / });
  expect((await page.request.get((await back.getAttribute("href"))!)).status()).toBe(200);
});

test.describe("what a share link applies (restore-toolbar-tools-and-branch-previews, tasks 9.5, 10.5, and 11.4)", () => {
  test.setTimeout(180_000);

  const shareDialog = (page: Page) => page.getByRole("dialog", { name: "Share" });
  const applies = (page: Page) => shareDialog(page).locator("[data-share-applies]");
  const deskId = (db: Parameters<typeof buildQuotes>[0]) => (db.$client.prepare("select id from applications where slug = 'quotes-desk'").get() as { id: number }).id;
  const ADMIN = { name: "Admin user", entries: [{ store: "local", name: "desk:user", value: '{"role":"admin"}' }, { store: "cookie", name: "desk-region", value: "london" }, { store: "query", name: "desk", value: "fx" }] };

  test("shares routing: another browser registers the routing worker and loads quotesPanel from feature/blue-quotes, and drops it once that build is gone (Routing in a shared link, Routing to a build that's gone)", async ({ page, browser, db, baseURL }) => {
    const { desk, panel, blueQuotes } = await buildQuotes(db);
    await page.goto(framedRun(desk));
    await waitForPage(page, "Quotes desk");
    await openTool(page, "microfrontends");
    const microfrontends = page.getByRole("dialog", { name: "Microfrontends" });
    await microfrontends.locator('[data-member="quotesPanel"]').click();
    await microfrontends.getByRole("group", { name: "Version" }).getByRole("radio", { name: /feature\/blue-quotes/ }).check();
    await microfrontends.getByRole("button", { name: "Reload application", exact: true }).click();
    await expect(application(page).getByRole("heading", { name: "Blue quotes panel", level: 2 })).toBeVisible();
    const link = await shareLink(page);

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await waitForPage(recipient, "Quotes desk");
    await expect(application(recipient).getByRole("heading", { name: "Blue quotes panel", level: 2 })).toBeVisible();
    expect(await recipient.evaluate(async (scope) => (await navigator.serviceWorker.getRegistration(scope))?.active?.scriptURL ?? null, desk.base)).toMatch(/\/toolbar\/routing-worker\.js$/);
    await openTool(recipient, "microfrontends");
    await expect(recipient.getByRole("dialog", { name: "Microfrontends" }).locator('[data-member="quotesPanel"]')).toContainText(`Routed to Quotes panel · feature/blue-quotes · ${blueQuotes!.current!.commitSha.slice(0, 12)}`);
    // The recipient's own view isn't routed by the link.
    expect(await recipient.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("frontend-registry:routing:")))).toEqual([]);

    removeSavedPreview(db, panel.application.publicId, blueQuotes!.key);
    const later = await colleague.newPage();
    await later.goto(link);
    await waitForPage(later, "Quotes desk");
    await expect(later.locator("[data-run-notice]")).toContainText("The shared routing of quotesPanel was dropped, because the build it named is gone.");
    await expect(application(later).getByText("Quotes unavailable")).toBeVisible();
    await colleague.close();
  });

  test("the dialog says the link registers a service worker, applies the theme, and starts with the preset, whose values aren't in the link, and says nothing for a plain view (A routed, dark view with a preset, A plain view)", async ({ page, db, context }) => {
    const { desk } = await buildQuotes(db);
    await page.goto(framedRun(desk));
    await waitForPage(page, "Quotes desk");
    await shareLink(page);
    await expect(applies(page)).toHaveCount(0);
    await page.keyboard.press("Escape");

    const admin = createPreset(db, deskId(db), ADMIN, null);
    choosePreset(db, (await workspaceOf(context, db)).id, deskId(db), admin.publicId);
    await page.reload();
    await waitForPage(page, "Quotes desk");
    await openTool(page, "microfrontends");
    const microfrontends = page.getByRole("dialog", { name: "Microfrontends" });
    await microfrontends.locator('[data-member="quotesPanel"]').click();
    await microfrontends.getByRole("group", { name: "Version" }).getByRole("radio", { name: /feature\/blue-quotes/ }).check();
    await microfrontends.getByRole("button", { name: "Reload application", exact: true }).click();
    await expect(application(page).getByRole("heading", { name: "Blue quotes panel", level: 2 })).toBeVisible();
    await openTool(page, "settings");
    await page.getByRole("dialog", { name: "Settings" }).getByRole("group", { name: "Mode" }).getByLabel("Dark").check();
    await shareLink(page);
    await expect(applies(page)).toHaveText(
      "Opening the link applies your Microfrontends routing, which registers a service worker in the recipient's browser for the routed build. It applies your Salt theme: dark mode. It starts with the session preset \"Admin user\", whose values aren't in the link.",
    );
  });

  test("shares the dark theme: another browser renders it dark, and Settings shows Dark chosen for that view (Theme in a shared link)", async ({ page, browser, db, baseURL }) => {
    const { desk } = await buildQuotes(db, { saved: false });
    await page.goto(framedRun(desk));
    await waitForPage(page, "Quotes desk");
    await openTool(page, "settings");
    await page.getByRole("dialog", { name: "Settings" }).getByRole("group", { name: "Mode" }).getByLabel("Dark").check();
    await expect(application(page).locator(":root")).toHaveAttribute("data-mode", "dark");
    const link = await shareLink(page);
    await expect(applies(page)).toHaveText("It applies your Salt theme: dark mode.");

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await waitForPage(recipient, "Quotes desk");
    await expect(application(recipient).locator(":root")).toHaveAttribute("data-mode", "dark");
    await openTool(recipient, "settings");
    await expect(recipient.getByRole("dialog", { name: "Settings" }).getByRole("group", { name: "Mode" }).getByLabel("Dark")).toBeChecked();
    // The recipient's own view keeps its own theme.
    expect(await recipient.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("frontend-registry:theme:")))).toEqual([]);
    await colleague.close();
  });

  test("names the preset but carries no values, starts the shared view with the named preset leaving the recipient's choice unchanged, and says when it was deleted (Sharing with a preset chosen, Opening the link, The preset was deleted)", async ({ page, browser, db, baseURL, context }) => {
    const { desk } = await buildQuotes(db, { saved: false });
    const id = deskId(db);
    const admin = createPreset(db, id, ADMIN, null);
    await page.goto(framedRun(desk, "/blotter?view=compact"));
    await waitForPage(page, "Blotter");
    choosePreset(db, (await workspaceOf(context, db)).id, id, admin.publicId);
    await page.reload();
    await waitForPage(page, "Blotter");
    await expect(page).toHaveURL(/\/run\/quotes-desk\/blotter\?view=compact&desk=fx$/);
    const link = await shareLink(page);
    await expect(applies(page)).toHaveText('It starts with the session preset "Admin user", whose values aren\'t in the link.');

    // The stored link names the preset, holds none of its entries, and leaves its query parameter out of the route.
    const stored = db.$client.prepare("select route, view from demo_shares order by id desc limit 1").get() as { route: string; view: string };
    expect(stored.route).toBe("/blotter?view=compact");
    expect(JSON.parse(stored.view)).toEqual({ session: { preset: admin.publicId, name: "Admin user" } });
    for (const value of ["desk:user", "admin", "london", "desk-region", "fx"]) expect(stored.view).not.toContain(value);

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await waitForPage(recipient, "Blotter");
    expect(await application(recipient).locator(":root").evaluate(() => `${location.pathname.replace(/^\/previews\/[^/]+/, "")}${location.search}`)).toBe("/blotter?view=compact&desk=fx");
    expect(await recipient.evaluate(() => localStorage.getItem("desk:user"))).toBe('{"role":"admin"}');
    await recipient.keyboard.press("p");
    await expect(recipient.getByRole("dialog", { name: "Session" }).locator("[data-shared-preset]")).toContainText('This shared view starts with the preset "Admin user".');
    await expect(recipient.getByRole("dialog", { name: "Session" }).getByRole("group", { name: "Start with" }).getByLabel("The application's own storage")).toBeChecked();
    // Afterward, the recipient's own view of Quotes desk starts with their own storage.
    expect(chosenPreset(db, (await workspaceOf(colleague, db)).id, id)).toBeNull();
    await recipient.goto(framedRun(desk));
    await waitForPage(recipient, "Quotes desk");
    await expect(application(recipient).locator("[data-startup-user]")).toHaveText("none");

    deletePreset(db, id, admin.publicId);
    await recipient.goto(link);
    await waitForPage(recipient, "Blotter");
    await expect(recipient.locator("[data-run-notice]")).toContainText('The shared preset "Admin user" no longer exists, so this view starts with your own choice.');
    expect(await recipient.evaluate(() => localStorage.getItem("desk:user"))).toBeNull();
    await colleague.close();
  });

  test("shows every notice that applies at once: the shared commit gone, the routed build gone, and the preset deleted", async ({ page, browser, db, baseURL, context }) => {
    const { desk, panel, blueQuotes } = await buildQuotes(db);
    const id = deskId(db);
    const admin = createPreset(db, id, ADMIN, null);
    choosePreset(db, (await workspaceOf(context, db)).id, id, admin.publicId);
    await page.goto(framedRun(desk));
    await waitForPage(page, "Quotes desk");
    await openTool(page, "microfrontends");
    const microfrontends = page.getByRole("dialog", { name: "Microfrontends" });
    await microfrontends.locator('[data-member="quotesPanel"]').click();
    await microfrontends.getByRole("group", { name: "Version" }).getByRole("radio", { name: /feature\/blue-quotes/ }).check();
    await microfrontends.getByRole("button", { name: "Reload application", exact: true }).click();
    await expect(application(page).getByRole("heading", { name: "Blue quotes panel", level: 2 })).toBeVisible();
    const link = await shareLink(page);

    // Quotes desk moves on and its shared build is deleted, the routed preview is removed, and the preset is deleted.
    commitToRemote(QUOTES_DESK_REMOTE, { "src/app.jsx": (source) => source.replace("<h1>Quotes desk</h1>", "<h1>Quotes desk</h1><p>New build</p>") }, { message: "New build" });
    await rebuildOrdersPortal(db, desk.application);
    expect(await deletePreview(db, desk.preview.publicId, serverConfig())).toBe(true);
    removeSavedPreview(db, panel.application.publicId, blueQuotes!.key);
    deletePreset(db, id, admin.publicId);

    const colleague = await visitorContext(browser, db, baseURL!);
    const recipient = await colleague.newPage();
    await recipient.goto(link);
    await waitForPage(recipient, "Quotes desk");
    const notice = recipient.locator("[data-run-notice]");
    await expect(notice).toContainText(`The shared commit ${desk.preview.commitSha.slice(0, 12)} is no longer available, so this is the current build.`);
    await expect(notice).toContainText("The shared routing of quotesPanel was dropped, because the build it named is gone.");
    await expect(notice).toContainText('The shared preset "Admin user" no longer exists, so this view starts with your own choice.');
    await expect(application(recipient).getByText("New build")).toBeVisible();
    await colleague.close();
  });
});
