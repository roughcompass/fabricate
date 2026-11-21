import type { Page } from "@playwright/test";
import { applicationDefault } from "../src/lib/mocks/defaults";
import { allRules, findSet, listSets } from "../src/lib/mocks/records";
import { E2E_PREVIEWS } from "./support/env";
import { buildOrdersPortal, ordersPortalRemote } from "./support/fixture-app";
import { expect, test } from "./support/fixtures";
import { mockApplicationId, seedFailedCalls, seedMockSet, setDefault, unbuiltApplication } from "./support/mock-sets";
import { paths } from "./support/paths";
import { seeded } from "./support/applications";
import { visitorContext, workspaceOf } from "./support/running-app";
import { setDisplayName } from "../src/lib/workspaces/workspaces";

/*
 * An application's mock sets (add-mock-sets, tasks 5.1 to 5.4 and 5.7;
 * applications/mock-sets spec): the application page's section, a set's
 * page, the rule and set forms, starting a set from failed calls, deleting,
 * and the failed-calls alert.
 */

test.skip(!E2E_PREVIEWS, "Previews are off (E2E_PREVIEWS=0)");
test.setTimeout(120_000);

const section = (page: Page) => page.getByRole("region", { name: "Mock sets" });
const row = (page: Page, name: string) => section(page).locator(`tr[data-mock-set="${name}"]`);
const rule = (pattern: string, json: unknown = { ok: true }) => ({ pattern, responses: [{ json }] });

test.describe("the Mock sets section", () => {
  test("None yet: the empty state says what mock sets do, and offers Upload HAR", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    await page.goto(paths.application(slug));
    const empty = section(page);
    await expect(empty).toContainText("No mock sets");
    await expect(empty).toContainText("Mock sets answer the application's API calls in previews");
    await expect(empty.getByRole("link", { name: "Upload HAR" })).toHaveAttribute("href", paths.mockSetUpload(slug));
    // The overview names no default.
    await expect(page.locator("dl")).toContainText("Mock setNone");
  });

  test("Two sets: lists Errors, then Happy path marked Default, each with its rules, size, source, and last change", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    seedMockSet(db, slug, [rule("/v1/orders"), rule("/v1/accounts/:id")], { default: true, byName: "Presenter" });
    seedMockSet(db, slug, [rule("/v1/orders", { error: "Unavailable" })], { name: "Errors" });
    await page.goto(paths.application(slug));
    const rows = section(page).locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Errors");
    await expect(rows.nth(1)).toContainText(/Happy path\s*Default/);
    await expect(row(page, "Happy path")).toContainText("2");
    await expect(row(page, "Happy path")).toContainText("Written");
    await expect(row(page, "Happy path")).toContainText("by Presenter");
    await expect(page.locator("dl")).toContainText("Mock setHappy path");
    await expect(section(page).getByRole("link", { name: "Upload HAR" })).toBeVisible();
    await expect(section(page).getByRole("link", { name: "New mock set" })).toBeVisible();
  });

  test("Row actions: Set as default or Stop using as default, Export HAR, and Delete mock set", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    seedMockSet(db, slug, [rule("/v1/orders")], { default: true });
    seedMockSet(db, slug, [], { name: "Errors" });
    await page.goto(paths.application(slug));
    await row(page, "Errors").getByRole("button", { name: "Actions for Errors" }).click();
    await expect(page.getByRole("menu").or(page.locator("[popover]:popover-open")).getByRole("button")).toHaveText(["Set as default", "Delete mock set"]);
    await expect(page.locator("[popover]:popover-open").getByRole("link", { name: "Export HAR" })).toBeVisible();
    await page.keyboard.press("Escape");
    await row(page, "Happy path").getByRole("button", { name: "Actions for Happy path" }).click();
    await expect(page.locator("[popover]:popover-open").getByRole("button", { name: "Stop using as default" })).toBeVisible();
  });

  test("Setting the default, and Clearing the default", async ({ page, db }) => {
    const { slug, id } = unbuiltApplication(db);
    const happy = seedMockSet(db, slug, [rule("/v1/orders")]);
    await page.goto(paths.application(slug));
    await row(page, "Happy path").getByRole("button", { name: "Actions for Happy path" }).click();
    await page.locator("[popover]:popover-open").getByRole("button", { name: "Set as default" }).click();
    await expect(row(page, "Happy path")).toContainText("Default");
    await expect(page.locator("dl")).toContainText("Mock setHappy path");
    expect(applicationDefault(db, id)?.publicId).toBe(happy.publicId);

    await row(page, "Happy path").getByRole("button", { name: "Actions for Happy path" }).click();
    await page.locator("[popover]:popover-open").getByRole("button", { name: "Stop using as default" }).click();
    await expect(page.locator("dl")).toContainText("Mock setNone");
    expect(applicationDefault(db, id)).toBeNull();
  });

  test("Deleting from the section, and Cancelling", async ({ page, db }) => {
    const { slug, id } = unbuiltApplication(db);
    seedMockSet(db, slug, [rule("/v1/orders")], { default: true });
    seedMockSet(db, slug, [rule("/v1/orders", { error: true })], { name: "Errors" });
    await page.goto(paths.application(slug));
    const open = async () => {
      await row(page, "Errors").getByRole("button", { name: "Actions for Errors" }).click();
      await page.locator("[popover]:popover-open").getByRole("button", { name: "Delete mock set" }).click();
      return page.getByRole("dialog", { name: "Delete the mock set Errors?" });
    };
    const dialog = await open();
    await expect(dialog).toContainText("deleted for everyone who opens the application");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(row(page, "Errors")).toBeVisible();
    expect(listSets(db, id)).toHaveLength(2);

    await (await open()).getByRole("button", { name: "Delete mock set" }).click();
    await expect(row(page, "Errors")).toHaveCount(0);
    expect(listSets(db, id).map((set) => set.name)).toEqual(["Happy path"]);
  });
});

