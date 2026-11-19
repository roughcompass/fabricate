import type { Page } from "@playwright/test";
import { buildInitiative } from "../test/support/builders";
import { expect, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";
import { paths } from "./support/paths";

/** The feedback infrastructure, exercised through the component gallery's demos. */

const notifications = (page: Page) => page.getByRole("region", { name: "Notifications" });
const toasts = (page: Page) => notifications(page).getByRole("listitem");
const demo = (page: Page) => page.locator("[data-toast-demo]");

test.describe("toasts", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await page.goto("/design-system#feedback");
    // The demo buttons are client-only; a click before hydration does nothing.
    await waitForHydration(page);
  });

  test("dismisses a success toast after six seconds", async ({ page }) => {
    await demo(page).getByRole("button", { name: "Success" }).click();
    await expect(toasts(page)).toHaveText(["orders was added."]);
    await page.clock.runFor(5_000);
    await expect(toasts(page)).toHaveCount(1);
    await page.clock.runFor(1_500);
    await expect(toasts(page)).toHaveCount(0);
  });

  test("pauses dismissal while the pointer is over a toast", async ({ page }) => {
    await demo(page).getByRole("button", { name: "Success" }).click();
    await toasts(page).first().hover();
    await page.clock.runFor(10_000);
    await expect(toasts(page)).toHaveCount(1);
    await page.mouse.move(0, 0);
    await page.clock.runFor(6_500);
    await expect(toasts(page)).toHaveCount(0);
  });

  test("keeps warning and error toasts until they are dismissed", async ({ page }) => {
    await demo(page).getByRole("button", { name: "Warning" }).click();
    await demo(page).getByRole("button", { name: "Error" }).click();
    await page.clock.runFor(30_000);
    await expect(toasts(page)).toHaveCount(2);
    await toasts(page).filter({ hasText: "billing could not be added" }).getByRole("button", { name: "Dismiss notification" }).click();
    await expect(toasts(page)).toHaveText([/Added 3 of 5 selected Repositories/]);
  });

  test("shows at most three toasts and never the same event twice", async ({ page }) => {
    await demo(page).getByRole("button", { name: "Four at once" }).click();
    await expect(toasts(page)).toHaveCount(3);
    await expect(toasts(page)).toHaveText(["Toast 2", "Toast 3", "Toast 4"]);
    await page.clock.runFor(7_000);
    await demo(page).getByRole("button", { name: "Same event twice" }).click();
    await expect(toasts(page)).toHaveText(["Shown once per event."]);
  });

  test("runs a toast's action", async ({ page }) => {
    await demo(page).getByRole("button", { name: "With Undo" }).click();
    await toasts(page).getByRole("button", { name: "Undo" }).click();
    await expect(toasts(page)).toHaveText(["Control 2 was restored."]);
  });
});

test.describe("outcomes after a redirect", () => {
  test("show once, leave the address, and do not return on reload", async ({ page }) => {
    await page.goto("/design-system?notice=demo&tone=error");
    await expect(toasts(page)).toHaveText(["The demo action finished."]);
    await expect(page).toHaveURL(/\/design-system\?tone=error$/);
    await page.reload();
    await expect(page.getByText("Filtered to error")).toBeVisible();
    await expect(toasts(page)).toHaveCount(0);
  });

  test("never render text taken from the address", async ({ page }) => {
    await page.goto("/design-system?notice=%3Cb%3Einjected%3C%2Fb%3E&count=9&failed=9");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(toasts(page)).toHaveCount(0);
    await expect(page.getByText("injected")).toHaveCount(0);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("show the outcome in the page", async ({ page }) => {
      await page.goto("/design-system?notice=demo");
      await expect(page.getByRole("status").filter({ hasText: "The demo action finished." })).toBeVisible();
    });
  });
});

test("puts an alert raised by a client component in the page-alert slot", async ({ page }) => {
  await page.goto("/design-system#alert");
  // The trigger is client-only; a click before hydration does nothing.
  await waitForHydration(page);
  await page.getByRole("button", { name: "Raise a page alert" }).click();
  await expect(page.locator("#page-alerts").getByRole("alert")).toContainText("The Run was not started");
});

