import type { BrowserContext, Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { choosePreset, createPreset, editPreset, listPresets } from "../src/lib/workspaces/presets";
import { setDisplayName } from "../src/lib/workspaces/workspaces";
import { E2E_PREVIEWS } from "./support/env";
import { framedRun } from "./support/fixture-app";
import { expect, test } from "./support/fixtures";
import { buildQuotes } from "./support/quotes-fixtures";
import { application, visitorContext, waitForPage, workspaceOf } from "./support/running-app";
import { openTool } from "./support/toolbar";

/*
 * The Session tool (restore-toolbar-tools-and-branch-previews, tasks 10.3
 * and 10.4; template-demo/session-presets spec) on Quotes desk, which shows
 * what it read as it started: `desk:user` from local storage, `desk-tab`
 * from session storage, the `desk-region` cookie, and `?desk=`.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(150_000);

const ADMIN = { name: "Admin user", entries: [{ store: "local", name: "desk:user", value: '{"role":"admin"}' }, { store: "cookie", name: "desk-region", value: "london" }, { store: "query", name: "desk", value: "fx" }] };

const session = (page: Page) => page.getByRole("dialog", { name: "Session" });
const startWith = (page: Page) => session(page).getByRole("group", { name: "Start with" });

/** What Quotes desk shows it started with. */
async function started(page: Page) {
  const read = async (field: string) => (await application(page).locator(`[data-startup-${field}]`).innerText()).trim();
  return { user: await read("user"), region: await read("region"), tab: await read("tab"), desk: await read("desk") };
}

/** The internal ID of the application at +slug+. */
function applicationIdOfSlug(db: Db, slug: string): number {
  return (db.$client.prepare("select id from applications where slug = ?").get(slug) as { id: number }).id;
}

/** Quotes desk onboarded, its preset Admin user created by the workspace of the test's browser, named Presenter. */
async function deskWithAdmin(page: Page, db: Db, context: BrowserContext, route = "/") {
  const { desk } = await buildQuotes(db, { saved: false });
  await page.goto(framedRun(desk, route));
  await waitForPage(page, route === "/blotter" ? "Blotter" : "Quotes desk");
  const presenter = await workspaceOf(context, db);
  setDisplayName(db, presenter.id, "Presenter");
  const admin = createPreset(db, applicationIdOfSlug(db, desk.application.slug), ADMIN, "Presenter");
  return { desk, admin, presenter };
}

test.describe("applying a preset before the build loads", () => {
  test("Quotes desk reads the preset as it starts, and starts with it again when opened again", async ({ page, db, context }) => {
    await deskWithAdmin(page, db, context);
    expect(await started(page)).toEqual({ user: "none", region: "none", tab: "none", desk: "none" });
    await openTool(page, "session");
    await startWith(page).getByLabel("Admin user").check();
    await expect(application(page).locator("[data-startup-user]")).toHaveText("admin");
    expect(await started(page)).toEqual({ user: "admin", region: "london", tab: "none", desk: "fx" });

    await page.reload();
    await waitForPage(page, "Quotes desk");
    expect(await started(page)).toEqual({ user: "admin", region: "london", tab: "none", desk: "fx" });
  });

  test("query parameters reach the address", async ({ page, db, context }) => {
    const { admin, presenter } = await deskWithAdmin(page, db, context, "/blotter");
    choosePreset(db, presenter.id, applicationIdOfSlug(db, "quotes-desk"), admin.publicId);
    await page.reload();
    await waitForPage(page, "Blotter");
    await expect(page).toHaveURL(/\/run\/quotes-desk\/blotter\?desk=fx$/);
    expect(await application(page).locator(":root").evaluate(() => `${location.pathname.replace(/^\/previews\/[^/]+/, "")}${location.search}`)).toBe("/blotter?desk=fx");
  });

  test("switching back restores storage, and the cookie is scoped to the build's path", async ({ page, db, context }) => {
    const { desk } = await deskWithAdmin(page, db, context);
    // What this browser held for the desk before any preset.
    await page.evaluate(() => localStorage.setItem("desk:user", "trader"));
    await page.reload();
    await waitForPage(page, "Quotes desk");
    expect((await started(page)).user).toBe("trader");

    await openTool(page, "session");
    await startWith(page).getByLabel("Admin user").check();
    await expect(application(page).locator("[data-startup-user]")).toHaveText("admin");
    const cookies = (await context.cookies()).filter((cookie) => cookie.name === "desk-region");
    expect(cookies.map((cookie) => [cookie.value, cookie.path])).toEqual([["london", `/previews/${desk.preview.publicId}/`]]);
    // Frontend Registry pages outside that path don't receive it.
    expect(await page.evaluate(() => document.cookie)).not.toContain("desk-region");

    await startWith(page).getByLabel("The application's own storage").check();
    await expect(application(page).locator("[data-startup-user]")).toHaveText("trader");
    expect(await started(page)).toEqual({ user: "trader", region: "none", tab: "none", desk: "none" });
    expect(await page.evaluate(() => localStorage.getItem("desk:user"))).toBe("trader");
    expect((await context.cookies()).filter((cookie) => cookie.name === "desk-region")).toEqual([]);
    await expect(page).toHaveURL(/\/run\/quotes-desk$/);
  });
});

test.describe("the Session panel", () => {
  test("creates and chooses a preset, saying before the first field that presets aren't secret", async ({ page, db }) => {
    const { desk } = await buildQuotes(db, { saved: false });
    await page.goto(framedRun(desk));
    await waitForPage(page, "Quotes desk");
    await openTool(page, "session");
    await expect(session(page).locator("[data-session-note]")).toHaveText("Presets are stored unencrypted and visible to everyone who can open this application, so never put real secrets in them.");
    await expect(startWith(page).getByLabel("The application's own storage")).toBeChecked();

    await session(page).getByRole("button", { name: "New preset" }).click();
    const form = session(page).getByRole("form", { name: "New preset" });
    // The note comes before the first field.
    const [note, field] = await Promise.all([form.getByText("Presets are stored unencrypted").boundingBox(), form.getByLabel("Name", { exact: true }).first().boundingBox()]);
    expect(note!.y).toBeLessThan(field!.y);
    await expect(form.getByLabel("Name", { exact: true }).first()).toBeFocused();

    // A name is required.
    await form.getByRole("button", { name: "Create preset" }).click();
    await expect(form.locator("#preset-name")).toBeFocused();
    await expect(form).toContainText("Enter a name");

    await form.locator("#preset-name").fill("Admin user");
    const entries = form.getByRole("list", { name: "Entries" }).getByRole("listitem");
    await entries.nth(0).getByLabel("Name").fill("desk:user");
    await entries.nth(0).getByLabel("Value").fill('{"role":"admin"}');
    await form.getByRole("button", { name: "Add entry" }).click();
    await entries.nth(1).getByLabel("Kind").selectOption("cookie");
    await expect(form).toContainText("Cookies for the application's own domains, and HttpOnly cookies, can't be set");
    await entries.nth(1).getByLabel("Name").fill("desk-region");
    await entries.nth(1).getByLabel("Value").fill("london");
    await form.getByRole("button", { name: "Add entry" }).click();
    await entries.nth(2).getByLabel("Kind").selectOption("query");
    await entries.nth(2).getByLabel("Name").fill("desk");
    await entries.nth(2).getByLabel("Value").fill("fx");
    await form.getByRole("button", { name: "Create preset" }).click();
    await expect(form).toBeHidden();

    const row = session(page).locator('[data-preset="Admin user"]');
    await expect(row).toContainText("Changed");
    await expect(startWith(page).getByLabel("Admin user")).toBeVisible();
    await expect(startWith(page)).toContainText("1 local storage item · 1 cookie · 1 query parameter");
    await startWith(page).getByLabel("Admin user").check();
    await expect(application(page).locator("[data-startup-region]")).toHaveText("london");
  });

  test("another browser sees the preset but keeps its own choice, and edits someone else's preset", async ({ page, db, context, browser, baseURL }) => {
    const { desk, admin, presenter } = await deskWithAdmin(page, db, context);
    choosePreset(db, presenter.id, applicationIdOfSlug(db, "quotes-desk"), admin.publicId);
    const other = await visitorContext(browser, db, baseURL!);
    const visitorPage = await other.newPage();
    await visitorPage.goto(framedRun(desk));
    await waitForPage(visitorPage, "Quotes desk");
    expect((await started(visitorPage)).user).toBe("none");
    setDisplayName(db, (await workspaceOf(other, db)).id, "Visitor");
    await openTool(visitorPage, "session");
    await expect(startWith(visitorPage).getByLabel("The application's own storage")).toBeChecked();
    await expect(session(visitorPage).locator('[data-preset="Admin user"]')).toContainText("by Presenter");

    await session(visitorPage).getByRole("button", { name: "Edit Admin user" }).click();
    const form = session(visitorPage).getByRole("form", { name: "Edit Admin user" });
    await form.getByRole("list", { name: "Entries" }).getByRole("listitem").nth(1).getByLabel("Value").fill("new-york");
    await form.getByRole("button", { name: "Save preset" }).click();
    await expect(form).toBeHidden();
    await expect(session(visitorPage).locator('[data-preset="Admin user"]')).toContainText("by Visitor");
    expect(listPresets(db, applicationIdOfSlug(db, "quotes-desk"))[0]!.entries[1]).toEqual({ store: "cookie", name: "desk-region", value: "new-york" });

    // The presenter, who chose it, starts with the new value next time.
    await page.reload();
    await waitForPage(page, "Quotes desk");
    expect((await started(page)).region).toBe("new-york");
    await other.close();
  });

  test("refuses a stale edit, showing the newer entries, and applies an edit of the chosen preset at once", async ({ page, db, context }) => {
    const { admin, presenter } = await deskWithAdmin(page, db, context);
    choosePreset(db, presenter.id, applicationIdOfSlug(db, "quotes-desk"), admin.publicId);
    await page.reload();
    await waitForPage(page, "Quotes desk");
    await openTool(page, "session");
    await session(page).getByRole("button", { name: "Edit Admin user" }).click();
    const form = session(page).getByRole("form", { name: "Edit Admin user" });
    // Someone else saves first.
    editPreset(db, applicationIdOfSlug(db, "quotes-desk"), admin.publicId, admin.lockVersion, { ...ADMIN, entries: [...ADMIN.entries.slice(0, 2), { store: "query", name: "desk", value: "rates" }] }, "Visitor");
    const entries = form.getByRole("list", { name: "Entries" }).getByRole("listitem");
    await entries.nth(1).getByLabel("Value").fill("paris");
    await form.getByRole("button", { name: "Save preset" }).click();
    await expect(form).toContainText("Someone else changed this preset since you opened it. Its newer entries are shown; make your change again.");
    await expect(entries.nth(2).getByLabel("Value")).toHaveValue("rates");
    await expect(entries.nth(1).getByLabel("Value")).toHaveValue("london");

    // Saved from the newer version, the chosen preset applies again and the frame reloads with it.
    await entries.nth(1).getByLabel("Value").fill("new-york");
    await form.getByRole("button", { name: "Save preset" }).click();
    await expect(form).toBeHidden();
    await expect(application(page).locator("[data-startup-region]")).toHaveText("new-york");
    await expect(application(page).locator("[data-startup-desk]")).toHaveText("rates");
  });

  test("deletes for everyone after confirming, and a visitor who chose it starts with their own storage again", async ({ page, db, context, browser, baseURL }) => {
    const { desk, admin } = await deskWithAdmin(page, db, context);
    const other = await visitorContext(browser, db, baseURL!);
    const visitorPage = await other.newPage();
    await visitorPage.goto(framedRun(desk));
    await waitForPage(visitorPage, "Quotes desk");
    choosePreset(db, (await workspaceOf(other, db)).id, applicationIdOfSlug(db, "quotes-desk"), admin.publicId);
    await visitorPage.reload();
    await waitForPage(visitorPage, "Quotes desk");
    expect((await started(visitorPage)).user).toBe("admin");

    await openTool(page, "session");
    await session(page).getByRole("button", { name: "Delete Admin user" }).click();
    const confirmation = session(page).getByRole("group", { name: "Delete Admin user?" });
    await expect(confirmation).toContainText("Delete Admin user? It's removed for everyone who opens Quotes desk.");
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(session(page).locator('[data-preset="Admin user"]')).toBeVisible();
    await session(page).getByRole("button", { name: "Delete Admin user" }).click();
    await confirmation.getByRole("button", { name: "Delete preset" }).click();
    await expect(session(page).locator('[data-preset="Admin user"]')).toHaveCount(0);
    expect(listPresets(db, applicationIdOfSlug(db, "quotes-desk"))).toEqual([]);

    await visitorPage.reload();
    await waitForPage(visitorPage, "Quotes desk");
    expect(await started(visitorPage)).toEqual({ user: "none", region: "none", tab: "none", desk: "none" });
    expect(await visitorPage.evaluate(() => localStorage.getItem("desk:user"))).toBeNull();
    await other.close();
  });

  test("refuses the 21st preset and a frontend-registry name, saying why", async ({ page, db }) => {
    const { desk } = await buildQuotes(db, { saved: false });
    const id = applicationIdOfSlug(db, desk.application.slug);
    await page.goto(framedRun(desk));
    await waitForPage(page, "Quotes desk");
    await openTool(page, "session");
    await session(page).getByRole("button", { name: "New preset" }).click();
    let form = session(page).getByRole("form", { name: "New preset" });
    await form.locator("#preset-name").fill("Registry");
    const entry = form.getByRole("list", { name: "Entries" }).getByRole("listitem").first();
    await entry.getByLabel("Name").fill("frontend-registry:theme:quotes-desk");
    await form.getByRole("button", { name: "Create preset" }).click();
    await expect(entry).toContainText("That name belongs to the Frontend Registry, so a preset can't change it");
    await form.getByRole("button", { name: "Cancel" }).click();

    for (let index = 1; index <= 20; index++) createPreset(db, id, { name: `Preset ${index}`, entries: [{ store: "local", name: "n", value: String(index) }] }, null);
    await session(page).getByRole("button", { name: "New preset" }).click();
    form = session(page).getByRole("form", { name: "New preset" });
    await form.locator("#preset-name").fill("One more");
    await form.getByRole("list", { name: "Entries" }).getByRole("listitem").first().getByLabel("Name").fill("n");
    await form.getByRole("button", { name: "Create preset" }).click();
    await expect(form.getByRole("alert")).toContainText("An application can have 20 presets. Delete one first.");
  });
});
