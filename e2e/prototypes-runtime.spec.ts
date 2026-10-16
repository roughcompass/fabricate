import { MOCK_DATA, mockPage } from "../src/lib/prototypes/models/mock-fixtures";
import { goodSource } from "../test/fixtures/prototypes";
import { WORKSPACE_COOKIE } from "../src/lib/demo/workspace-key";
import { expect, test } from "./support/fixtures";
import { fixturePrototype, previewFrame, waitForAudit, waitForFrame } from "./support/prototypes";

// prototypes/preview and page-shell specs: the sandboxed frame, the Salt
// runtime, the common page shell, and the preview controls.

const COMPONENT = `import { Button, StackLayout, Text } from "@salt-ds/core";

export default function ReleaseCard() {
  return (
    <StackLayout gap={1}>
      <Text>Northwind Logistics, USD 1,250,000.00</Text>
      <Button appearance="solid" sentiment="accented">Release</Button>
    </StackLayout>
  );
}
`;

const DATE_PICKER = `import { FormField, FormFieldLabel } from "@salt-ds/core";
import { DatePicker, DatePickerOverlay, DatePickerSingleGridPanel, DatePickerSingleInput, DatePickerTrigger } from "@salt-ds/date-components";

export default function ValueDate() {
  return (
    <FormField>
      <FormFieldLabel>Value date</FormFieldLabel>
      <DatePicker selectionVariant="single" defaultSelectedDate={new Date(2026, 9, 16)}>
        <DatePickerTrigger>
          <DatePickerSingleInput />
        </DatePickerTrigger>
        <DatePickerOverlay>
          <DatePickerSingleGridPanel />
        </DatePickerOverlay>
      </DatePicker>
    </FormField>
  );
}
`;

const THROWING = `export default function Broken(): null {
  throw new Error("Payment list failed to load");
}
`;

// Reaches for the network and the page around it the way generated code can't
// (the Salt-only gate forbids both), to prove the frame blocks them anyway.
const ESCAPING = `import { Text } from "@salt-ds/core";
import { useEffect, useState } from "react";

export default function Escape() {
  const [network, setNetwork] = useState("waiting");
  const [parent, setParent] = useState("waiting");
  useEffect(() => {
    const global = globalThis as unknown as Record<string, (url: string) => Promise<unknown>>;
    global["fe" + "tch"]!("https://example.com/").then(() => setNetwork("network: reached"), () => setNetwork("network: blocked"));
    try {
      setParent(\`parent: read \${String((window.parent as Window).document.cookie)}\`);
    } catch {
      setParent("parent: blocked");
    }
  }, []);
  return (
    <>
      <Text data-network="">{network}</Text>
      <Text data-parent="">{parent}</Text>
    </>
  );
}
`;

