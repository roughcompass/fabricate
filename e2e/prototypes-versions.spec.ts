import { expect, test } from "./support/fixtures";
import runtime from "../src/lib/prototypes/runtime-manifest.json" with { type: "json" };
import { fixturePrototype, keepOne, previewFrame, refineEach, waitForAudit, waitForFrame } from "./support/prototypes";
import { waitForHydration } from "./support/shell";

/** The Salt release DE FabLab renders and checks with. */
const SALT = runtime.packages["@salt-ds/core"];

// prototypes/versions spec: forking, comparing, and accepting.

test("forks version 3 into a new prototype without changing the original (Forking version 3)", async ({ page, db: _db }) => {
  const original = await keepOne(page);
  await refineEach(page, ["Group by cut-off time", "Show the total per group"]);
  await page.goto(`${original}?v=3`);
  await page.getByRole("button", { name: "Fork version 3" }).click();
  await page.waitForURL((url) => url.pathname !== new URL(original).pathname && url.pathname.startsWith("/prototypes/pro_"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exception-first queue (fork)");
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Forked from Exception-first queue v3.")).toBeVisible();
  await expect(page.locator("[data-version-chip]")).toHaveCount(1);
  await page.getByRole("link", { name: "Provenance" }).click();
  await expect(page.locator("[data-provenance]").getByRole("link", { name: "Forked from Exception-first queue v3" })).toBeVisible();

  await page.goto(original);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exception-first queue");
  await expect(page.locator("[data-version-chip]")).toHaveCount(3);
  await page.goto("/prototypes");
  await expect(page.getByRole("link", { name: "Exception-first queue (fork)" })).toBeVisible();
});

test("compares versions 2 and 4 under one set of controls, marks the higher scores, and lists the code changes (Comparing v2 and v4; Pairwise review)", async ({ page, db: _db }) => {
  const prototype = await keepOne(page);
  await refineEach(page, ["Group by cut-off time", "Add a confirm step for large amounts", "Show the total per group"]);
  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page).toHaveURL(/\/compare\?a=3&b=4$/);
  await page.getByLabel("Left").selectOption("2");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page).toHaveURL(/a=2&b=4/);
  await expect(page.getByRole("link", { name: "Back to Exception-first queue" })).toHaveAttribute("href", new URL(prototype).pathname);

  await waitForFrame(page, 0);
  await waitForFrame(page, 1);
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Dark" }).click();
  await expect(page).toHaveURL(/mode=dark/);
  for (const nth of [0, 1]) await expect(previewFrame(page, nth).locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(page).toHaveURL(/a=2&b=4/);

  // Version 4 shows the totals, so it scores higher on clarity, and only there.
  const right = page.locator("[data-compare-side='4']");
  await expect(right.locator("[data-criterion=clarity][data-higher]")).toContainText("Higher");
  await expect(page.locator("[data-higher]")).toHaveCount(1);
  await expect(page.locator("[data-compare-side='2']")).toContainText("Group by cut-off time");
  await expect(right).toContainText("Show the total per group");

  const changes = page.locator("[data-code-diff='Prototype.tsx']");
  await expect(changes.locator("[data-diff-counts]")).toHaveText("1 added, 1 removed");
  await expect(changes.locator("[data-kind=removed]")).toContainText("Group by cut-off time");
  await expect(changes.locator("[data-kind=added]")).toContainText("Show the total per group");
  await expect(page.locator("[data-code-diff='data.ts'] [data-diff-counts]")).toHaveText("No changes");

  await page.getByRole("button", { name: "Ask for a pairwise review" }).click();
  const verdict = page.locator("[data-pairwise=done] [data-verdict]");
  await expect(verdict).toHaveAttribute("data-verdict", "b", { timeout: 30_000 });
  await expect(verdict).toContainText("Maya Lindqvist");
  await expect(verdict).toContainText("v4 is better");
  await expect(verdict).toContainText("v4 keeps the cut-off in view.");
  await expect(page.locator("[data-pairwise=done]")).toContainText("AI review by");
});

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

const RELEASE_CARD = `import { Button, Card, Text } from "@salt-ds/core";

export default function ReleaseCard() {
  return (
    <Card>
      <Text>3 payments are ready to release.</Text>
      <Button sentiment="accented">Release</Button>
    </Card>
  );
}
`;

test("accepts version 1 as a Payments template, then updates it to version 2, then withdraws it (Accepting; Accepting a later version; Withdrawing)", async ({ page, db: _db }) => {
  const prototype = await keepOne(page);
  await waitForFrame(page);
  await waitForAudit(page);
  await page.getByRole("link", { name: "Accept as template" }).click();
  await expect(page.getByRole("link", { name: "Back to Exception-first queue" })).toBeVisible();
  await page.getByLabel("Title").fill("Urgent payments queue");
  await page.getByLabel("Description").fill("Payments that need action before cut-off lead the queue. Built for treasury approvers.");
  await page.getByLabel("Brand").selectOption("payments");
  await page.getByLabel("Tags").fill("Payments, Approvals");
  await page.getByRole("button", { name: "Continue" }).click();

  const confirm = page.locator("[data-accept-step=confirm]");
  await expect(confirm).toContainText("Urgent payments queue");
  await expect(confirm).toContainText("Accepted by");
  await expect(confirm).toContainText("Anonymous visitor");
  await expect(confirm).toContainText("Checks passed");
  await expect(confirm).toContainText("No violations");
  await expect(confirm.locator("[data-capture=done]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Accept as template" }).click();
  await page.waitForURL(/notice=accepted/);
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Accepted as a template.")).toBeVisible();
  const accepted = page.locator("[data-accepted]");
  await expect(accepted).toContainText("Accepted as template v1, from v1");
  await expect(accepted.getByRole("link", { name: "Urgent payments queue in Salt Patterns" })).toHaveAttribute("href", /^\/templates\/urgent-payments-queue-[a-z0-9]{6}$/);
  await page.goto("/prototypes");
  await expect(page.getByRole("row", { name: /Exception-first queue/ })).toContainText("Accepted");

  // A later version publishes the next template version.
  await page.goto(prototype);
  await refineEach(page, ["Show the total per group"]);
  await waitForAudit(page);
  await page.getByRole("link", { name: "Accept as template v2" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Urgent payments queue");
  await page.getByLabel("Your display name").fill("Maya's team");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("[data-accept-step=confirm]")).toContainText("Accepting publishes Urgent payments queue v2 to everyone on this deployment.");
  await expect(page.locator("[data-capture=done]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Publish next version" }).click();
  await page.waitForURL(/notice=accepted/);
  await expect(page.locator("[data-accepted]")).toContainText("Accepted as template v2, from v2");
  const detail = await page.locator("[data-accepted]").getByRole("link").getAttribute("href");
  await page.goto(detail!);
  await expect(page.locator("[data-template-version]")).toHaveCount(2);
  await expect(page.locator("[data-template-version='2']")).toContainText("Exception-first queue v2");
  await expect(page.locator("[data-template-version='2']")).toContainText("Maya's team (unverified)");
  await expect(page.locator("[data-template-version='1']")).toContainText("Exception-first queue v1");
  await expect(page.locator("[data-template-version='1']")).toContainText("Anonymous visitor (unverified)");
  await expect(page.locator("[data-template-version='1']")).toContainText(`Salt ${SALT}`);
  await expect(page.locator("[data-template-version='1']")).toContainText("Checks v1");
  await page.goBack();
  await waitForHydration(page);

  await page.getByRole("button", { name: "Withdraw template" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Withdraw template" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("The template was withdrawn.")).toBeVisible();
  await expect(page.locator("[data-accepted]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Accept as template" })).toBeVisible();
});

test("makes Accept unavailable for a version with a critical violation, naming it (Not eligible)", async ({ page, db: _db }) => {
  const { prototypeId } = await fixturePrototype(page, { scope: "page", title: "Payee search", navItem: "Payees", code: UNLABELED });
  await page.goto(`/prototypes/${prototypeId}`);
  await waitForFrame(page);
  await waitForAudit(page);
  const blocked = page.locator("[data-accept-blocked]");
  await expect(blocked.getByRole("button", { name: "Accept as template" })).toBeDisabled();
  await expect(blocked).toContainText("It has a critical accessibility violation: Form elements must have labels (label).");
  await page.goto(`/prototypes/${prototypeId}/accept`);
  await expect(page.locator("[data-tone=warning]")).toContainText("Form elements must have labels");
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});

test("doesn't offer Accept for a component (Component scope)", async ({ page, db: _db }) => {
  const { prototypeId } = await fixturePrototype(page, { scope: "component", title: "Release card", code: RELEASE_CARD });
  await page.goto(`/prototypes/${prototypeId}`);
  await waitForFrame(page);
  await expect(page.getByRole("button", { name: "Fork version 1" })).toBeVisible();
  await expect(page.getByText("Accept as template")).toHaveCount(0);
});

test("lists a prototype with four versions that was accepted as v4, with its check summary and Accepted (List row)", async ({ page, db: _db }) => {
  // Three refinements and an audit.
  test.slow();
  await keepOne(page);
  await refineEach(page, ["Group by cut-off time", "Add a confirm step for large amounts", "Show the total per group"]);
  await waitForAudit(page);
  await page.getByRole("link", { name: "Accept as template" }).click();
  await page.getByLabel("Tags").fill("Payments");
  await page.getByLabel("Description").fill("Payments that need action lead.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("[data-capture=done]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Accept as template" }).click();
  await page.waitForURL(/notice=accepted/);
  await page.goto("/prototypes");
  const row = page.getByRole("row", { name: /Exception-first queue/ });
  await expect(row).toContainText("v4");
  await expect(row).toContainText("Checks passed");
  await expect(row).toContainText("fit 4.4");
  await expect(row).toContainText("Accepted");
  await expect(row).toContainText("Maya Lindqvist");
  await expect(row).toContainText("Page");
});

test("renames a prototype, and deleting it keeps the lessons learned from it (Renaming; Deleting)", async ({ page, db: _db }) => {
  const prototype = await keepOne(page);
  await page.getByText("Rename or delete").click();
  await page.getByLabel("Name").fill("Cut-off queue");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Renamed to Cut-off queue.")).toBeVisible();

  await page.goto(`${prototype}?tab=feedback`);
  await page.getByRole("group", { name: "Rate this version" }).getByLabel("3").check();
  await page.getByLabel("Note").fill("Lead with the payments closest to their cut-off");
  await page.getByRole("button", { name: "Save rating" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your rating was saved." })).toBeVisible();
  await page.goto("/prototypes/lessons");
  const proposed = page.getByRole("list", { name: "Lessons to review" });
  await expect(async () => {
    await page.reload();
    await expect(proposed).toContainText("lead with the payments closest to their cut-off", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await proposed.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("list", { name: "Active lessons" })).toContainText("lead with the payments closest to their cut-off");

  await page.goto(prototype);
  await page.getByText("Rename or delete").click();
  await page.getByRole("button", { name: "Delete prototype" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete prototype" }).click();
  await page.waitForURL(/\/prototypes\?notice=deleted|\/prototypes$/);
  await expect(page.getByRole("link", { name: "Cut-off queue" })).toHaveCount(0);
  await page.goto("/prototypes/lessons");
  await expect(page.getByRole("list", { name: "Active lessons" })).toContainText("lead with the payments closest to their cut-off");
  await expect(page.getByRole("list", { name: "Active lessons" }).getByRole("link", { name: "A rating note" })).toHaveCount(0);
});
