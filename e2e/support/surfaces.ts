import path from "node:path";
import type { JsonObject } from "@repo-facts/contract";
import type { Db } from "../../src/lib/db/client";
import { findingsOf } from "../../src/lib/evaluations/evaluation-records";
import { profileDocument, profilesOf } from "../../src/lib/profiles/profile-records";
import { reviseRelease } from "../../src/lib/standards/publish";
import { standardById } from "../../src/lib/standards/standard-records";
import { buildInitiative, buildSource } from "../../test/support/builders";
import { manifest } from "../../test/support/profiles";
import { publishStandard, seedAssessment, selectReleases } from "../../test/support/scenarios";
import { gitRepo } from "./fixtures";
import { BASELINE_CONTROLS, ORDERS, SERVICE_CONTROLS, evaluate } from "./results";
import { paths } from "./paths";
import { recordFailedDeConsoleRead } from "../../src/lib/ownership/de-console";
import { readDeConsole } from "../../test/support/home";

/**
 * Every product surface, seeded with data that exercises it: the operator
 * pages, and the template demo's operator pages. The visual capture and the
 * shell's one-heading check both visit these.
 */

export type Surface = [name: string, url: string];

/** Seeds an Initiative with an Assessment, an Evaluation, Standards, and a draft, and returns the operator surfaces. */
export async function seedOperatorSurfaces(db: Db, sourcesDir: string): Promise<Surface[]> {
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
  // A DE Console export that lists one SEAL ID twice records a conflict without creating applications, and a later read fails.
  readDeConsole(db, [{ seal_id: "99001", name: "Markets Hub" }, { seal_id: "99001", name: "Markets Admin" }], new Date(Date.now() - 5 * 3_600_000));
  recordFailedDeConsoleRead(db, { trigger: "schedule", error: "The DE Console didn't answer within 30 seconds", readAt: new Date(Date.now() - 3_600_000) });

  return [
    ["00-home", paths.home],
    ["01-assessments", paths.assessments],
    ["02-initiative", paths.assessment(initiative.publicId)],
    ["02-initiative-new", paths.newAssessment],
    ["02-initiative-edit", paths.assessmentEdit(initiative.publicId)],
    ["03-sources", paths.repositories],
    ["03-source-new", paths.newRepository],
    ["03-source-edit", paths.repositoryEdit(sources[0]!.publicId)],
    ["03-import", `${paths.importRepositories}?directory=${encodeURIComponent(sourcesDir)}`],
    ["03-de-console", "/repositories/de-console"],
    ["04-standards", "/standards"],
    ["04-standard", `/standards/${baselineStandard.publicId}`],
    ["04-standard-published", `/standards/${servicesStandard.publicId}`],
    ["04-standard-new", "/standards/new"],
    ["04-standard-edit", `/standards/${baselineStandard.publicId}/edit`],
    ["04-draft", `/standards/${baselineStandard.publicId}/draft`],
    ["04-publish", `/standards/${baselineStandard.publicId}/publish`],
    ["04-release", `/standards/${servicesStandard.publicId}/releases/${services.publicId}`],
    ["05-assessment", paths.run(assessment.publicId)],
    ["06-profile", `/profiles/${orders.publicId}`],
    ["06-evidence", paths.evidence(assessment.publicId, evidenceId)],
    ["07-map", paths.runMap(assessment.publicId)],
    ["07-map-unassigned", `${paths.runMap(assessment.publicId)}/unassigned`],
    ["08-evaluation", `/evaluations/${evaluation.publicId}`],
    ["08-finding-gap", `/evaluations/${evaluation.publicId}/findings/${gap.publicId}`],
    ["08-finding-indeterminate", `/evaluations/${evaluation.publicId}/findings/${indeterminate.publicId}`],
    ["09-design-system", "/design-system"],
    ["09-not-found", "/runs/asm_doesnotexist0000"],
  ];
}

/** The template demo's operator surfaces, which need no seeding. */
export function demoSurfaces(): Surface[] {
  const previews = (["mobile", "tablet", "desktop"] as const).flatMap((device) =>
    (["portrait", "landscape"] as const).map((orientation): Surface => [`13-preview-${device}-${orientation}`, `/templates/market-watch/preview?device=${device}&orientation=${orientation}`]),
  );
  return [
    ["11-gallery", "/templates"],
    ["11-gallery-filtered", "/templates?brand=payments&brand=markets&provider=de-web"],
    ["12-template", "/templates/payments-workspace"],
    ...previews,
    ["13-preview-code", "/templates/payments-workspace/preview?view=code&file=microfrontends.json"],
  ];
}
