import type { JsonObject } from "@repo-facts/contract";
import type { Page } from "@playwright/test";
import { previewPublication } from "../src/lib/standards/publish";
import { createStandard, draftDocument, draftOf, getStandard, listStandards, releasesOf, saveDraft } from "../src/lib/standards/standard-records";
import { sampleStandard } from "../test/support/standards";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";
import { pageHeader, pageTitle, toasts, waitForHydration } from "./support/shell";

const control = (page: Page, number: number) => page.getByRole("article", { name: new RegExp(`^Control ${number}\\b`) });
const builder = (scope: ReturnType<typeof control>, legend: string) => scope.getByRole("group", { name: legend, exact: true });
const controlAction = async (page: Page, number: number, action: string) => {
  await page.getByRole("button", { name: `Actions for Control ${number}` }).click();
  await page.locator("[popover]:popover-open").getByRole("button", { name: action }).click();
};

test("builds, reorders, edits, and removes nested Controls in the structured editor, and saves them as data", async ({ page, db }) => {
  await page.goto("/standards");
  await page.getByRole("link", { name: "New Standard" }).first().click();
  await page.getByLabel("Name").fill("Service readiness");
  await page.getByLabel("Purpose").fill("Services can be substituted during migrations");
  await page.getByRole("button", { name: "Create Standard" }).click();
  await expect(toasts(page).getByText("Service readiness was created.")).toBeVisible();

  // Control 1: a repository field predicate.
  await page.getByRole("button", { name: "Add Control" }).click();
  const first = control(page, 1);
  await first.getByLabel("Key").fill("has-ci");
  await first.getByLabel("Title").fill("Runs continuous integration");
  await first.getByLabel("Rationale").fill("Changes need automated verification.");
  await first.getByLabel("Severity").selectOption("high");
  await expect(first.getByLabel("Severity").locator("option")).toHaveText(["Critical", "High", "Medium", "Low", "Info"]);
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
  await derivation.getByLabel("Configured").check();
  await derivation.getByLabel("Host provided").check();
  await each.getByRole("button", { name: "Add condition" }).last().click();
  const contract = builder(second, "Condition 2");
  await contract.getByLabel("Field").selectOption({ label: "Contract evidence" });
  await contract.getByLabel("Operator").selectOption({ label: "equals" });
  await expect(contract.getByLabel("Value").locator("option")).toHaveText(["Yes", "No"]);
  await contract.getByLabel("Value").selectOption("true");

  // Three levels of nesting are told apart by indentation and guide lines, not boxes inside boxes.
  const nested = await second.evaluate((section) => {
    const boxed = (element: Element) => {
      const style = getComputedStyle(element);
      return ["Top", "Right", "Bottom", "Left"].every((side) => Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0) && !element.matches("input, select, textarea, button, [popover]");
    };
    return [...section.querySelectorAll("*")].filter(boxed).length;
  });
  expect(nested).toBe(0);

  // Control 3 is added and removed again.
  await page.getByRole("button", { name: "Add Control" }).click();
  await expect(control(page, 3)).toBeVisible();
  await controlAction(page, 3, "Remove");
  await expect(control(page, 3)).toHaveCount(0);

  await controlAction(page, 2, "Move up");
  await expect(control(page, 1)).toContainText("Service destinations are configurable or contracted");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  // The save bar is the one place that reports the save: no separate notice or toast.
  await expect(page.getByText("All changes saved · Ready to publish")).toBeVisible();
  await expect(page.getByRole("link", { name: "Review and publish" })).toBeVisible();
  await expect(toasts(page).getByText(/saved/i)).toHaveCount(0);

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

  // Editing a nested value and clearing a title: the index lists where, the fields say what.
  await control(page, 2).getByLabel("Title").fill("");
  await builder(control(page, 1), "Condition 1").getByLabel("Configured").uncheck();
  await builder(control(page, 1), "Condition 1").getByLabel("Host provided").uncheck();
  await page.getByRole("button", { name: "Save draft" }).click();
  const index = page.getByRole("region", { name: "Issues" });
  await expect(index).toContainText("2 issues to fix before publication");
  await expect(index.getByRole("button", { name: "Control 1 (services-configurable) · Expected condition" })).toBeVisible();
  await expect(index.getByRole("button", { name: "Control 2 (has-ci) · Title" })).toBeVisible();
  await expect(index).not.toContainText("Enter a title");
  await expect(control(page, 2).getByText("Enter a title")).toBeVisible();
  await expect(page.getByText("All changes saved · 2 issues to fix")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test("restores a removed Control in its place with Undo", async ({ page, db }) => {
  const { standard, draft } = createStandard(db, { name: "Engineering baseline", purpose: "Shared expectations" });
  saveDraft(db, draft, draft.lockVersion, sampleStandard());
  await page.goto(`/standards/${standard.publicId}/draft`);

  const titleOf = (number: number) => control(page, number).locator("button[aria-expanded]");
  const secondTitle = await titleOf(2).textContent();
  await controlAction(page, 2, "Remove");
  await expect(titleOf(2)).not.toHaveText(secondTitle!);
  await toasts(page).getByRole("button", { name: "Undo" }).click();
  await expect(titleOf(2)).toHaveText(secondTitle!);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
});

test("follows an issue link into a collapsed Control and focuses the field", async ({ page, db }) => {
  const { standard, draft } = createStandard(db, { name: "Engineering baseline", purpose: "Shared expectations" });
  const document = sampleStandard();
  (document.controls as JsonObject[])[1]!.title = "";
  saveDraft(db, draft, draft.lockVersion, document);
  await page.goto(`/standards/${standard.publicId}/draft`);

  await expect(control(page, 2).getByLabel("Title")).toBeHidden();
  await expect(control(page, 2)).toContainText("1 issue");
  await page.getByRole("region", { name: "Issues" }).getByRole("button", { name: /Control 2 .*· Title/ }).click();
  await expect(control(page, 2).getByLabel("Title")).toBeFocused();
  await expect(control(page, 2).getByText("Enter a title")).toBeVisible();
});

test("edits a Standard's name and purpose, showing a rejected field once", async ({ page, db }) => {
  const { standard } = createStandard(db, { name: "Engineering baseline", purpose: "Shared expectations" });
  await page.goto(`/standards/${standard.publicId}/edit`);
  await page.getByLabel("Purpose").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByLabel("Purpose")).toBeFocused();
  const message = await page.locator("#standard-purpose-error").textContent();
  await expect(page.getByText(message!)).toHaveCount(1);

  await page.getByLabel("Purpose").fill("Expectations every team shares");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toasts(page).getByText("Engineering baseline was updated.")).toBeVisible();
});

test("distinguishes drafts from Releases and shows exact publication inputs before an irreversible confirmation", async ({ page, db }) => {
  const { standard, draft } = createStandard(db, { name: "Engineering baseline", purpose: "Shared expectations" });
  const saved = saveDraft(db, draft, draft.lockVersion, sampleStandard());
  const preview = previewPublication(db, standard.publicId)!;

  await page.goto("/standards");
  const row = page.getByRole("row", { name: /Engineering baseline/ });
  await expect(row).toContainText("Ready to publish");
  await expect(row).toContainText("Not published");

  await row.getByRole("link", { name: "Engineering baseline" }).click();
  await page.getByRole("link", { name: "Review and publish" }).click();
  await expect(page.getByRole("heading", { name: "Publish Engineering baseline v1" })).toBeVisible();
  const publication = page.getByRole("region", { name: "Publication" });
  await expect(publication).toContainText(`From draft version${saved.lockVersion}`);
  await expect(publication).toContainText(preview.digest);
  // Every Control is shown in full before publication.
  await expect(page.getByRole("article", { name: "Control services-configurable" })).toContainText("service.endpoint_derivation");

  // Canceling the confirmation publishes nothing.
  await page.getByRole("button", { name: "Publish v1" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish Engineering baseline v1?" });
  await expect(dialog).toContainText(`draft version ${saved.lockVersion}`);
  await expect(dialog).toContainText("can never be edited or deleted");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(releasesOf(db, standard.id)).toHaveLength(0);

  await page.getByRole("button", { name: "Publish v1" }).click();
  await dialog.getByRole("button", { name: "Publish v1" }).click();
  await expect(toasts(page).getByText("Release v1 was published.")).toBeVisible();
  const [release] = releasesOf(db, standard.id);
  expect(release!.digest).toBe(preview.digest);
  // The digest is technical metadata, in the details after the Controls.
  await page.locator("summary", { hasText: "Details" }).click();
  await expect(page.locator("details[open]")).toContainText(release!.digest);
  await expect(page.getByRole("article", { name: "Control has-ci" })).toContainText("repository.ci_systems");

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Engineering baseline" }).click();
  await expect(page.getByRole("region", { name: "Release history" })).toContainText("v1");
  await expect(page.getByRole("region", { name: "Draft" })).toContainText("There is no draft");
  await page.getByRole("button", { name: "Start a draft from v1" }).click();
  await expect(toasts(page).getByText("A new draft was started from the Release.")).toBeVisible();
  await expect(control(page, 1)).toBeVisible();
  expect(draftOf(db, getStandard(db, standard.publicId).id)?.basedOnReleaseId).toBe(release!.id);
});

test("refuses to offer publication for a draft with problems, listing them once", async ({ page, db }) => {
  const { standard } = createStandard(db, { name: "Incomplete", purpose: "Not ready" });

  await page.goto(`/standards/${standard.publicId}/publish?notice=invalid`);
  await expect(page.getByText("The draft has 1 problem, so it cannot be published")).toBeVisible();
  await expect(page.getByText("Controls: Add at least one Control")).toHaveCount(1);
  await expect(page.getByText(/was not published/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(0);
});

test("starts a Standard from the Salt adherence starter, then reviews and publishes it", async ({ page, db }) => {
  await page.goto("/standards/new");
  const startFrom = page.getByRole("group", { name: "Start from" });
  await expect(startFrom.getByRole("button", { name: "Blank" })).toHaveAttribute("aria-pressed", "true");
  await startFrom.getByRole("button", { name: "Salt adherence" }).click();
  await expect(page).toHaveURL(/\/standards\/new\?starter=salt-adherence$/);
  await expect(startFrom.getByRole("button", { name: "Salt adherence" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Name")).toHaveValue("Salt adherence");

  await page.getByRole("button", { name: "Create Standard" }).click();
  await expect(page).toHaveURL(/\/standards\/std_[a-z0-9]+\/draft/);
  await expect(control(page, 10)).toBeVisible();
  const [standard] = listStandards(db);
  expect((draftDocument(draftOf(db, standard!.id)!).controls as JsonObject[]).map((item) => item.key)).toContain("salt-theme-stylesheet");

  await page.goto(`/standards/${standard!.publicId}`);
  await page.getByRole("link", { name: "Review and publish" }).click();
  await expect(page.getByRole("article", { name: "Control salt-theme-stylesheet" })).toContainText("repository.design_system_theme_imported");
  await page.getByRole("button", { name: "Publish v1" }).click();
  await page.getByRole("dialog", { name: "Publish Salt adherence v1?" }).getByRole("button", { name: "Publish v1" }).click();
  await expect(toasts(page).getByText("Release v1 was published.")).toBeVisible();
  expect(releasesOf(db, standard!.id).map((release) => release.profileSchemaVersions)).toEqual([[2]]);
});

// operator-interface/page-templates spec, Editor.
test("Standard draft: the title names the draft, its status counts the saved draft's issues, and Save draft is secondary while everything is saved", async ({ page, db }) => {
  const { standard } = createStandard(db, { name: "Incomplete", purpose: "Not ready" });
  await page.goto(`/standards/${standard.publicId}/draft`);
  await expect(pageTitle(page)).toHaveText("Incomplete draft");
  await expect(pageHeader(page).locator("[data-header-status]")).toContainText("1 issue");
  await expect(page.getByText("All changes saved · 1 issue to fix")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveAttribute("data-variant", "secondary");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Add Control" }).first().click();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveAttribute("data-variant", "primary");
});

// design-system spec, "Status and values are presented through one registry".
test("Unpublished draft: a never-published draft with no issues is neutral, not green", async ({ page, db }) => {
  const { draft } = createStandard(db, { name: "Engineering baseline", purpose: "Shared expectations" });
  saveDraft(db, draft, draft.lockVersion, sampleStandard());
  await page.goto("/standards");
  const row = page.getByRole("row", { name: /Engineering baseline/ });
  await expect(row.locator('[data-state="draft_ready"]')).toHaveText("Ready to publish");
  await expect(row.locator('[data-tone]').first()).toHaveAttribute("data-tone", "neutral");
  await expect(row.locator('[data-tone="success"]')).toHaveCount(0);
});