test.describe("a set's page", () => {
  test("Opening a set: 50 of 120 rules, each with its method, pattern, matching, responses, and state, with three pages", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    const set = seedMockSet(
      db,
      slug,
      Array.from({ length: 120 }, (_, index) => rule(`/v1/items/${index}`)),
      { default: true },
    );
    await page.goto(paths.mockSet(slug, set.publicId));
    await expect(page.getByRole("heading", { level: 1, name: "Happy path" })).toBeVisible();
    await expect(page.locator("[data-header-status]")).toHaveText("Default");
    await expect(page.getByText("120 rules ·")).toBeVisible();
    const rows = page.locator("tr[data-rule]");
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText("GET");
    await expect(rows.first()).toContainText("/v1/items/0");
    await expect(rows.first()).toContainText("Any query · Any body");
    await expect(rows.first()).toContainText("200");
    await expect(rows.first()).toContainText("On");
    const pagination = page.getByRole("navigation", { name: "Rules pages" });
    await expect(pagination.getByRole("link", { name: "3" })).toBeVisible();
    await pagination.getByRole("link", { name: "3" }).click();
    await expect(rows).toHaveCount(20);
    // New rule is the primary action, beside Upload HAR, Export HAR, and Edit mock set.
    await expect(page.getByRole("link", { name: "New rule" })).toBeVisible();
  });

  test("Rules that need a response: an alert says how many, and the state filter offers Needs a response", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    const set = seedMockSet(db, slug, [rule("/v1/orders"), { pattern: "/v1/rates" }, { pattern: "/v1/regions" }, { pattern: "/v1/settings" }]);
    await page.goto(paths.mockSet(slug, set.publicId));
    await expect(page.getByText("3 rules need a response")).toBeVisible();
    await page.getByLabel("State").selectOption("needs-response");
    await expect(page.locator("tr[data-rule]")).toHaveCount(3);
    await expect(page.locator("tr[data-rule]").first()).toContainText("Needs a response");
  });

  test("Equally specific: two enabled rules for GET /v1/accounts/:id, and the second is marked never reached", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    const set = seedMockSet(db, slug, [rule("/v1/accounts/:id", { first: true }), rule("/v1/accounts/:id", { second: true })]);
    await page.goto(paths.mockSet(slug, set.publicId));
    const rows = page.locator("tr[data-rule]");
    await expect(rows.nth(0)).toContainText("On");
    await expect(rows.nth(1)).toContainText("Never reached");
  });
});

