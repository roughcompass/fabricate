import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "@repo-facts/contract";
import { findingsOf } from "../src/lib/evaluations/evaluation-records";
import { profileDocument, profilesOf } from "../src/lib/profiles/profile-records";
import { reviseRelease } from "../src/lib/standards/publish";
import { templateBySlug } from "../src/lib/demo/catalog";
import { createApplication, validateDeployInput } from "../src/lib/demo/deployments";
import { WORKSPACE_COOKIE } from "../src/lib/demo/workspace-key";
import { ensureWorkspace } from "../src/lib/demo/workspaces";
import { standardById } from "../src/lib/standards/standard-records";
import { buildInitiative, buildSource } from "../test/support/builders";
import { manifest } from "../test/support/profiles";
import { publishStandard, seedAssessment, selectReleases } from "../test/support/scenarios";
import { expect, expectNoHorizontalOverflow, expectNoNestedBorders, expectNoOverlappingContent, gitRepo, test } from "./support/fixtures";
import { setView, waitForRegions } from "./support/demo";
import { BASELINE_CONTROLS, ORDERS, SERVICE_CONTROLS, evaluate } from "./support/results";

/**
 * Captures every product surface at desktop and mobile width, in the light and
 * dark themes, after checking each for overflow, overlapping content, and
 * nested bordered containers. Run with `npm run test:visual`; screenshots are
 * written to verification/screenshots.
 */

const OUTPUT = path.resolve("verification/screenshots");
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];
const THEMES = ["light", "dark"] as const;

test.skip(!process.env.CAPTURE_SCREENSHOTS, "Set CAPTURE_SCREENSHOTS=1 (npm run test:visual) to capture screenshots.");
test.setTimeout(600_000);