test.describe("confirmation dialogs", () => {
  test("close on Escape and Cancel without acting, and return focus to the trigger", async ({ page }) => {
    let browserDialogs = 0;
    page.on("dialog", () => void browserDialogs++);
    await page.goto("/design-system#dialog");
    const trigger = page.getByRole("button", { name: "Cancel Run" });
    const dialog = page.getByRole("dialog", { name: "Cancel Run #3?" });
    // Before JavaScript runs, the trigger submits the action directly; it opens the dialog once hydrated.
    await expect(trigger).toHaveAttribute("type", "button");

    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Completed Profiles are kept.");
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(/\/design-system#dialog$/);
    expect(browserDialogs).toBe(0);
  });

  test("run the action once confirmed", async ({ page }) => {
    await page.goto("/design-system#dialog");
    const trigger = page.getByRole("button", { name: "Publish v2" });
    // Before JavaScript runs, the trigger submits the action directly; it opens the dialog once hydrated.
    await expect(trigger).toHaveAttribute("type", "button");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Publish Engineering baseline v2?" });
    await expect(dialog).toContainText("from draft version 7");
    await dialog.getByRole("button", { name: "Publish v2" }).click();
    await expect(toasts(page)).toHaveText(["The confirmed action ran."]);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("submit the action directly", async ({ page }) => {
      await page.goto("/design-system#dialog");
      await page.getByRole("button", { name: "Publish v2" }).click();
      await expect(page.getByRole("status").filter({ hasText: "The confirmed action ran." })).toBeVisible();
    });
  });
});

test("moves focus to the first invalid field, or to the form alert", async ({ page }) => {
  await page.goto("/design-system#form-feedback");
  // Before hydration the form posts without JavaScript, and focus doesn't move.
  await waitForHydration(page);
  const form = page.getByRole("form", { name: "Focus demo" });
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(form.getByText("Enter a name.")).toHaveCount(1);

  await form.getByLabel("Name", { exact: true }).fill("stale");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form.getByRole("alert")).toBeFocused();
  await expect(form.getByRole("alert")).toContainText("changed by someone else");
});

test("shows the destination's skeleton while a navigation waits, then the page", async ({ page, db }) => {
  const initiative = buildInitiative(db, { name: "Checkout platform migration" });
  await page.goto(paths.assessments);
  // Hold the navigation's server request so the skeleton is observable.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route((url) => url.pathname === paths.assessment(initiative.publicId), async (route) => {
    await held;
    await route.continue();
  });

  await page.getByRole("link", { name: "Checkout platform migration" }).click();
  const skeleton = page.locator("main").getByLabel("Loading");
  await expect(skeleton).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Assessments" })).toBeHidden();
  release();
  await expect(page.getByRole("heading", { level: 1, name: "Checkout platform migration" })).toBeVisible();
  await expect(skeleton).toHaveCount(0);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("renders a large page in full on first load", async ({ page, db }) => {
    const initiative = buildInitiative(db, { name: "Checkout platform migration" });
    await page.goto(paths.assessment(initiative.publicId));
    await expect(page.getByRole("heading", { level: 1, name: "Checkout platform migration" })).toBeVisible();
    await expect(page.getByLabel("Loading")).toHaveCount(0);
  });
});

test("Unknown Assessment: a not-found page inside the shell links to its section's list", async ({ page, db: _db }) => {
  await page.goto("/runs/asm_doesnotexist0000");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1, name: "Run not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Assessments" })).toHaveAttribute("href", paths.assessments);
});

test("Unknown address: a not-found page inside the shell links to Home", async ({ page, db: _db }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", paths.home);
});

test.describe("an unexpected error", () => {
  test.use({ expectedErrors: [/Demo failure/] });

  test("Unexpected server error: the error page offers Try again and Home, without internal details", async ({ page }) => {
    await page.goto("/design-system/error-demo");
    const main = page.locator("main");
    await expect(main.locator("[data-shell-header]").getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", paths.home);
    await expect(main).not.toContainText("internal detail");
  });
});

// The guard must fail this test: the page throws an error nobody expected.
test.fail("fails a test when the page throws an unexpected error", async ({ page }) => {
  await page.goto("/design-system?inject=pageerror");
  await page.waitForTimeout(500);
});