test.describe("rule forms", () => {
  test("Writing a rule: GET /v1/accounts/:id with a JSON body is added at the end of the set, turned on", async ({ page, db }) => {
    const { slug, id } = unbuiltApplication(db);
    const set = seedMockSet(db, slug, [rule("/v1/orders")]);
    await page.goto(paths.newMockRule(slug, set.publicId));
    await page.getByLabel("Pattern").fill("/v1/accounts/:id");
    await page.locator("#response-0-body").fill('{"id":"42","name":"Northwind Traders"}');
    await page.getByRole("button", { name: "Create rule" }).click();
    await expect(page.getByText("The rule was added at the end of the set.").first()).toBeVisible();
    const rules = allRules(db, findSet(db, id, set.publicId)!.id);
    expect(rules.map((each) => [each.method, each.pattern, each.enabled, each.responses[0]?.status])).toEqual([
      ["GET", "/v1/orders", true, 200],
      ["GET", "/v1/accounts/:id", true, 200],
    ]);
  });

  test("Invalid JSON: focus moves to the body field, whose error says it isn't valid JSON", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    const set = seedMockSet(db, slug, []);
    await page.goto(paths.newMockRule(slug, set.publicId));
    await page.getByLabel("Pattern").fill("/v1/accounts/:id");
    await page.locator("#response-0-body").fill('{"id":"42"');
    await page.getByRole("button", { name: "Create rule" }).click();
    const body = page.locator("#response-0-body");
    await expect(body).toBeFocused();
    await expect(body).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("The body isn't valid JSON.")).toBeVisible();
  });

  test("A Set-Cookie header is refused, saying a mocked response can't set cookies", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    const set = seedMockSet(db, slug, []);
    await page.goto(paths.newMockRule(slug, set.publicId));
    await page.getByLabel("Pattern").fill("/v1/session");
    await page.getByLabel("Headers").fill("Set-Cookie: session=1");
    await page.getByRole("button", { name: "Create rule" }).click();
    await expect(page.getByText("A mocked response can't set cookies. Remove the Set-Cookie header.")).toBeVisible();
  });

  test("Two people edit one rule: the second save is refused, and the form shows the first visitor's response", async ({ page, browser, baseURL, db }) => {
    const { slug } = unbuiltApplication(db);
    const set = seedMockSet(db, slug, [rule("/v1/accounts/:id", { name: "Original" })]);
    const [created] = allRules(db, set.id);
    const visitor = await visitorContext(browser, db, baseURL!);
    const other = await visitor.newPage();
    await page.goto(paths.mockRule(slug, set.publicId, created!.publicId));
    await other.goto(paths.mockRule(slug, set.publicId, created!.publicId));
    await other.locator("#response-0-body").fill('{"name":"First"}');
    await other.getByRole("button", { name: "Save changes" }).click();
    await expect(other.getByText("The rule was saved.").first()).toBeVisible();
    await page.locator("#response-0-body").fill('{"name":"Second"}');
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Someone else changed this rule" })).toBeVisible();
    await expect(page.locator("#response-0-body")).toHaveValue('{"name":"First"}');
    await visitor.close();
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("works without JavaScript: writing, adding a response, and saving a rule", async ({ page, db }) => {
      const { slug, id } = unbuiltApplication(db);
      const set = seedMockSet(db, slug, []);
      await page.goto(paths.newMockRule(slug, set.publicId));
      await page.getByLabel("Pattern").fill("/v1/exports/9");
      await page.locator("#response-0-body").fill('{"status":"pending"}');
      await page.getByRole("button", { name: "Add response" }).click();
      await page.locator("#response-1-body").fill('{"status":"ready"}');
      await page.getByRole("button", { name: "Create rule" }).click();
      await expect(page.locator("tr[data-rule]")).toHaveCount(1);
      const [saved] = allRules(db, findSet(db, id, set.publicId)!.id);
      expect(saved!.responses).toHaveLength(2);
    });
  });
});

