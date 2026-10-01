import type { Page } from "@playwright/test";
import { visitorContext, waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/** Two visitors' workspaces never mix (template-demo/demo-mode spec). */

async function deploy(page: Page, slug: string, name: string): Promise<string> {
  await page.goto(`/templates/${slug}/deploy`);
  await page.getByLabel("Application name").fill(name);
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page).toHaveURL(/\/applications\/app_[a-z0-9]{16}$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

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

async function applicationNames(page: Page): Promise<string[]> {
  await page.goto("/applications");
  if (await page.getByText("No applications yet").count()) return [];
  return page.getByRole("table", { name: "Applications" }).locator("tbody tr td:first-child a").allTextContents();
}

test("keeps two visitors' applications, comments, and resets apart", async ({ page, browser, baseURL, db }) => {
  test.setTimeout(180_000);
  const other = await visitorContext(browser, db, baseURL!);
  const second = await other.newPage();

  // Each visitor creates an application and comments on it and on a reference deployment.
  const mine = await deploy(page, "payments-workspace", "Alex payments");
  const theirs = await deploy(second, "market-watch", "Blake desk");
  await page.getByRole("button", { name: "Skip build" }).click();
  await second.getByRole("button", { name: "Skip build" }).click();
  await comment(page, `/run/${mine}`, "send-payment", "Alex on their own application", "Alex");
  await comment(second, `/run/${theirs}`, "order-symbol", "Blake on their own application", "Blake");
  await comment(page, "/run/ref-market-watch", "order-symbol", "Alex on the reference deployment", "Alex");
  await comment(second, "/run/ref-payments-workspace", "send-payment", "Blake on the reference deployment", "Blake");

  // Neither sees the other's applications.
  expect(await applicationNames(page)).toEqual(["Alex payments"]);
  expect(await applicationNames(second)).toEqual(["Blake desk"]);
  for (const [visitor, id] of [[page, theirs], [second, mine]] as const) {
    expect((await visitor.goto(`/applications/${id}`))?.status()).toBe(404);
    expect((await visitor.goto(`/run/${id}`))?.status()).toBe(404);
  }

  // Comments on a reference deployment stay private to the workspace that wrote them.
  expect(await pins(page, "/run/ref-market-watch")).toBe(1);
  expect(await pins(second, "/run/ref-market-watch")).toBe(0);
  expect(await pins(second, "/run/ref-payments-workspace")).toBe(1);
  expect(await pins(page, "/run/ref-payments-workspace")).toBe(0);
  const threads = await page.request.get(`/api/demo/threads?application=${theirs}`);
  expect(threads.status()).toBe(404);

  // One visitor's reset leaves the other's work alone.
  await page.goto("/new");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("dialog", { name: "Reset the demo?" }).getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("The demo was reset.")).toBeVisible();
  expect(await applicationNames(page)).toEqual([]);
  expect(await pins(page, "/run/ref-market-watch")).toBe(0);

  expect(await applicationNames(second)).toEqual(["Blake desk"]);
  expect(await pins(second, `/run/${theirs}`)).toBe(1);
  expect(await pins(second, "/run/ref-payments-workspace")).toBe(1);
  await other.close();
});
