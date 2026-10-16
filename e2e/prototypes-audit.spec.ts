import { expect, test } from "./support/fixtures";
import { fixturePrototype, previewFrame, waitForFrame } from "./support/prototypes";

// quality-checks spec, "An accessibility audit runs on the rendered version".

const UNLABELED = `import { Input, StackLayout, Text } from "@salt-ds/core";

export default function PayeeSearch() {
  return (
    <StackLayout gap={1}>
      <Text>Find a payee</Text>
      <Input inputProps={{ id: "payee-search" }} />
    </StackLayout>
  );
}
`;

test("lists a missing label and highlights its field in the preview (Missing label)", async ({ page, db: _db }) => {
  const { prototypeId } = await fixturePrototype(page, { scope: "component", title: "Payee search", code: UNLABELED });
  await page.goto(`/prototypes/${prototypeId}?tab=checks`);
  const violations = page.locator("[data-audit=violations]");
  await expect(violations).toBeVisible({ timeout: 30_000 });
  const label = violations.locator("[data-violation=label]");
  await expect(label).toContainText("Form elements must have labels");
  await expect(label).toContainText("#payee-search");
  await label.getByRole("link", { name: "Show in preview" }).click();
  await expect(page).toHaveURL(/highlight=\d+/);
  await waitForFrame(page);
  await expect(previewFrame(page).locator(".prototypeHost-highlight")).toHaveCount(1);
});
