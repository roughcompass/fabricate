import { expect, test } from "./support/fixtures";
import runtime from "../src/lib/prototypes/runtime-manifest.json" with { type: "json" };
import { acceptTemplate, keepOne, previewFrame, waitForFrame } from "./support/prototypes";

/** The Salt release DE FabLab renders and checks with. */
const SALT = runtime.packages["@salt-ds/core"];

// template-gallery spec: templates accepted from prototypes in Salt Patterns; demo-mode spec: reset keeps them.

const toasts = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Notifications" });

test("shows an accepted prototype as the 17th template, with its badges, Origin filter, detail, and preview (Gallery with an accepted prototype; Card for an accepted prototype; From Prototypes origin; Community includes accepted templates)", async ({ page, db: _db }) => {
  await page.goto("/templates");
  await expect(page.getByText("Showing 16 of 16 templates")).toBeVisible();
  await expect(page.getByRole("group", { name: /Origin/ })).toHaveCount(0);

  await keepOne(page);
  await acceptTemplate(page, { title: "Urgent payments queue" });

  await page.goto("/templates");
  await expect(page.getByText("Showing 17 of 17 templates")).toBeVisible();
  const card = page.locator("li").filter({ has: page.getByRole("link", { name: "Urgent payments queue" }) });
  await expect(card).toContainText("From Prototypes");
  await expect(card).toContainText("Accepted by Anonymous visitor (unverified)");
  await expect(card).toContainText("v1");
  await expect(card).toContainText("Payments");
  const image = card.getByRole("img");
  // Cards below the fold load their images lazily.
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveAttribute("src", /\/api\/prototypes\/templates\/ptp_[a-z0-9]{16}\/preview/);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1280);

  await expect(page.getByRole("group", { name: /Provider/ }).getByText("Prototypes")).toHaveCount(0);
  await page.getByRole("group", { name: /Origin/ }).getByRole("checkbox", { name: /From Prototypes/ }).check();
  await expect(page).toHaveURL(/origin=prototypes/);
  await expect(page.getByText("Showing 1 of 17 templates")).toBeVisible();
  await page.getByRole("link", { name: "Clear", exact: true }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await page.getByRole("group", { name: /Provider/ }).getByRole("checkbox", { name: /Community/ }).check();
  await expect(page).toHaveURL(/provider=community/);
  await expect(page.getByRole("link", { name: "Urgent payments queue" })).toBeVisible();
  await page.goto("/templates?origin=prototypes");

  await card.getByRole("link", { name: "Urgent payments queue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Urgent payments queue" })).toBeVisible();
  const overview = page.locator("dl").first();
  await expect(overview).toContainText("Community");
  await expect(overview).toContainText("From Prototypes");
  await expect(overview).toContainText("v1, from Exception-first queue v1");
  await expect(overview).toContainText("Anonymous visitor (unverified)");
  await expect(overview).toContainText(`Salt ${SALT}`);
  await expect(overview).toContainText("Maya Lindqvist, Treasury payments approver");
  await expect(overview).toContainText("Checks passed");
  await expect(page.getByRole("link", { name: "Deploy template" })).toHaveCount(0);

  await page.getByRole("link", { name: "Preview template" }).click();
  await expect(page.getByRole("link", { name: "Back to Urgent payments queue" })).toBeVisible();
  await waitForFrame(page);
  await expect(previewFrame(page).getByRole("heading", { level: 1 })).toHaveText(/Exception-first queue/);
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Dark" }).click();
  await expect(previewFrame(page).locator("html")).toHaveAttribute("data-mode", "dark");
});

