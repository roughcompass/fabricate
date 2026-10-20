import type { Page } from "@playwright/test";
import type { Db } from "../src/lib/db/client";
import { catalogs } from "../src/lib/experience/catalogs";
import type { Experience } from "../src/lib/experience/document";
import { currentExperience, saveExperience } from "../src/lib/experience/versions";
import { getPortal } from "../src/lib/onboarding/portals";
import { ana, onboardPortal } from "../test/support/onboarding";
import { expect, test } from "./support/fixtures";
import { waitForHydration } from "./support/shell";

// web-onboarding/portal-configuration spec: the Portal Configuration
// sections of the experience editor.

const sectionOf = (portal: { publicId: string }, section: string) => `/portals/${portal.publicId}/configuration/${section}`;
const pending = (page: Page) => page.locator("[data-pending-count]");
const preview = (page: Page) => page.locator("[data-frame-preview]");
const save = (page: Page) => page.locator("[data-runtime-actions]").getByRole("button", { name: "Save", exact: true });

async function open(page: Page, portal: { publicId: string }, section: string) {
  await page.goto(sectionOf(portal, section));
  await waitForHydration(page);
}

/** Saves +change+ to +portal+'s experience directly, as an earlier editor session would have. */
function saved(db: Db, portal: { publicId: string }, change: (draft: Experience) => void) {
  const current = currentExperience(db, getPortal(db, portal.publicId), catalogs());
  const document = structuredClone(current.experience);
  change(document);
  saveExperience(db, portal.publicId, { baseNumber: current.number, lockVersion: getPortal(db, portal.publicId).lockVersion, document }, ana, catalogs());
}

test("Sections in order, each its own Runtime Configuration page, marked current, titled with its name (Sections in order, Opening a section)", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await open(page, access, "brand");
  const nav = page.getByRole("navigation", { name: "Primary" });
  const items = ["Brand & identity", "Favicon", "Design Theme", "Copyright Information", "Routing configuration", "Default Session Language", "Session Policy", "Runtime modules", "Crash Error"];
  for (const [heading, names] of [["Identity", items.slice(0, 3)], ["Policies", items.slice(3, 4)], ["Routing & sessions", items.slice(4, 7)], ["Runtime", items.slice(7)]] as const) await expect(nav.getByRole("list", { name: heading, exact: true }).getByRole("link")).toHaveText([...names]);
  await nav.getByRole("link", { name: "Copyright Information" }).click();
  await expect(page).toHaveURL(new RegExp(`${sectionOf(access, "copyright")}$`));
  await expect(nav.getByRole("link", { name: "Copyright Information" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-shell-header]").getByRole("heading", { level: 1 })).toHaveText("Copyright Information");
  await expect(page.locator("[data-configuration-section='copyright']")).toContainText("Legal footer copy rendered by the Experience Frame's Footer Zone, Primary Slot.");
});

test("Brand & identity: the portal name shows beside the logo and in the preview, reaches the Experience Editor unsaved, and Reset to default restores it", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await open(page, access, "brand");
  await page.getByLabel("Portal name").fill("Digital Platform");
  await expect(page.locator("[data-brand-preview]")).toContainText("Digital Platform");
  await expect(page.locator("[data-brand-preview] img")).toHaveAttribute("alt", "J.P. Morgan");
  await expect(preview(page)).toContainText("Digital Platform");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Experience Editor" }).click();
  await expect(preview(page)).toContainText("Digital Platform");
  await expect(pending(page)).toHaveText("1 unsaved change");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Brand & identity" }).click();
  await page.getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByLabel("Portal name")).toHaveValue("Access");
});

test("Favicon: a remote URL is refused with a message, Save is refused, and off hides the field's previews", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await open(page, access, "favicon");
  await expect(page.getByRole("list", { name: "Favicon sizes" }).getByRole("img")).toHaveCount(3);
  await page.getByLabel("Favicon data URL").fill("https://example.com/icon.png");
  await expect(page.getByText("Only data URLs of an SVG, PNG, or ICO image are accepted")).toBeVisible();
  await save(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "weren't saved" })).toBeVisible();
  await page.getByLabel("Enabled").uncheck();
  await expect(page.getByLabel("Favicon data URL")).toBeDisabled();
});

