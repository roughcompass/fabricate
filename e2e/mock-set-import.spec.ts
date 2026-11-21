import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { applicationDefault } from "../src/lib/mocks/defaults";
import { allRules, listSets } from "../src/lib/mocks/records";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { seedMockSet, unbuiltApplication } from "./support/mock-sets";
import { paths } from "./support/paths";
import { visitorContext } from "./support/running-app";

/*
 * Uploading a HAR file into a mock set (add-mock-sets, task 5.5;
 * applications/mock-set-import spec): Upload HAR, then Review HAR, then
 * saving, for Chrome's, Firefox's, and Safari's exports, with everything a
 * review shows and every refusal.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(120_000);

const HAR = (name: string) => path.resolve("test/fixtures/har", name);
const SECRETS = ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln", "hunter2", "sk_test_123", "s3ss10n-f4k3-0001", "tok_f4k3_0002", "ak_live_f4k3k3y0001"];

/** Fills Upload HAR with +file+ and +name+, confirms unless told not to, and uploads. */
async function upload(page: Page, slug: string, file: string | { name: string; mimeType: string; buffer: Buffer }, options: { name?: string; confirm?: boolean; set?: string } = {}) {
  await page.goto(paths.mockSetUpload(slug, options.set ? { set: options.set } : undefined));
  await page.getByLabel("HAR file").setInputFiles(file);
  if (options.name !== undefined) await page.getByLabel("New mock set's name").fill(options.name);
  if (options.confirm !== false) await page.getByLabel("This recording holds only synthetic test data").check();
  await page.getByRole("button", { name: "Upload HAR" }).click();
}

const calls = (page: Page) => page.locator("[data-review-call]");

test("Reading the warning: above the file field, to use test environments with synthetic data only, and that personal data can't be recognized", async ({ page, db }) => {
  const { slug } = unbuiltApplication(db);
  await page.goto(paths.mockSetUpload(slug));
  const warning = page.getByText("Use recordings of test environments with synthetic data only").locator("xpath=ancestor::*[@data-tone][1]");
  await expect(warning).toContainText("Never upload real customer, employee, or account data");
  await expect(warning).toContainText("Mock sets are unencrypted, and everyone who can open the application can see them");
  await expect(warning).toContainText("can't recognize personal data");
});

test("Not confirmed: nothing is read, and focus moves to the confirmation, whose error says it's required", async ({ page, db }) => {
  const { slug, id } = unbuiltApplication(db);
  await upload(page, slug, HAR("orders-portal.chrome.har"), { name: "Happy path", confirm: false });
  const confirm = page.getByLabel("This recording holds only synthetic test data");
  await expect(confirm).toBeFocused();
  await expect(page.getByText("This confirmation is required.")).toBeVisible();
  expect(db.$client.prepare("select count(*) as n from mock_set_imports").get()).toEqual({ n: 0 });
  expect(listSets(db, id)).toEqual([]);
});

