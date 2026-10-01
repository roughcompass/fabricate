import { visitorContext, waitForRegions } from "./support/demo";
import { expect, test } from "./support/fixtures";

/**
 * The presenter storyline in one flow (docs/template-demo.md): from the create
 * page to a deployed application, its toolbar, and a reset. Run it three
 * times in a row (`--repeat-each=3`) to rehearse: every run is identical.
 */
test("runs the presenter storyline from the create page to a reset", async ({ page, context, browser, baseURL, db }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // The create page, opened from the Templates navigation item.
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Templates" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Let's build something new" })).toBeVisible();

  // Build your solution: Payments is chosen, its hero first; Browse all keeps the brand.
  const solutions = page.getByRole("list", { name: "Payments templates" }).getByRole("heading");
  await expect(solutions.first()).toHaveText("Payments workspace");
  await page.getByRole("link", { name: "Browse all Payments templates" }).click();
  await expect(page).toHaveURL(/\/templates\?brand=payments$/);
  await expect(page.getByRole("checkbox", { name: /^Payments/ })).toBeChecked();

  // The template detail page, then preview mode.
  await page.getByRole("article").filter({ hasText: "Payments workspace" }).getByRole("link", { name: "Payments workspace" }).click();
  await expect(page).toHaveURL(/\/templates\/payments-workspace$/);
  await page.getByRole("link", { name: "Preview template" }).click();
  await expect(page).toHaveURL(/\/templates\/payments-workspace\/preview$/);
  await page.getByRole("group", { name: "Device" }).getByRole("button", { name: "Tablet" }).click();
  await expect(page.locator("[data-frame-size]")).toHaveText("820 × 1180");
  const frame = (await (await page.locator("[data-preview-frame]").elementHandle())!.contentFrame())!;
  await frame.waitForSelector('[data-demo-mfe="payee-list"][data-demo-state="ready"]');
  await page.getByRole("navigation", { name: "Preview mode" }).getByRole("link", { name: "Code" }).click();
  await page.getByRole("navigation", { name: "Files" }).getByRole("link", { name: "microfrontends.json" }).click();
  await expect(page.getByRole("figure", { name: "microfrontends.json" })).toContainText('"payee-list"');
  await page.locator("[data-scaffold-command]").getByRole("button", { name: "Copy command" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npx @deweb/create-app@latest my-app --template payments-workspace");

  // Deploy to a sandbox, skip the build, and visit the application.
  await page.getByRole("link", { name: "Deploy template" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Deploy Payments workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page).toHaveURL(/\/applications\/app_[a-z0-9]{16}$/);
  await page.getByRole("button", { name: "Skip build" }).click();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
  const [app] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: /Visit application/ }).click()]);
  await app.waitForLoadState("domcontentloaded");
  await waitForRegions(app);
  await expect(app.locator("[data-demo-portal]")).toHaveAttribute("data-shell", "access");

  // Audit, swap the payee list to its fixed version, and audit again.
  await app.getByRole("button", { name: "Open accessibility audit" }).click();
  const audit = app.getByRole("dialog", { name: "Accessibility" });
  await audit.getByRole("button", { name: "Run audit" }).click();
  await expect(audit.locator("[data-audit-result]")).toHaveCount(3);
  await expect(audit.getByRole("button", { name: /Form elements must have labels/ })).toBeVisible();

  await app.getByRole("button", { name: "Open microfrontends" }).click();
  const microfrontends = app.getByRole("dialog", { name: "Microfrontends" });
  await microfrontends.locator('[data-member="payee-list"]').click();
  await microfrontends.getByRole("radio", { name: /^2\.0\.0/ }).check();
  await microfrontends.getByRole("button", { name: "Reload preview" }).click();
  await expect(app.locator('[data-demo-mfe="payee-list"]')).toHaveAttribute("data-demo-version", "2.0.0");
  await waitForRegions(app);

  await app.getByRole("button", { name: "Open accessibility audit" }).click();
  await expect(audit.locator("[data-audit-stale]")).toBeVisible();
  await audit.getByRole("button", { name: "Run audit again" }).click();
  await expect(audit.getByRole("status")).toHaveText("No violations found.");
  await app.keyboard.press("Escape");

  // Comment on Send payment, then share the view.
  await app.keyboard.press("c");
  await app.locator('[data-demo-anchor="send-payment"]').click();
  const composer = app.getByRole("dialog", { name: "New comment" });
  await composer.getByLabel("Your name").fill("Sam Rivera");
  await composer.getByLabel("Comment", { exact: true }).fill("Make this the primary action");
  await composer.getByRole("button", { name: "Post comment" }).click();
  await expect(app.locator('[data-comment-pin="1"]')).toBeVisible();
  await app.getByRole("button", { name: "Open sharing" }).click();
  const link = await app.getByRole("dialog", { name: "Share" }).getByLabel("Link to this view").inputValue();

  // A colleague opens the link in their own browser and replies.
  const colleague = await visitorContext(browser, db, baseURL!);
  const recipient = await colleague.newPage();
  await recipient.goto(link);
  await waitForRegions(recipient);
  await expect(recipient.locator('[data-demo-mfe="payee-list"]')).toHaveAttribute("data-demo-version", "2.0.0");
  await recipient.locator('[data-comment-pin="1"]').click();
  const thread = recipient.getByRole("dialog", { name: "Comment 1" });
  await thread.getByLabel("Your name").fill("Robin Chen");
  await thread.getByLabel("Reply").fill("Agreed, ship it");
  await thread.getByRole("button", { name: "Post reply" }).click();
  await expect(thread).toContainText("Agreed, ship it");

  await app.reload();
  await waitForRegions(app);
  await app.locator('[data-comment-pin="1"]').click();
  await expect(app.getByRole("dialog", { name: "Comment 1" })).toContainText("Agreed, ship it");

  // Reset the demo: the application, its comments, and the share link are gone.
  await page.goto("/new");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("dialog", { name: "Reset the demo?" }).getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("The demo was reset.")).toBeVisible();
  await page.goto("/applications");
  await expect(page.getByText("No applications yet")).toBeVisible();
  expect((await recipient.request.get(link)).status()).toBe(404);
  await colleague.close();
});
