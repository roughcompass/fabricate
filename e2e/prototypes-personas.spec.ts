import { expect, test } from "./support/fixtures";
import { generate } from "./support/prototypes";

// prototypes/personas spec: the persona library.

test("lists the five seeded example personas in a new workspace (Seeded personas)", async ({ page, db: _db }) => {
  await page.goto("/prototypes/personas");
  const rows = page.getByRole("table", { name: "Personas" }).getByRole("row");
  await expect(rows).toHaveCount(6);
  for (const role of ["Treasury payments approver", "Group treasurer", "FX and rates sales-trader", "Client onboarding (KYC) analyst", "Corporate relationship banker"]) await expect(page.getByRole("table", { name: "Personas" })).toContainText(role);
  await expect(page.getByText("Example", { exact: true })).toHaveCount(5);
});

test("creates a persona and lists it (Creating a persona)", async ({ page, db: _db }) => {
  await page.goto("/prototypes/personas/new");
  await page.getByLabel("Name").fill("Priya, payments approver");
  await page.getByLabel("Role").fill("Treasury payments approver");
  await page.getByLabel("Goals").fill("Release today's urgent payments before the 3pm cut-off");
  await page.getByLabel("Constraints").fill("Four-eyes approval on payments over USD 1m");
  await page.getByRole("button", { name: "Create persona" }).click();
  await page.waitForURL(/\/prototypes\/personas\?notice=created/);
  await expect(page.getByRole("link", { name: "Priya, payments approver" })).toBeVisible();
  await expect(page.getByText("Priya, payments approver was added.").first()).toBeVisible();
});

test("refuses a persona with no goals and saves nothing (Missing goal)", async ({ page, db: _db }) => {
  await page.goto("/prototypes/personas/new");
  await page.getByLabel("Name").fill("Priya, payments approver");
  await page.getByLabel("Role").fill("Treasury payments approver");
  await page.getByRole("button", { name: "Create persona" }).click();
  await expect(page.getByLabel("Goals")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Add at least one goal.")).toBeVisible();
  await page.goto("/prototypes/personas");
  await expect(page.getByRole("link", { name: "Priya, payments approver" })).toHaveCount(0);
});

test("removes a deleted persona from the composer, and its prototypes still name it (Deleting a persona in use)", async ({ page, db: _db }) => {
  await generate(page, { intent: "Review and release today's urgent payments before cut-off", personas: ["Maya Lindqvist"], variants: 1 });
  await page.getByRole("button", { name: "Keep" }).click();
  await page.goto("/prototypes/personas");
  await page.getByRole("link", { name: "Maya Lindqvist" }).click();
  await page.getByRole("button", { name: "Delete persona" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete persona" }).click();
  await page.waitForURL(/notice=deleted/);
  await expect(page.getByRole("link", { name: "Maya Lindqvist" })).toHaveCount(0);
  await page.goto("/prototypes/new");
  await expect(page.getByLabel("Maya Lindqvist")).toHaveCount(0);
  await page.goto("/prototypes");
  await expect(page.locator("[data-prototype]").first()).toContainText("Maya Lindqvist");
});

test("searches the workspace's personas in the composer and chooses up to three (An intent names one or more personas)", async ({ page, db: _db }) => {
  await page.goto("/prototypes/new");
  const picker = page.getByRole("group", { name: "Personas (optional)" });
  const search = picker.getByRole("searchbox", { name: "Search personas" });
  await search.fill("treasurer");
  await expect(picker.getByRole("status")).toHaveText("1 of 5 personas match.");
  await expect(picker.getByRole("checkbox")).toHaveCount(1);
  await picker.getByRole("checkbox", { name: /Daniel Okafor/ }).check();
  await search.fill("nobody");
  await expect(picker.getByRole("status")).toHaveText('No persona matches "nobody".');
  await search.fill("");
  await picker.getByRole("checkbox", { name: /Maya Lindqvist/ }).check();
  await picker.getByRole("checkbox", { name: /Sofia Marchetti/ }).check();
  await expect(picker.getByText("3 of 3 chosen")).toBeVisible();
  await expect(picker.getByRole("checkbox", { name: /Wei Chen/ })).toBeDisabled();
  await picker.getByRole("button", { name: "Remove Daniel Okafor" }).click();
  await expect(picker.getByRole("checkbox", { name: /Daniel Okafor/ })).not.toBeChecked();
  await expect(picker.getByRole("checkbox", { name: /Wei Chen/ })).toBeEnabled();
  // Enter in the search doesn't submit the composer.
  await search.press("Enter");
  await expect(page).toHaveURL(/\/prototypes\/new$/);
});

test("offers 1, 2, 3, 4, 6, and 8 variants, and generates eight with the persona chosen through search", async ({ page, db: _db }) => {
  await page.goto("/prototypes/new");
  const counts = await page.getByRole("group", { name: "Variants" }).getByRole("radio").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(counts).toEqual(["1", "2", "3", "4", "6", "8"]);
  await page.getByRole("searchbox", { name: "Search personas" }).fill("Maya");
  await page.getByRole("checkbox", { name: /Maya Lindqvist/ }).check();
  await page.getByLabel("Intent").fill("Review and release today's urgent payments before cut-off");
  await page.getByRole("group", { name: "Variants" }).getByLabel("8", { exact: true }).check();
  await page.getByRole("button", { name: "Generate" }).click();
  await page.waitForURL(/\/prototypes\/generations\/gen_[a-z0-9]{16}/);
  await expect(page.locator("[data-prototype-variant]")).toHaveCount(8);
  await expect(page.locator("[data-prototype-variant][data-status=running]")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText("for Maya Lindqvist")).toBeVisible();
});