test.describe("set forms", () => {
  test("Duplicate name: the name field says another mock set of this application has that name", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    seedMockSet(db, slug, []);
    await page.goto(paths.newMockSet(slug));
    await page.getByLabel("Name").fill("happy path");
    await page.getByRole("button", { name: "Create mock set" }).click();
    await expect(page.getByText("Another mock set of this application has that name. Choose another.")).toBeVisible();
    await expect(page.getByLabel("Name")).toBeFocused();
  });

  test("The 11th set: the message says an application can have 10 mock sets, and to delete one first", async ({ page, db }) => {
    const { slug } = unbuiltApplication(db);
    for (let index = 0; index < 10; index++) seedMockSet(db, slug, [], { name: `Set ${index}` });
    await page.goto(paths.newMockSet(slug));
    await page.getByLabel("Name").fill("Another");
    await page.getByRole("button", { name: "Create mock set" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "An application can have 10 mock sets. Delete one first." })).toBeVisible();
  });

  test("Deleting the default from its edit page: typing its name deletes it, and the application has no default set", async ({ page, db }) => {
    const { slug, id } = unbuiltApplication(db);
    const set = seedMockSet(db, slug, [rule("/v1/orders")], { default: true });
    await page.goto(paths.mockSetEdit(slug, set.publicId));
    const danger = page.getByRole("region", { name: "Danger zone" });
    await danger.getByLabel("Type Happy path to confirm").fill("Happy");
    await danger.getByRole("button", { name: "Delete mock set" }).click();
    await expect(danger.getByLabel("Type Happy path to confirm")).toHaveAttribute("aria-invalid", "true");
    expect(listSets(db, id)).toHaveLength(1);
    await danger.getByLabel("Type Happy path to confirm").fill("Happy path");
    await danger.getByRole("button", { name: "Delete mock set" }).click();
    await expect(page).toHaveURL((url) => url.pathname === paths.application(slug));
    expect(listSets(db, id)).toEqual([]);
    expect(applicationDefault(db, id)).toBeNull();
  });

  test("Mapping two hosts: the edit page maps each recorded origin to the one the build calls", async ({ page, db }) => {
    const { slug, id } = unbuiltApplication(db);
    const set = seedMockSet(db, slug, [rule("/v1/config")]);
    await page.goto(paths.mockSetEdit(slug, set.publicId));
    await page.getByRole("radio", { name: /Map the hosts recorded/ }).check();
    await page.locator("#set-host-0-from").fill("https://dev-api.orders.test");
    await page.locator("#set-host-0-to").fill("https://api.orders.test");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Happy path was updated.").first()).toBeVisible();
    await page.goto(paths.mockSetEdit(slug, set.publicId));
    await page.locator("#set-host-1-from").fill("https://dev-auth.orders.test");
    await page.locator("#set-host-1-to").fill("https://auth.orders.test");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Happy path was updated.").first()).toBeVisible();
    expect(findSet(db, id, set.publicId)).toMatchObject({
      hostMode: "mapped",
      hosts: [
        { from: "https://dev-api.orders.test", to: "https://api.orders.test" },
        { from: "https://dev-auth.orders.test", to: "https://auth.orders.test" },
      ],
    });
  });
});