test("captures every product surface at desktop and mobile width, in both themes", async ({ page, db, sourcesDir, baseURL }) => {
  const names = ["web", "client", "ui-a", "ui-b", "orders", "billing"];
  const sources = names.map((name) => buildSource(db, { name }));
  buildSource(db, { name: "legacy-ui", enabled: false });
  const initiative = buildInitiative(db, { name: "Checkout platform migration", sources });
  const assessment = await seedAssessment(db, initiative, sources, [
    {
      "package.json": manifest({ name: "web", version: "1.0.0", private: true, dependencies: { "@acme/client": "^1.0.0", "@acme/ui": "^2.0.0", "left-pad": "^1.3.0", "legacy-ui": "^0.1.0" } }),
      "src/payments.ts": 'export const charge = () => fetch("https://payments.invalid/v1/charges", { method: "POST" });\n',
    },
    { "package.json": manifest({ name: "@acme/client", version: "1.0.0" }) },
    { "package.json": manifest({ name: "@acme/ui", version: "2.0.0" }) },
    { "package.json": manifest({ name: "@acme/ui", version: "2.1.0" }) },
    ORDERS,
    "failed",
  ]);
  const baseline = publishStandard(db, "Engineering baseline", BASELINE_CONTROLS);
  const services = publishStandard(db, "Service readiness", SERVICE_CONTROLS);
  selectReleases(db, initiative, [baseline, services]);
  const evaluation = await evaluate(db, initiative.publicId, assessment.publicId);
  const orders = profilesOf(db, assessment.id).find(({ target }) => target.sourceName === "orders")!.profile;
  const evidenceId = Object.keys((profileDocument(orders).fact_document as JsonObject).evidence as JsonObject)[0]!;
  const gap = findingsOf(db, evaluation.id, { controlKey: "services-configurable", outcomes: ["gap"] })[0]!;
  const indeterminate = findingsOf(db, evaluation.id, { controlKey: "verified-runtime", outcomes: ["indeterminate"] })[0]!;
  // A draft of the baseline, so the editor and the publication review have something to show.
  reviseRelease(db, baseline.publicId);
  const baselineStandard = standardById(db, baseline.standardId);
  const servicesStandard = standardById(db, services.standardId);
  for (const name of ["payments", "ledger"]) gitRepo(path.join(sourcesDir, name));

  const surfaces: [name: string, url: string][] = [
    ["01-initiatives", "/"],
    ["02-initiative", `/initiatives/${initiative.publicId}`],
    ["02-initiative-new", "/initiatives/new"],
    ["02-initiative-edit", `/initiatives/${initiative.publicId}/edit`],
    ["03-sources", "/sources"],
    ["03-source-new", "/sources/new"],
    ["03-source-edit", `/sources/${sources[0]!.publicId}/edit`],
    ["03-import", `/sources/import?directory=${encodeURIComponent(sourcesDir)}`],
    ["04-standards", "/standards"],
    ["04-standard", `/standards/${baselineStandard.publicId}`],
    ["04-standard-published", `/standards/${servicesStandard.publicId}`],
    ["04-standard-new", "/standards/new"],
    ["04-standard-edit", `/standards/${baselineStandard.publicId}/edit`],
    ["04-draft", `/standards/${baselineStandard.publicId}/draft`],
    ["04-publish", `/standards/${baselineStandard.publicId}/publish`],
    ["04-release", `/standards/${servicesStandard.publicId}/releases/${services.publicId}`],
    ["05-assessment", `/assessments/${assessment.publicId}`],
    ["06-profile", `/profiles/${orders.publicId}`],
    ["06-evidence", `/assessments/${assessment.publicId}/evidence/${evidenceId}`],
    ["07-map", `/assessments/${assessment.publicId}/map`],
    ["07-map-nodes", `/assessments/${assessment.publicId}/map?view=nodes`],
    ["08-evaluation", `/evaluations/${evaluation.publicId}`],
    ["08-finding-gap", `/evaluations/${evaluation.publicId}/findings/${gap.publicId}`],
    ["08-finding-indeterminate", `/evaluations/${evaluation.publicId}/findings/${indeterminate.publicId}`],
    ["09-design-system", "/design-system"],
    ["09-not-found", "/assessments/asm_doesnotexist0000"],
  ];

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const theme of THEMES) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(url);
        // The development server's floating indicator is not part of the product.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await expectNoNestedBorders(page);
        await page.screenshot({ path: path.join(OUTPUT, `${name}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(OUTPUT)).toHaveLength(surfaces.length * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures each portal shell of the template demo, with its hero application,
 * at desktop and mobile width in both runtime themes. Portals are application
 * content, so only overflow and overlap are checked, not the operator rules.
 */
test("captures every portal shell at desktop and mobile width, in both runtime themes", async ({ page, db: _db }) => {
  const output = path.join(OUTPUT, "portals");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const heroes = ["payments-workspace", "client-onboarding", "market-watch", "operations-console"];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const slug of heroes) {
      await page.goto(`/run/ref-${slug}`);
      await waitForRegions(page);
      for (const theme of THEMES) {
        await setView(page, { theme });
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-theme", theme);
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await page.screenshot({ path: path.join(output, `${slug}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(heroes.length * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures the template demo's operator surfaces: the create page and the
 * import, the gallery, template detail, preview mode on every device and
 * orientation and its Code tab, the deploy form, building and ready
 * applications, and the Applications list. A building application is created
 * just before each capture of it, so it is always mid-build.
 */
test("captures every template demo surface at desktop and mobile width, in both themes", async ({ page, context, db, baseURL }) => {
  const output = path.join(OUTPUT, "demo");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  await page.goto("/new");
  const key = (await context.cookies()).find((cookie) => cookie.name === WORKSPACE_COOKIE)!.value;
  const workspace = ensureWorkspace(db, key);
  const ready = createApplication(db, workspace.id, templateBySlug("payments-workspace")!, validateDeployInput({ name: "Treasury payments", environment: "dev", project: "PAY", repository: "treasury-payments" }), new Date(Date.now() - 10 * 60_000));
  createApplication(db, workspace.id, templateBySlug("market-watch")!, validateDeployInput({ name: "Rates desk", environment: "sandbox", project: "", repository: "" }), new Date(Date.now() - 60 * 60_000));
  let building = 0;
  const buildingApplication = () =>
    `/applications/${createApplication(db, workspace.id, templateBySlug("client-onboarding")!, validateDeployInput({ name: `Onboarding ${++building}`, environment: "dev", project: "GB", repository: `onboarding-${building}` })).publicId}`;

  const previews = (["mobile", "tablet", "desktop"] as const).flatMap((device) =>
    (["portrait", "landscape"] as const).map((orientation): [string, string] => [`13-preview-${device}-${orientation}`, `/templates/market-watch/preview?device=${device}&orientation=${orientation}`]),
  );
  const surfaces: [name: string, url: string | (() => string)][] = [
    ["10-create", "/new"],
    ["10-create-markets", "/new?brand=markets"],
    ["10-import", "/new?provider=bitbucket"],
    ["10-import-form", "/new/import?project=PAY&repository=payee-hub"],
    ["11-gallery", "/templates"],
    ["11-gallery-filtered", "/templates?brand=payments&brand=markets&provider=de-web"],
    ["12-template", "/templates/payments-workspace"],
    ...previews,
    ["13-preview-code", "/templates/payments-workspace/preview?view=code&file=microfrontends.json"],
    ["14-deploy", "/templates/payments-workspace/deploy"],
    ["15-application-building", buildingApplication],
    ["15-application-ready", `/applications/${ready.publicId}`],
    ["15-applications", "/applications"],
  ];

  for (const theme of THEMES) {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(typeof url === "function" ? url() : url);
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (name.startsWith("13-preview-") && name !== "13-preview-code") {
          const frame = (await (await page.locator("[data-preview-frame]").elementHandle())!.contentFrame())!;
          await frame.waitForFunction(() => document.querySelector("[data-demo-mfe]") && !document.querySelector('[data-demo-mfe]:not([data-demo-state="ready"])'), null, { timeout: 15_000 });
        }
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await expectNoNestedBorders(page);
        await page.screenshot({ path: path.join(output, `${name}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(surfaces.length * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures each hero application with each toolbar tool open, in both
 * application themes, with the toolbar in the matching operator theme.
 */
test("captures each toolbar tool over every hero application, in both themes", async ({ page, context, db: _db, baseURL }) => {
  const output = path.join(OUTPUT, "toolbar");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const heroes = ["payments-workspace", "client-onboarding", "market-watch", "operations-console"];
  const tools: [name: string, button: string, dialog: string][] = [
    ["microfrontends", "Open microfrontends", "Microfrontends"],
    ["accessibility", "Open accessibility audit", "Accessibility"],
    ["timing", "Open timing", "Timing"],
    ["settings", "Open settings", "Settings"],
    ["share", "Open sharing", "Share"],
    ["comments", "Open comments", "Comments"],
  ];
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of THEMES) {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const slug of heroes) {
      await page.goto(`/run/ref-${slug}`);
      await waitForRegions(page);
      await setView(page, { theme });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      if (theme === "light") {
        // One comment per hero, so the comments list and a pin show.
        await page.keyboard.press("c");
        await page.locator("[data-demo-mfe] [data-demo-anchor]").first().click();
        const composer = page.getByRole("dialog", { name: "New comment" });
        if (await composer.getByLabel("Your name").count()) await composer.getByLabel("Your name").fill("Sam Rivera");
        await composer.getByLabel("Comment", { exact: true }).fill("Can this use the shared component?");
        await composer.getByRole("button", { name: "Post comment" }).click();
        await expect(composer).toBeHidden();
        await page.getByRole("dialog", { name: "Comment 1" }).getByRole("button", { name: "Close comment" }).click();
      }
      for (const [name, button, dialog] of tools) {
        await page.getByRole("button", { name: button }).click();
        const panel = page.getByRole("dialog", { name: dialog });
        await expect(panel).toBeVisible();
        if (name === "accessibility") {
          await panel.getByRole("button", { name: /Run audit/ }).click();
          await expect(panel.locator("[data-audit-result]").first()).toBeVisible();
        }
        if (name === "share") await expect(panel.getByLabel("Link to this view")).toBeVisible();
        await page.screenshot({ path: path.join(output, `${slug}-${name}-${theme}.jpg`), type: "jpeg", quality: 75 });
      }
      await page.keyboard.press("Escape");
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(heroes.length * tools.length * THEMES.length);
});