test("starts a new prototype from a template, recording its template version and leaving the template unchanged (Using a template from a prototype)", async ({ page, db: _db }) => {
  const original = await keepOne(page);
  await acceptTemplate(page, { title: "Urgent payments queue" });
  await page.goto("/templates?origin=prototypes");
  await page.getByRole("link", { name: "Urgent payments queue" }).click();
  await page.waitForURL(/\/templates\/urgent-payments-queue-[a-z0-9]{6}$/);
  const detail = page.url();
  await page.getByRole("button", { name: "Use template" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/prototypes/pro_") && url.pathname !== new URL(original).pathname);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Urgent payments queue");
  await expect(toasts(page).getByText("Started from the template Urgent payments queue v1.")).toBeVisible();
  await expect(page.locator("[data-version-chip]")).toHaveCount(1);
  await page.getByRole("link", { name: "Provenance" }).click();
  await expect(page.locator("[data-provenance]")).toContainText("Started from the template Urgent payments queue v1");

  await page.goto(detail);
  await expect(page.locator("dl").first()).toContainText("v1, from Exception-first queue v1");
  await expect(page.locator("[data-template-version]")).toHaveCount(1);
  await page.goto("/templates");
  await expect(page.getByText("Showing 17 of 17 templates")).toBeVisible();
});

test("keeps the template in the gallery when its prototype is deleted (Deleting an accepted prototype)", async ({ page, db: _db }) => {
  const prototype = await keepOne(page);
  await acceptTemplate(page, { title: "Urgent payments queue" });
  await page.goto(prototype);
  await page.getByText("Rename or delete").click();
  await page.getByRole("button", { name: "Delete prototype" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete prototype" }).click();
  await page.waitForURL(/\/prototypes(\?|$)/);
  await page.goto("/templates");
  await expect(page.getByText("Showing 17 of 17 templates")).toBeVisible();
  await page.getByRole("link", { name: "Urgent payments queue" }).click();
  await page.getByRole("link", { name: "Preview template" }).click();
  await waitForFrame(page);
});

test("leaves accepted templates in place when the template demo is reset (Reset keeps accepted templates)", async ({ page, db: _db }) => {
  await keepOne(page);
  await acceptTemplate(page, { title: "Urgent payments queue" });
  await page.goto("/new");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("dialog", { name: "Reset the demo?" }).getByRole("button", { name: "Reset demo" }).click();
  await expect(toasts(page).getByText("The demo was reset.")).toBeVisible();
  await page.goto("/templates");
  await expect(page.getByText("Showing 17 of 17 templates")).toBeVisible();
  await expect(page.getByRole("link", { name: "Urgent payments queue" })).toBeVisible();
});

test("keeps a template that no longer typechecks after a Salt upgrade listed as Broken, with Use template unavailable (Salt removes a property a template uses)", async ({ page, db: _db }) => {
  await keepOne(page);
  await acceptTemplate(page, { title: "Urgent payments queue" });
  await page.goto("/templates?origin=prototypes");
  await page.getByRole("link", { name: "Urgent payments queue" }).click();
  await page.waitForURL(/\/templates\/urgent-payments-queue-[a-z0-9]{6}$/);
  const slug = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByRole("button", { name: "Use template" })).toBeEnabled();

  // As if Salt removed a property the template uses.
  const response = await page.request.post("/api/test/prototypes/template", { data: { slug, code: "import { Button } from \"@salt-ds/core\";\nexport default function Page() {\n  return <Button madeUpProperty=\"yes\">Approve</Button>;\n}\n" } });
  expect(response.status()).toBe(200);
  // The first request after the upgrade starts the re-check, and a later one shows its result.
  await expect(async () => {
    await page.goto("/templates?origin=prototypes");
    await expect(page.locator("li").filter({ has: page.getByRole("link", { name: "Urgent payments queue" }) })).toContainText(`Broken on Salt ${SALT}`);
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText("Showing 1 of 17 templates")).toBeVisible();
  await page.getByRole("link", { name: "Urgent payments queue" }).click();
  await expect(page.getByText(`Broken on Salt ${SALT}`).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Use template" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Generate variations" })).toHaveCount(0);
  await expect(page.getByText(/fails the typecheck gate/)).toBeVisible();
  await expect(page.locator("[data-recheck-failures]")).toContainText("madeUpProperty");
});

test("opens New prototype with the template attached from Generate variations, while Use template still copies it (Generate variations attaches a template)", async ({ page, db: _db }) => {
  await keepOne(page);
  await acceptTemplate(page, { title: "Urgent payments queue" });
  await page.goto("/templates?origin=prototypes");
  await page.getByRole("link", { name: "Urgent payments queue" }).click();
  await page.waitForURL(/\/templates\/urgent-payments-queue-[a-z0-9]{6}$/);
  const detail = page.url();

  await page.getByRole("link", { name: "Generate variations" }).click();
  await page.waitForURL(/\/prototypes\/new\?template=ptp_[a-z0-9]{16}$/);
  const attached = page.locator("[data-form-note]").filter({ hasText: "Starting from Urgent payments queue v1" });
  await expect(attached).toContainText("The template is variant 0");
  const variants = page.getByRole("group", { name: "Variants" });
  await expect(variants.getByRole("radio")).toHaveCount(5);
  await expect(variants.getByRole("radio", { name: "1", exact: true })).toHaveCount(0);
  await expect(variants.getByRole("radio", { name: "3", exact: true })).toBeChecked();
  await expect(page.getByRole("group", { name: "Scope" })).toHaveCount(0);
  await attached.getByRole("link", { name: "Remove" }).click();
  await page.waitForURL(/\/prototypes\/new$/);
  await expect(page.locator("[data-attached-template]")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Variants" }).getByRole("radio")).toHaveCount(6);

  // Use template is unchanged: a copy, with no generation.
  await page.goto(detail);
  await page.getByRole("button", { name: "Use template" }).click();
  await page.waitForURL(/\/prototypes\/pro_[a-z0-9]{16}/);
  await expect(toasts(page).getByText("Started from the template Urgent payments queue v1.")).toBeVisible();
});