test.describe("the failed-calls alert", () => {
  const FAILED = [
    { url: "https://api.orders.test/v1/orders?limit=5&_=1763650000000", kind: "connect" as const, error: "net::ERR_NAME_NOT_RESOLVED" },
    { url: "https://api.orders.test/v1/orders/stream", kind: "connect" as const },
    { url: "https://api.orders.test/v1/rates", kind: "connect" as const },
    { url: "wss://api.orders.test/v1/ticker", kind: "websocket" as const },
  ];

  test("No mock set yet: 4 API calls failed when this build loaded, each listed, with Upload HAR and Start a mock set from these calls", async ({ page, db }) => {
    ordersPortalRemote();
    const { application } = await buildOrdersPortal(db);
    seedFailedCalls(db, application.slug, FAILED);
    await page.goto(paths.application(application.slug));
    const alert = page.locator("[data-failed-calls-actions]").locator("xpath=ancestor::*[@data-tone][1]");
    await expect(page.getByText("4 API calls failed when this build loaded", { exact: true })).toBeVisible();
    await alert.getByText("The 4 calls").click();
    await expect(alert.locator("[data-failed-call]")).toHaveCount(4);
    await expect(alert.locator('[data-failed-call="connect"]').first()).toContainText("Couldn't connect");
    await expect(alert.getByRole("link", { name: "Upload HAR" })).toBeVisible();

    // Starting from four failed calls: three are chosen, and each becomes a rule that needs a response.
    await alert.getByRole("link", { name: "Start a mock set from these calls" }).click();
    await expect(page.getByLabel(/wss:\/\/api.orders.test\/v1\/ticker/)).toBeDisabled();
    await page.getByLabel("Name").fill("From failed calls");
    await page.getByRole("button", { name: "Create mock set" }).click();
    await expect(page.getByText("3 rules need a response")).toBeVisible();
    const set = listSets(db, mockApplicationId(db, application.slug))[0]!;
    expect(allRules(db, set.id).map((each) => [each.pattern, each.enabled, each.responses.length])).toEqual([
      ["/v1/orders", false, 0],
      ["/v1/orders/stream", false, 0],
      ["/v1/rates", false, 0],
    ]);
  });

  test("With the default set: one API call failed when the build loaded with Happy path, offering to add rules to it; Dismissed", async ({ page, db }) => {
    ordersPortalRemote();
    const { application } = await buildOrdersPortal(db);
    const happy = seedMockSet(db, application.slug, [rule("/v1/orders")], { default: true });
    seedFailedCalls(db, application.slug, [{ url: "https://api.orders.test/v1/rates", kind: "connect" }], { set: happy });
    await page.goto(paths.application(application.slug));
    await expect(page.getByText('1 API call failed when this build loaded with "Happy path"')).toBeVisible();
    await page.getByRole("button", { name: "Add rules to Happy path" }).click();
    await expect(page.getByText("1 rule needs a response")).toBeVisible();

    // Dismissed: it doesn't show again for this build.
    await page.goto(paths.application(application.slug));
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText('1 API call failed when this build loaded with "Happy path"')).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(/API calls? failed when this build loaded/)).toHaveCount(0);
    // A later capture that recorded failures shows it again.
    seedFailedCalls(db, application.slug, [{ url: "https://api.orders.test/v1/rates", kind: "status", status: 503 }]);
    await page.reload();
    await expect(page.getByText("1 API call failed when this build loaded", { exact: true })).toBeVisible();
    setDefault(db, application.slug, null);
  });

  test("Add rules past the set's 500 adds none, and the set's page says why; added rules record who added them (add-mock-sets, task 13.1)", async ({ page, db, context }) => {
    seeded(db, "Orders portal");
    const id = mockApplicationId(db, "orders-portal");
    setDisplayName(db, (await workspaceOf(context, db)).id, "Presenter");
    const full = seedMockSet(db, "orders-portal", Array.from({ length: 499 }, (_, index) => ({ pattern: `/v1/items/${index}` })), { default: true });
    seedFailedCalls(db, "orders-portal", [{ url: "https://api.orders.test/v1/rates", kind: "connect" }, { url: "https://api.orders.test/v1/accounts/42", kind: "status", status: 503 }], { set: full });
    await page.goto(paths.application("orders-portal"));
    await page.getByRole("button", { name: "Add rules to Happy path" }).click();
    const notices = page.getByRole("region", { name: "Notifications" });
    await expect(notices.getByText("Rules for the failed calls couldn't be added.")).toBeVisible();
    await expect(notices.getByText("A mock set can have 500 rules. Delete rules it no longer needs first.")).toBeVisible();
    expect(findSet(db, id, full.publicId)!.ruleCount).toBe(499);

    // With room, each failed call becomes a rule, recorded with the display name of who added it.
    setDefault(db, "orders-portal", seedMockSet(db, "orders-portal", [], { name: "Errors" }).publicId);
    const errors = findSet(db, id, listSets(db, id).find((set) => set.name === "Errors")!.publicId)!;
    seedFailedCalls(db, "orders-portal", [{ url: "https://api.orders.test/v1/rates", kind: "connect" }], { set: errors });
    await page.goto(paths.application("orders-portal"));
    await page.getByRole("button", { name: "Add rules to Errors" }).click();
    await expect(page.getByText("1 rule needs a response")).toBeVisible();
    expect(allRules(db, errors.id).map((rule) => [rule.pattern, rule.createdByName])).toEqual([["/v1/rates", "Presenter"]]);
  });
});
