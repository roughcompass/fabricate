import fs from "node:fs";
import path from "node:path";
import { findingsOf } from "../src/lib/evaluations/evaluation-records";
import { profilesOf } from "../src/lib/profiles/profile-records";
import { standardById } from "../src/lib/standards/standard-records";
import { buildInitiative, buildSource } from "../test/support/builders";
import { manifest } from "../test/support/profiles";
import { publishStandard, seedAssessment, selectReleases } from "../test/support/scenarios";
import { expect, expectNoHorizontalOverflow, expectNoOverlappingContent, test } from "./support/fixtures";
import { BASELINE_CONTROLS, ORDERS, SERVICE_CONTROLS, evaluate } from "./support/results";

/**
 * Captures every product surface at desktop and mobile width for the design
 * review, after checking each for overflow and overlapping content. Run with
 * `npm run test:visual`; screenshots are written to verification/screenshots.
 */

const OUTPUT = path.resolve("verification/screenshots");
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

test.skip(!process.env.CAPTURE_SCREENSHOTS, "Set CAPTURE_SCREENSHOTS=1 (npm run test:visual) to capture screenshots.");
test.setTimeout(180_000);

test("captures the seven product surfaces at desktop and mobile width", async ({ page, db }) => {
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
  const gap = findingsOf(db, evaluation.id, { controlKey: "services-configurable", outcomes: ["gap"] })[0]!;
  const indeterminate = findingsOf(db, evaluation.id, { controlKey: "verified-runtime", outcomes: ["indeterminate"] })[0]!;

  const surfaces: [name: string, url: string][] = [
    ["1-catalog", "/sources"],
    ["2-initiative", `/initiatives/${initiative.publicId}`],
    ["3-standards", "/standards"],
    ["3-standard", `/standards/${standardById(db, baseline.standardId).publicId}`],
    ["4-assessment", `/assessments/${assessment.publicId}`],
    ["5-profile", `/profiles/${orders.publicId}`],
    ["6-map", `/assessments/${assessment.publicId}/map`],
    ["7-evaluation", `/evaluations/${evaluation.publicId}`],
    ["7-finding-gap", `/evaluations/${evaluation.publicId}/findings/${gap.publicId}`],
    ["7-finding-indeterminate", `/evaluations/${evaluation.publicId}/findings/${indeterminate.publicId}`],
  ];

  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const [name, url] of surfaces) {
      await page.goto(url);
      // The development server's floating indicator is not part of the product.
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoOverlappingContent(page);
      await page.screenshot({ path: path.join(OUTPUT, `${name}-${viewport.name}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
    }
  }
});
