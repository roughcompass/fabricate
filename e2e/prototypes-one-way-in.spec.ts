import { expect, test } from "./support/fixtures";
import { acceptTemplate, keepOne } from "./support/prototypes";

// converge-templates-and-prototypes, design decision 9: the searched gallery and New prototype share one flow.

test.describe("Generate prototypes from the searched gallery", () => {
  test("offers Generate prototypes beside matching templates, carrying the description into New prototype as its intent", async ({ page, db: _db }) => {
    await page.goto("/templates?q=payments+approval+queue");

    const offer = page.locator("[data-generate-prototypes]");
    await expect(offer).toContainText("None of these? Generate Salt prototypes for “payments approval queue”.");
    await offer.getByRole("link", { name: "Generate prototypes" }).click();
    await page.waitForURL(/\/prototypes\/new\?intent=payments\+approval\+queue$/);
    await expect(page.getByLabel("Intent")).toHaveValue("payments approval queue");
  });

  test("offers Generate prototypes in the empty state when no template matches", async ({ page, db: _db }) => {
    await page.goto("/templates?q=zebra+quokka+xylophone");
    await expect(page.getByText("No templates match")).toBeVisible();
    await expect(page.locator("[data-generate-prototypes]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Generate prototypes" })).toHaveAttribute("href", "/prototypes/new?intent=zebra+quokka+xylophone");
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
  });

  test("offers nothing to generate while Prototypes is disabled", async ({ page, db: _db }) => {
    const response = await page.request.post("/api/test/prototypes/settings", { data: { enabled: false } });
    expect(response.status()).toBe(200);

    await page.goto("/templates?q=payments");
    await expect(page.getByText(/^Showing \d+ of/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Generate prototypes" })).toHaveCount(0);
    await page.goto("/templates?q=zebra+quokka+xylophone");
    await expect(page.getByText("No templates match")).toBeVisible();
    await expect(page.getByRole("link", { name: "Generate prototypes" })).toHaveCount(0);
  });
});

test.describe("Matching templates on New prototype", () => {
  test("offers an accepted template matching the intent, and Start from this attaches it, keeping the intent (Intent matches a template)", async ({ page, db: _db }) => {
    await keepOne(page);
    await acceptTemplate(page, { title: "Urgent payments queue", tags: "Payments, Approvals" });

    await page.goto("/prototypes/new?intent=payments+approval+queue");
    const matches = page.getByRole("region", { name: "Matching templates" });
    // The accepted template and the Payments hero, a real Salt application, match; illustrative built-ins such as Payment status tracker are never offered.
    await expect(matches.locator("[data-template-match]")).toHaveCount(2);
    await expect(matches).toContainText("Urgent payments queue v1");
    await expect(matches).toContainText("Payments workspace v3.2.0");
    await expect(matches).not.toContainText("Payment status tracker");
    await matches.getByRole("link", { name: "Start from Urgent payments queue" }).click();
    await page.waitForURL(/\/prototypes\/new\?template=ptp_[a-z0-9]{16}&intent=payments\+approval\+queue$/);
    await expect(page.locator("[data-form-note]").filter({ hasText: "Starting from Urgent payments queue v1" })).toBeVisible();
    await expect(page.getByLabel("Intent")).toHaveValue("payments approval queue");
    await expect(page.getByRole("region", { name: "Matching templates" })).toHaveCount(0);
  });

  test("updates the matches as the intent changes, and leaves Generate unchanged when none match (No match)", async ({ page, db: _db }) => {
    await keepOne(page);
    await acceptTemplate(page, { title: "Urgent payments queue", tags: "Payments, Approvals" });

    await page.goto("/prototypes/new");
    await expect(page.getByRole("region", { name: "Matching templates" })).toHaveCount(0);
    await page.getByLabel("Intent").fill("Approve urgent payments");
    await page.getByLabel("Intent").blur();
    await expect(page.getByRole("region", { name: "Matching templates" })).toContainText("Urgent payments queue v1");

    await page.getByLabel("Intent").fill("Plan the zebra quokka xylophone rota");
    await page.getByLabel("Intent").blur();
    await expect(page.getByRole("region", { name: "Matching templates" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();
    await expect(page.getByRole("group", { name: "Variants" }).getByRole("radio")).toHaveCount(6);
  });

  test("never offers a Broken template", async ({ page, db: _db }) => {
    await keepOne(page);
    await acceptTemplate(page, { title: "Urgent payments queue", tags: "Payments, Approvals" });
    await page.goto("/templates?origin=prototypes");
    await page.getByRole("link", { name: "Urgent payments queue" }).click();
    await page.waitForURL(/\/templates\/urgent-payments-queue-[a-z0-9]{6}$/);
    const slug = new URL(page.url()).pathname.split("/").at(-1)!;
    const response = await page.request.post("/api/test/prototypes/template", { data: { slug, code: 'import { Button } from "@salt-ds/core";\nexport default function Page() {\n  return <Button madeUpProperty="yes">Approve</Button>;\n}\n' } });
    expect(response.status()).toBe(200);
    await expect(async () => {
      await page.goto("/templates?origin=prototypes");
      await expect(page.locator("li").filter({ has: page.getByRole("link", { name: "Urgent payments queue" }) })).toContainText("Broken on Salt");
    }).toPass({ timeout: 30_000 });

    await page.goto("/prototypes/new?intent=payments+approval+queue");
    await expect(page.getByLabel("Intent")).toHaveValue("payments approval queue");
    // The Payments hero still matches; the Broken template doesn't.
    const matches = page.getByRole("region", { name: "Matching templates" });
    await expect(matches.locator("[data-template-match]")).toHaveCount(1);
    await expect(matches).toContainText("Payments workspace");
    await expect(matches).not.toContainText("Urgent payments queue");
  });
});