test("renders a page in the common shell, with its landmarks, current item, and skip link (Two pages, one shell; Skip link)", async ({ page, db: _db }) => {
  const { code, data } = goodSource();
  const { prototypeId } = await fixturePrototype(page, { name: "Urgent payments", scope: "page", title: "Urgent payments", navItem: "Approvals", code, data });
  await page.goto(`/prototypes/${prototypeId}`);
  await waitForFrame(page);
  const frame = previewFrame(page);
  await expect(frame.getByRole("heading", { name: "Urgent payments" })).toBeVisible();
  await expect(frame.getByRole("banner")).toContainText("Meridian Corporate Banking");
  await expect(frame.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(frame.getByRole("main")).toContainText("Northwind Logistics");
  await expect(frame.getByRole("contentinfo")).toContainText("fictional service");
  await expect(frame.getByRole("link", { name: "Approvals" })).toHaveAttribute("aria-current", "page");
  await expect(frame.getByRole("banner")).toContainText("Alex Morgan");

  // Tabbing into the frame from the control before it lands on the skip link first.
  await page.locator("[data-comment-toggle]").focus();
  await page.keyboard.press("Tab");
  await expect(frame.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await frame.getByRole("link", { name: "Skip to main content" }).press("Enter");
  await expect(frame.getByRole("main")).toBeFocused();
});

test("moves the shell's navigation behind a menu button at the mobile width (Mobile width)", async ({ page, db: _db }) => {
  const { code, data } = goodSource();
  const { prototypeId } = await fixturePrototype(page, { scope: "page", title: "Urgent payments", navItem: "Approvals", code, data });
  await page.goto(`/prototypes/${prototypeId}?device=mobile`);
  await waitForFrame(page);
  const frame = previewFrame(page);
  await expect(frame.getByRole("navigation", { name: "Main navigation" })).toBeHidden();
  await frame.getByRole("button", { name: "Open navigation" }).click();
  const drawer = frame.getByRole("dialog", { name: "Main navigation" });
  for (const item of ["Overview", "Payments", "Accounts", "Liquidity", "Reports"]) await expect(drawer.getByText(item, { exact: true })).toBeVisible();
});

test("passes the accessibility audit with no violations of the shell's own", async ({ page, db: _db }) => {
  const { prototypeId } = await fixturePrototype(page, { scope: "page", title: "Urgent payments", navItem: "Approvals", code: mockPage("Urgent payments"), data: MOCK_DATA });
  // The audit runs on the version's first render, whichever tab is open.
  await page.goto(`/prototypes/${prototypeId}?tab=checks`);
  await expect(page.locator("[data-audit]")).toHaveAttribute("data-audit", "clean", { timeout: 30_000 });
});

test("renders a component alone, without the shell (Component without the shell)", async ({ page, db: _db }) => {
  const { prototypeId } = await fixturePrototype(page, { scope: "component", title: "Release card", code: COMPONENT });
  await page.goto(`/prototypes/${prototypeId}`);
  await waitForFrame(page);
  const frame = previewFrame(page);
  await expect(frame.getByRole("button", { name: "Release" })).toBeVisible();
  await expect(frame.getByRole("banner")).toHaveCount(0);
  await expect(frame.getByRole("navigation")).toHaveCount(0);
});

test("opens and formats a Date picker without any setup of its own (Date picker without setup)", async ({ page, db: _db }) => {
  const { prototypeId } = await fixturePrototype(page, { scope: "component", title: "Value date", code: DATE_PICKER });
  // At the mobile width the frame isn't scaled, so the test can click into it.
  await page.goto(`/prototypes/${prototypeId}?device=mobile`);
  await waitForFrame(page);
  await waitForAudit(page);
  const frame = previewFrame(page);
  await expect(frame.getByRole("textbox")).toHaveValue("16 Oct 2026");
  await frame.getByRole("button", { name: "Open Calendar" }).click();
  await expect(frame.getByRole("application", { name: "October 2026" })).toBeVisible();
});

test("shows a render error in the frame, records it, and keeps the page working (Runtime error)", async ({ page, db: _db }) => {
  const { prototypeId } = await fixturePrototype(page, { scope: "component", title: "Broken", code: THROWING });
  const recorded = page.waitForResponse((response) => response.url().endsWith("/render-error") && response.ok());
  await page.goto(`/prototypes/${prototypeId}`);
  await expect(previewFrame(page).getByRole("alert")).toContainText("Payment list failed to load");
  await recorded;
  await page.goto(`/prototypes/${prototypeId}?tab=checks`);
  await expect(page.locator("[data-render-error]")).toContainText("Failed render: Payment list failed to load");
  await expect(page.getByLabel("Ask for a change")).toBeVisible();
});

test("blocks a version's network requests and its reach into the page, leaving the page and its cookies alone (Version tries to fetch)", async ({ page, context, db: _db }) => {
  const { prototypeId } = await fixturePrototype(page, { scope: "component", title: "Escape", code: ESCAPING });
  const before = (await context.cookies()).find((cookie) => cookie.name === WORKSPACE_COOKIE)?.value;
  await page.goto(`/prototypes/${prototypeId}`);
  const frame = previewFrame(page);
  await expect(frame.locator("[data-network]")).toHaveText("network: blocked");
  await expect(frame.locator("[data-parent]")).toHaveText("parent: blocked");
  await expect(page.locator("iframe[data-prototype-frame]").first()).toHaveAttribute("sandbox", "allow-scripts");
  expect((await context.cookies()).find((cookie) => cookie.name === WORKSPACE_COOKIE)?.value).toBe(before);
  await expect(page.getByRole("tab", { name: "Preview" }).or(page.getByRole("link", { name: "Preview" })).first()).toBeVisible();
});

test("re-renders the frame when the density changes, and keeps the choice in the address (Switching density)", async ({ page, db: _db }) => {
  const { code, data } = goodSource();
  const { prototypeId } = await fixturePrototype(page, { scope: "page", title: "Urgent payments", navItem: "Approvals", code, data });
  await page.goto(`/prototypes/${prototypeId}`);
  await waitForFrame(page);
  await expect(previewFrame(page).locator("html")).toHaveClass(/salt-density-medium/);
  await page.getByRole("group", { name: "Density" }).getByRole("button", { name: "High" }).click();
  await expect(page).toHaveURL(/density=high/);
  await waitForFrame(page);
  await expect(previewFrame(page).locator("html")).toHaveClass(/salt-density-high/);
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Dark" }).click();
  await expect(page).toHaveURL(/mode=dark/);
  await expect(previewFrame(page).locator("html")).toHaveAttribute("data-mode", "dark");
});

// converge-templates-and-prototypes, design decision 5: `@deweb/portal` works within the frame.
const PORTAL_PAGE = `import { Button, StackLayout, Text } from "@salt-ds/core";
import { useState } from "react";
import { useBus, useProfile, usePublish, useRoute } from "@deweb/portal";

function PayeeList() {
  const publish = usePublish("payee-list");
  return <Button onClick={() => publish("payee:selected", { name: "Northwind Supplies" })}>Pay Northwind Supplies</Button>;
}

function TransferForm() {
  const [payee, setPayee] = useState("No payee selected");
  useBus("payee:selected", "transfer-form", (payload) => setPayee(\`Paying \${(payload as { name: string }).name}\`));
  return <Text data-transfer="">{payee}</Text>;
}

export default function Payments() {
  const profile = useProfile();
  const { current } = useRoute();
  return (
    <StackLayout gap={2}>
      <Text styleAs="h2">{current.label}</Text>
      <Text data-profile="">{\`Signed in as \${profile.name}\`}</Text>
      <PayeeList />
      <TransferForm />
    </StackLayout>
  );
}
`;

test("connects a page's own regions through @deweb/portal's bus inside the frame, with the first persona as the profile", async ({ page, db: _db }) => {
  const { prototypeId } = await fixturePrototype(page, { name: "Payments workspace", scope: "page", title: "Transfers", code: PORTAL_PAGE });
  await page.goto(`/prototypes/${prototypeId}`);
  await waitForFrame(page);
  const frame = previewFrame(page);

  await expect(frame.locator("[data-transfer]")).toHaveText("No payee selected");
  await expect(frame.getByText("Transfers", { exact: true }).first()).toBeVisible();
  await expect(frame.locator("[data-profile]")).toHaveText(/^Signed in as \S/);
  // The desktop preview is scaled to fit, so the button is activated from the keyboard.
  await frame.getByRole("button", { name: "Pay Northwind Supplies" }).press("Enter");
  await expect(frame.locator("[data-transfer]")).toHaveText("Paying Northwind Supplies");
});
