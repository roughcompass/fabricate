import path from "node:path";
import type { JsonObject } from "@repo-facts/contract";
import type { Db } from "../../src/lib/db/client";
import { findingsOf } from "../../src/lib/evaluations/evaluation-records";
import { profileDocument, profilesOf } from "../../src/lib/profiles/profile-records";
import { reviseRelease } from "../../src/lib/standards/publish";
import { standardById } from "../../src/lib/standards/standard-records";
import { ORDERS, publishStandard, seedMapStates, selectReleases } from "../../test/support/scenarios";
import { gitRepo } from "./fixtures";
import { BASELINE_CONTROLS, SERVICE_CONTROLS, evaluate } from "./results";
import { paths } from "./paths";

/**
 * Every product surface, seeded with data that exercises it: the operator
 * pages, and the template demo's operator pages. The visual capture and the
 * shell's one-heading check both visit these.
 */

export type Surface = [name: string, url: string];

/** Seeds an Initiative with an Assessment, an Evaluation, Standards, and a draft, and returns the operator surfaces. */
export async function seedOperatorSurfaces(db: Db, sourcesDir: string): Promise<Surface[]> {
  const { assessment, sources: repositories, run } = await seedMapStates(db, { assessmentName: "Checkout platform migration", also: { orders: ORDERS } });
  const baseline = publishStandard(db, "Engineering baseline", BASELINE_CONTROLS);
  const services = publishStandard(db, "Service readiness", SERVICE_CONTROLS);
  selectReleases(db, assessment, [baseline, services]);
  const evaluation = await evaluate(db, assessment.publicId, run.publicId);
  const orders = profilesOf(db, run.id).find(({ target }) => target.repositoryName === "orders")!.profile;
  const evidenceId = Object.keys((profileDocument(orders).fact_document as JsonObject).evidence as JsonObject)[0]!;
  const gap = findingsOf(db, evaluation.id, { controlKey: "services-configurable", outcomes: ["gap"] })[0]!;
  const indeterminate = findingsOf(db, evaluation.id, { controlKey: "verified-runtime", outcomes: ["indeterminate"] })[0]!;
  // A draft of the baseline, so the editor and the publication review have something to show.
  reviseRelease(db, baseline.publicId);
  const baselineStandard = standardById(db, baseline.standardId);
  const servicesStandard = standardById(db, services.standardId);
  for (const name of ["payments", "ledger"]) gitRepo(path.join(sourcesDir, name));

  return [
    ["00-home", paths.home],
    ["01-assessments", paths.assessments],
    ["02-assessment", paths.assessment(assessment.publicId)],
    ["02-assessment-new", paths.newAssessment],
    ["02-assessment-edit", paths.assessmentEdit(assessment.publicId)],
    ["03-repositories", paths.repositories],
    ["03-repository-new", paths.newRepository],
    ["03-repository-settings", paths.repositorySettings(repositories[0]!.publicId)],
    ["03-repositories-bulk", paths.bulkRepositories],
    ["03-repository", `/repositories/${repositories[0]!.publicId}`],
    ["03-repository-versions", `/repositories/${repositories[0]!.publicId}/versions`],
    ["04-standards", "/standards"],
    ["04-standard", `/standards/${baselineStandard.publicId}`],
    ["04-standard-published", `/standards/${servicesStandard.publicId}`],
    ["04-standard-new", "/standards/new"],
    ["04-standard-edit", `/standards/${baselineStandard.publicId}/edit`],
    ["04-draft", `/standards/${baselineStandard.publicId}/draft`],
    ["04-publish", `/standards/${baselineStandard.publicId}/publish`],
    ["04-release", `/standards/${servicesStandard.publicId}/releases/${services.publicId}`],
    ["05-run", paths.run(run.publicId)],
    ["06-profile", `/profiles/${orders.publicId}`],
    ["06-evidence", paths.evidence({ run: run.publicId }, evidenceId)],
    ["07-map", paths.runMap(run.publicId)],
    ["07-map-system", `${paths.runMap(run.publicId)}/systems/${(db.$client.prepare("select node_id from graph_nodes where kind = 'repository' and label = 'web'").get() as { node_id: string }).node_id}`],
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
