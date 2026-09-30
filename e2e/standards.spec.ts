import type { JsonObject } from "@repo-facts/contract";
import type { Page } from "@playwright/test";
import { previewPublication } from "../src/lib/standards/publish";
import { createStandard, draftDocument, draftOf, getStandard, listStandards, releasesOf, saveDraft } from "../src/lib/standards/standard-records";
import { sampleStandard } from "../test/support/standards";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";

const control = (page: Page, number: number) => page.getByRole("region", { name: new RegExp(`^Control ${number}\\b`) });
const builder = (scope: ReturnType<typeof control>, legend: string) => scope.getByRole("group", { name: legend, exact: true });

test("builds, reorders, edits, and removes nested Controls in the structured editor, and saves them as data", async ({ page, db }) => {
  await page.goto("/standards");
  await page.getByRole("link", { name: "New Standard" }).first().click();
  await page.getByLabel("Name").fill("Service readiness");
  await page.getByLabel("Purpose").fill("Services can be substituted during migrations");
  await page.getByRole("button", { name: "Create Standard" }).click();
  await expect(page.getByText("The Standard was created with an empty draft.")).toBeVisible();

  // Control 1: a repository field predicate.
  await page.getByRole("button", { name: "Add Control" }).click();
  const first = control(page, 1);
  await first.getByLabel("Key").fill("has-ci");
  await first.getByLabel("Title").fill("Runs continuous integration");
  await first.getByLabel("Rationale").fill("Changes need automated verification.");
  await first.getByLabel("Severity").selectOption("high");
  const firstCondition = builder(first, "Expected condition");
  // The condition types are a closed set; there is no way to type an expression.
  await expect(firstCondition.getByLabel("Condition type").first().locator("option")).toHaveText(["Always", "A field", "All of these", "Any of these", "Not", "Every item", "At least one item", "Number of items"]);
  await firstCondition.getByLabel("Field").first().selectOption({ label: "CI systems" });

  // Control 2: every Service Dependency meets any of two conditions.
  await page.getByRole("button", { name: "Add Control" }).click();
  const second = control(page, 2);
  await second.getByLabel("Key").fill("services-configurable");
  await second.getByLabel("Title").fill("Service destinations are configurable or contracted");
  await second.getByLabel("Rationale").fill("Migrations point services at test doubles.");
  const secondCondition = builder(second, "Expected condition");
  await secondCondition.getByLabel("Condition type").first().selectOption({ label: "Every item" });
  const each = builder(second, "Condition every item must meet");
  await each.getByLabel("Condition type").first().selectOption({ label: "Any of these" });
  const derivation = builder(second, "Condition 1");
  await derivation.getByLabel("Field").selectOption({ label: "Endpoint derivation" });
  await derivation.getByLabel("Operator").selectOption({ label: "is one of" });
  await derivation.getByLabel("configured").check();
  await derivation.getByLabel("host_provided").check();
  await each.getByRole("button", { name: "Add condition" }).last().click();
  const contract = builder(second, "Condition 2");
  await contract.getByLabel("Field").selectOption({ label: "Contract evidence" });
  await contract.getByLabel("Operator").selectOption({ label: "equals" });
  await contract.getByLabel("Value").selectOption("true");

  // Control 3 is added and removed again.
  await page.getByRole("button", { name: "Add Control" }).click();
  await expect(control(page, 3)).toBeVisible();
  await page.getByRole("button", { name: "Remove Control 3" }).click();
  await expect(control(page, 3)).toHaveCount(0);

  await page.getByRole("button", { name: "Move Control 2 up" }).click();
  await expect(control(page, 1)).toContainText("Service destinations are configurable or contracted");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("The draft is valid.")).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible();

  const standard = listStandards(db)[0]!;
  const document = draftDocument(draftOf(db, standard.id)!);
  const controls = document.controls as JsonObject[];
  expect(controls.map((item) => item.key)).toEqual(["services-configurable", "has-ci"]);
  expect(controls[0]!.condition).toEqual({
    op: "every",
    collection: "service_dependencies",
    condition: {
      op: "any",
      items: [
        { op: "in", selector: "service.endpoint_derivation", values: ["configured", "host_provided"] },
        { op: "equals", selector: "service.has_contract", value: true },
      ],
    },
  });
  expect(controls[1]).toMatchObject({ severity: "high", condition: { op: "exists", selector: "repository.ci_systems" }, guidance: null });

  // Editing a nested value and clearing a title: validation addresses each problem.
  await control(page, 2).getByLabel("Title").fill("");
  await builder(control(page, 1), "Condition 1").getByLabel("configured").uncheck();
  await builder(control(page, 1), "Condition 1").getByLabel("host_provided").uncheck();
  await page.getByRole("button", { name: "Save draft" }).click();
  const summary = page.getByRole("alert").filter({ hasText: "problems to fix before publication" });
  await expect(summary).toContainText("Control 1 (services-configurable), Expected condition: Enter at least one value");
  await expect(summary).toContainText("Control 2 (has-ci), Title: Enter a title");
  await expect(control(page, 2).getByText("Enter a title")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test("distinguishes drafts from Releases and shows exact publication inputs before an irreversible confirmation", async ({ page, db }) => {
  const { standard, draft } = createStandard(db, { name: "Engineering baseline", purpose: "Shared expectations" });
  const saved = saveDraft(db, draft, draft.lockVersion, sampleStandard());
  const preview = previewPublication(db, standard.publicId)!;

  await page.goto("/standards");
  const row = page.getByRole("row", { name: /Engineering baseline/ });
  await expect(row).toContainText("Draft");
  await expect(row).toContainText("Ready to publish");
  await expect(row).toContainText("Not published");

  await row.getByRole("link", { name: "Engineering baseline" }).click();
  await page.getByRole("link", { name: "Review and publish" }).click();
  await expect(page.getByRole("heading", { name: "Publish Engineering baseline v1" })).toBeVisible();
  const publication = page.getByRole("region", { name: "Publication" });
  await expect(publication).toContainText(`From draft version${saved.lockVersion}`);
  await expect(publication).toContainText(preview.digest);
  await expect(publication).toContainText("Publishing is irreversible");
  // Every Control is shown in full before publication.
  await expect(page.getByRole("article", { name: "Control services-configurable" })).toContainText("service.endpoint_derivation");

  // Dismissing the confirmation publishes nothing.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByRole("heading", { name: "Publish Engineering baseline v1" })).toBeVisible();
  expect(releasesOf(db, standard.id)).toHaveLength(0);

  let confirmation = "";
  page.once("dialog", (dialog) => {
    confirmation = dialog.message();
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText("Release v1 was published.")).toBeVisible();
  expect(confirmation).toContain(`draft version ${saved.lockVersion}`);
  const [release] = releasesOf(db, standard.id);
  expect(release!.digest).toBe(preview.digest);
  await expect(page.getByRole("region", { name: "Release" })).toContainText(release!.digest);
  await expect(page.getByRole("article", { name: "Control has-ci" })).toContainText("repository.ci_systems");

  await page.getByRole("link", { name: "Engineering baseline" }).first().click();
  await expect(page.getByRole("region", { name: "Release history" })).toContainText("v1");
  await expect(page.getByRole("region", { name: "Draft" })).toContainText("There is no draft");
  await page.getByRole("button", { name: "Start a draft from v1" }).click();
  await expect(page.getByText("A new draft was started from the Release.")).toBeVisible();
  await expect(control(page, 1)).toBeVisible();
  expect(draftOf(db, getStandard(db, standard.publicId).id)?.basedOnReleaseId).toBe(release!.id);
});

test("refuses to offer publication for a draft with problems", async ({ page, db }) => {
  const { standard } = createStandard(db, { name: "Incomplete", purpose: "Not ready" });

  await page.goto(`/standards/${standard.publicId}/publish`);
  await expect(page.getByText("The draft has 1 problem, so it cannot be published")).toBeVisible();
  await expect(page.getByText("controls: Add at least one Control")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(0);
});