test("Design Theme: making Markets active and pinning a version", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await open(page, access, "theme");
  await expect(page.locator("[data-active-theme]")).toContainText("Currently active: Default @ latest");
  await page.getByRole("radio", { name: "Markets" }).check();
  await page.getByRole("button", { name: "Configure Markets" }).click();
  const dialog = page.getByRole("dialog", { name: "Configure Markets" });
  await dialog.getByLabel("Version").selectOption("2.3.0");
  await dialog.getByRole("button", { name: "Use version" }).click();
  await expect(page.locator("[data-active-theme]")).toContainText("Currently active: Markets @ 2.3.0");
  await expect(page.getByRole("button", { name: "Configure Payments" })).toBeDisabled();
});

test("Copyright: the footer shows the new text in the preview beside it", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await open(page, access, "copyright");
  await page.getByLabel("Copyright information").fill("© 2026 JPMorgan Chase & Co. Member FDIC.");
  await expect(preview(page).locator("[data-slot='primary']")).toHaveText("© 2026 JPMorgan Chase & Co. Member FDIC.");
});

test("Routing: the live preview follows the base path, landing path, and mode, and Lock base path makes it read-only", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await open(page, access, "routing");
  await page.getByLabel("Base path").fill("/access");
  await page.getByLabel("Default landing path", { exact: true }).fill("/dashboard");
  await page.getByRole("button", { name: "Hash (#/route)" }).click();
  await expect(page.locator("[data-landing-url]")).toHaveText("https://portal.example.com/access/#/dashboard");
  await page.getByRole("button", { name: "History (clean URLs)" }).click();
  await expect(page.locator("[data-landing-url]")).toHaveText("https://portal.example.com/access/dashboard");
  await page.getByRole("button", { name: "Lock base path" }).click();
  await expect(page.getByLabel("Base path")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Base path")).not.toBeEditable();
  await page.getByLabel("Default landing path", { exact: true }).fill("dashboard");
  await expect(page.getByText("Start with / and use only letters, digits, hyphens, and slashes")).toBeVisible();
});

test("Session language and policy: custom copy reaches the dialog preview, the remember setting is shared, and an empty logout URL is refused", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await open(page, access, "session-language");
  await page.getByLabel("Change session inactivity alert language").check();
  await page.getByLabel("Dialog title").fill("Still there?");
  await expect(preview(page)).toContainText("Still there?");

  await page.goto(sectionOf(access, "routing"));
  await waitForHydration(page);
  await page.getByLabel("Remember last visited route on return").check();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Session Policy" }).click();
  await expect(page.getByLabel("Remember last visited route on return")).toBeChecked();
  await page.getByLabel("Configure logout redirect URL").check();
  await save(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "weren't saved" })).toContainText("Enter a path that starts with / or an https URL");
  await page.getByLabel("Logout redirect URL", { exact: true }).fill("https://sso.example.com/logout");
  await save(page).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Version 1 is saved.");
});

test("Runtime modules: including a module, a malformed integrity refused, a toolkit's module required, and Clear list", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  saved(db, access, (draft) => draft.toolkits.installed.push("global-search"));
  await open(page, access, "runtime-modules");
  const required = page.locator("[data-module='@deweb/global-search']");
  await expect(required).toContainText("Required by Global Search");
  await expect(required.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  await page.getByLabel("Module to include").selectOption("@deweb/analytics");
  await page.getByRole("button", { name: "Include in runtime" }).click();
  const analytics = page.locator("[data-module='@deweb/analytics']");
  await expect(analytics).toContainText("@deweb/analytics");
  await expect(page.locator("[data-module-count]")).toHaveText(`5 of 20 modules`);
  await analytics.getByLabel("integrity").fill("abc");
  await expect(analytics.getByText("Enter a sha256, sha384, or sha512 hash")).toBeVisible();
  await analytics.getByLabel("integrity").fill("sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC");
  await expect(analytics.getByText("Enter a sha256, sha384, or sha512 hash")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear list" }).click();
  await expect(analytics).toHaveCount(0);
  await expect(required).toBeVisible();
});

test("Crash Error: the preview follows the copy", async ({ page, db }) => {
  const access = onboardPortal(db, "Access");
  await open(page, access, "crash-error");
  await page.getByLabel("Title").fill("We hit a snag");
  await page.getByLabel("Support link").fill("/support");
  await expect(page.locator("[data-crash-preview]")).toContainText("We hit a snag");
  await expect(page.locator("[data-crash-preview]")).toContainText("Get support");
  await expect(pending(page)).toHaveText("2 unsaved changes");
});