test("Uploading into a new set: Review HAR lists the calls it would keep, and Orders portal has no new set yet; Saving the review creates it", async ({ page, db }) => {
  const { slug, id } = unbuiltApplication(db);
  await upload(page, slug, HAR("orders-portal.chrome.har"), { name: "Happy path" });
  await expect(page.getByRole("heading", { level: 1, name: "Review HAR" })).toBeVisible();
  await expect(calls(page)).toHaveCount(11);
  expect(listSets(db, id)).toEqual([]);

  // Reviewing what was removed: headers by name, values redacted, and token-like values replaced, and each affected call says so.
  const summary = page.locator("[data-review-summary]");
  await expect(summary).toContainText("Headers dropped:");
  await expect(summary).toContainText("authorization (3)");
  await expect(summary).toContainText("cookie (3)");
  await expect(summary).toContainText("values redacted");
  await expect(summary).toContainText("1 token-like value replaced");
  await expect(page.getByRole("list", { name: "Removed from POST /v1/session" })).toContainText("1 token-like value replaced");

  // A page's assets, A WebSocket, and A call without a response are left out, each saying why.
  await page.getByText(/^Left out: 10 entries$/).click();
  const leftOut = page.getByRole("list", { name: "Left out" });
  await expect(leftOut.locator('[data-left-out="page-file"]')).toHaveCount(6);
  await expect(leftOut.locator('[data-left-out="websocket"]')).toContainText("WebSocket connections can't be mocked yet");
  await expect(leftOut.locator('[data-left-out="no-response"]')).toContainText("No response was recorded");

  // A binary body: listed unchecked, saying it can't be checked.
  const pdf = calls(page).filter({ hasText: "GET /v1/exports/9/file" });
  await expect(pdf.getByRole("checkbox")).not.toBeChecked();
  await expect(pdf).toContainText("Its body can't be checked for credentials or personal data.");
  // A polled export, Two searches, and A cache buster.
  await expect(calls(page).filter({ hasText: "GET /v1/exports/9" }).first()).toContainText("3 responses: 200, 200, 200");
  await expect(calls(page).filter({ hasText: "POST /v1/orders/search" })).toHaveCount(2);
  await expect(calls(page).filter({ hasText: "GET /v1/orders?limit=5" })).toContainText("Ignores _");
  // One host: the new set matches any host.
  await expect(page.getByRole("radio", { name: /Any host/ })).toBeChecked();
  await expect(page.getByLabel("The build calls, for https://dev-api.orders.test")).toBeVisible();

  // Unchecking a call: POST /v1/session isn't saved.
  await calls(page).filter({ hasText: "POST /v1/session" }).getByRole("checkbox").uncheck();
  await expect(page.getByLabel(/Make it the application's default mock set/)).toBeChecked();
  await page.getByRole("button", { name: "Create mock set" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Happy path" })).toBeVisible();
  const [set] = listSets(db, id);
  expect(set).toMatchObject({ name: "Happy path", source: "har", ruleCount: 9 });
  expect(applicationDefault(db, id)?.name).toBe("Happy path");
  expect(allRules(db, set!.id).map((rule) => rule.pattern)).not.toContain("/v1/session");
  // An Authorization header, a key in the query, and a password in a body: nothing stored holds them.
  const stored = JSON.stringify(db.$client.prepare("select * from mock_rules").all());
  for (const secret of SECRETS) expect(stored, secret).not.toContain(secret);
  const regions = allRules(db, set!.id).find((rule) => rule.pattern === "/v1/regions")!;
  expect([regions.queryMode, regions.queryIgnored]).toEqual(["ignore_listed", ["api_key"]]);
});

test("Adding to an existing set: its rules are added after the set's own", async ({ page, db }) => {
  const { slug } = unbuiltApplication(db);
  const happy = seedMockSet(db, slug, [{ pattern: "/v1/health", responses: [{ json: { ok: true } }] }]);
  await upload(page, slug, HAR("quotes-desk.har"), { set: happy.publicId });
  await expect(page.getByText("The kept calls are added after the rules of Happy path.")).toBeVisible();
  await page.getByRole("button", { name: "Add rules" }).click();
  await expect(page.getByText("The HAR file's rules were added to Happy path.").first()).toBeVisible();
  expect(allRules(db, happy.id).map((rule) => rule.pattern)).toEqual(["/v1/health", "/v1/desk"]);
});

test("Firefox's export, and Safari's: the review lists their API calls as for Chrome's", async ({ page, db }) => {
  const { slug } = unbuiltApplication(db);
  for (const browser of ["firefox", "safari"]) {
    await upload(page, slug, HAR(`orders-portal.${browser}.har`), { name: `From ${browser}` });
    await expect(calls(page), browser).toHaveCount(11);
    await expect(calls(page).filter({ hasText: "GET /v1/exports/9" }).first()).toContainText("3 responses");
    await page.getByRole("button", { name: "Cancel" }).click();
  }
});

test("Not a HAR file, and Too large: each is refused, saying why", async ({ page, db }) => {
  const { slug } = unbuiltApplication(db);
  await upload(page, slug, { name: "data.json", mimeType: "application/json", buffer: Buffer.from('{"items":[]}') }, { name: "Happy path" });
  await expect(page.getByText("This file isn't a HAR file. Export one from the browser's network panel")).toBeVisible();
  await expect(page.getByLabel("HAR file")).toBeFocused();
  // A 60 MB file, generated beside the test's other output.
  const large = test.info().outputPath("large.har");
  fs.writeFileSync(large, Buffer.alloc(60 * 1024 * 1024, 32));
  await upload(page, slug, large, { name: "Happy path" });
  await expect(page.getByText("A HAR file can have up to 50 MB. Export only the calls you need, or record a shorter session.")).toBeVisible();
  expect(db.$client.prepare("select count(*) as n from mock_set_imports").get()).toEqual({ n: 0 });
});

test("Exported without content: its calls are left out, and the review says to export the HAR with content", async ({ page, db }) => {
  const { slug } = unbuiltApplication(db);
  const har = JSON.parse(fs.readFileSync(HAR("orders-portal.chrome.har"), "utf8")) as { log: { entries: { response: { content: Record<string, unknown> } }[] } };
  for (const entry of har.log.entries) delete entry.response.content.text;
  await upload(page, slug, { name: "no-content.har", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(har)) }, { name: "Happy path" });
  await page.getByText(/^Left out:/).click();
  await expect(page.getByRole("list", { name: "Left out" }).locator('[data-left-out="no-content"]').first()).toContainText("Its body wasn't exported. Export the HAR with content.");
});

test("Two hosts with the same path: the review says the set needs mapped hosts, and asks which origin the build calls for each", async ({ page, db }) => {
  const { slug, id } = unbuiltApplication(db);
  await upload(page, slug, HAR("orders-portal.two-hosts.har"), { name: "Two hosts" });
  await expect(page.getByText("This set needs mapped hosts, because both origins answer GET /v1/config differently.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /The hosts below/ })).toBeChecked();
  await page.getByLabel("The build calls, for https://dev-api.orders.test").fill("https://api.orders.test");
  await page.getByLabel("The build calls, for https://dev-auth.orders.test").fill("https://auth.orders.test");
  await page.getByRole("button", { name: "Create mock set" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Two hosts" })).toBeVisible();
  expect(listSets(db, id)[0]).toMatchObject({ hostMode: "mapped", hosts: [{ from: "https://dev-api.orders.test", to: "https://api.orders.test" }, { from: "https://dev-auth.orders.test", to: "https://auth.orders.test" }] });
});

test("Cancelling the review: the draft is deleted, and no file of the upload remains; Another workspace finds no review", async ({ page, browser, baseURL, db }) => {
  const { slug } = unbuiltApplication(db);
  await upload(page, slug, HAR("orders-portal.chrome.har"), { name: "Happy path" });
  const review = page.url();
  const visitor = await visitorContext(browser, db, baseURL!);
  const other = await visitor.newPage();
  expect((await other.goto(review))?.status()).toBe(404);
  await visitor.close();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("The upload was cancelled.").first()).toBeVisible();
  expect(db.$client.prepare("select count(*) as n from mock_set_imports").get()).toEqual({ n: 0 });
  expect((await page.goto(review))?.status()).toBe(404);
});

test("A day later: the review's address says the upload expired, and to upload the file again", async ({ page, db }) => {
  const { slug } = unbuiltApplication(db);
  await upload(page, slug, HAR("quotes-desk.har"), { name: "Desk" });
  db.$client.prepare("update mock_set_imports set created_at = created_at - 90000000, expires_at = expires_at - 90000000").run();
  await page.reload();
  await expect(page.getByText("This upload expired after 24 hours. Upload the HAR file again.")).toBeVisible();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("uploads, pages through, and saves a review without JavaScript", async ({ page, db }) => {
    const { slug, id } = unbuiltApplication(db);
    const entries = Array.from({ length: 55 }, (_, index) => ({
      startedDateTime: new Date(Date.UTC(2026, 10, 19, 10, 0, index)).toISOString(),
      _resourceType: "fetch",
      request: { method: "GET", url: `https://dev-api.orders.test/v1/items/${index}`, headers: [], cookies: [] },
      response: { status: 200, headers: [], cookies: [], content: { mimeType: "application/json", size: 2, text: "{}" } },
    }));
    await upload(page, slug, { name: "items.har", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ log: { version: "1.2", entries } })) }, { name: "Items" });
    await expect(calls(page)).toHaveCount(50);
    await calls(page).filter({ hasText: "GET /v1/items/0" }).getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(calls(page)).toHaveCount(5);
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(calls(page).filter({ hasText: "GET /v1/items/0" }).getByRole("checkbox")).not.toBeChecked();
    await page.getByRole("button", { name: "Create mock set" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Items" })).toBeVisible();
    expect(listSets(db, id)[0]!.ruleCount).toBe(54);
  });
});
