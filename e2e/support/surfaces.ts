import path from "node:path";
import type { JsonObject } from "@repo-facts/contract";
import fs from "node:fs";
import type { Db } from "../../src/lib/db/client";
import { createDraft } from "../../src/lib/mocks/imports";
import { findingsOf } from "../../src/lib/evaluations/evaluation-records";
import { profileDocument, profilesOf } from "../../src/lib/profiles/profile-records";
import { reviseRelease } from "../../src/lib/standards/publish";
import { standardById } from "../../src/lib/standards/standard-records";
import { ORDERS, publishStandard, seedMapStates, selectReleases } from "../../test/support/scenarios";
import { manifest } from "../../test/support/profiles";
import { analyze } from "@repo-facts/bundle";
import { MemoryReader } from "@repo-facts/contract";
import { eq } from "drizzle-orm";
import { surveyRefFor } from "../../src/lib/acquisition/mirror";
import { immediate } from "../../src/lib/db/client";
import { surveys } from "../../src/lib/db/schema";
import { insertProfile } from "../../src/lib/profiles/profile-records";
import { buildProfile } from "../../src/lib/profiles/schema";
import { moveSurvey, pinSurvey } from "../../src/lib/surveys/records";
import { offlineViteApp } from "../../test/support/preview-trees";
import { registered, seeded, seededPreview } from "./applications";
import { mockApplicationId, seedFailedCalls, seedMockSet } from "./mock-sets";
import { gitRepo } from "./fixtures";
import { BASELINE_CONTROLS, SERVICE_CONTROLS, evaluate, serverConfig } from "./results";
import { paths } from "./paths";

/**
 * Every product surface, seeded with data that exercises it: the operator
 * pages, Applications' among them. The visual capture and the shell's
 * one-heading check both visit these.
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

/**
 * Applications' pages: the gallery, a ready application's page, with saved
 * previews, mock sets, and the API calls that failed when its build was
 * captured, and its settings, one still building, with none saved, preview
 * mode, on the tracked branch and on a saved preview, New preview, the mock
 * sets' pages, and onboarding's Data step, for a Profile that reports the
 * APIs the code calls and its MSW handlers.
 */
export async function applicationSurfaces(db: Db, sourcesDir: string): Promise<Surface[]> {
  const repository = registered(db, path.join(sourcesDir, "orders-web"), offlineViteApp());
  const orders = seeded(db, "Orders portal", { description: "Order tracking for partners", repository });
  seededPreview(db, orders, "refs/heads/feature/new-nav");
  seededPreview(db, orders, "refs/heads/fix/totals", { state: "failed" });
  seededPreview(db, orders, "refs/tags/v1.1.0", { state: "latest_failed" });
  seeded(db, "Payments hub", { state: "building" });
  seeded(db, "Admin console", { state: "failed" });
  // Mock sets (add-mock-sets, task 5.8): a default set with rules, one rule needing a response, and an empty set.
  const happy = seedMockSet(db, "orders-portal", [{ pattern: "/v1/orders", query: { mode: "ignore_listed", params: [["limit", "5"]], ignored: ["_"] }, responses: [{ json: { orders: [] } }] }, { method: "POST", pattern: "/v1/orders/search", body: { mode: "json", value: { status: "open" } }, responses: [{ json: { orders: [] } }] }, { pattern: "/v1/rates" }], { default: true, byName: "Presenter" });
  seedMockSet(db, "orders-portal", [], { name: "Errors", description: "Every call failing" });
  const firstRule = (db.$client.prepare("select public_id from mock_rules where set_id = ? order by position limit 1").get(happy.id) as { public_id: string }).public_id;
  // The calls that failed when the current build was captured with "Happy path" (add-mock-sets, task 13.1): one of each kind.
  seedFailedCalls(db, "orders-portal", FAILED_CALLS, { set: happy });
  // The Profile onboarding's Data step reads: the commit eligibility checked, calling the orders API, with MSW handlers.
  const { surveyId } = db.$client.prepare("select survey_id as surveyId from preview_preparations where id = (select latest_preparation_id from applications where slug = 'orders-portal')").get() as { surveyId: number };
  const survey = db.select().from(surveys).where(eq(surveys.id, surveyId)).get()!;
  const factDocument = await analyze(MemoryReader.fromFiles(DATA_STEP_FILES, { commit: survey.commitSha, budgets: serverConfig().analysis }), { entries: [] as JsonObject[] as never });
  const running = pinSurvey(db, moveSurvey(db, survey, "running", { attempts: 1 }), { treeSha: null, internalRef: surveyRefFor(survey.publicId) });
  immediate(db, (tx) => {
    insertProfile(tx, { survey: running, document: buildProfile({ repository: repository.publicId, commit: survey.commitSha, surveyorRelease: survey.surveyorRelease, configurationDigest: survey.configurationDigest, factDocument }) });
    moveSurvey(tx, running, "succeeded", {});
  });
  return [
    ["15-applications", paths.applications],
    ["15-application", paths.application("orders-portal")],
    ["15-application-building", paths.application("payments-hub")],
    ["15-application-failed", paths.application("admin-console")],
    ["15-application-settings", paths.applicationSettings("orders-portal")],
    ["15-application-preview", paths.applicationPreview("orders-portal")],
    ["15-application-preview-tablet", paths.applicationPreview("orders-portal", { device: "tablet" })],
    ["15-application-preview-code", paths.applicationPreview("orders-portal", { view: "code" })],
    ["15-application-preview-saved", paths.applicationPreview("orders-portal", { preview: "feature-new-nav" })],
    ["15-application-preview-saved-later", paths.applicationPreview("orders-portal", { preview: "v1.1.0" })],
    ["15-application-preview-new", paths.newApplicationPreview("orders-portal")],
    ["15-application-new", paths.newApplication()],
    ["15-application-new-search", paths.newApplication({ q: "orders" })],
    ["15-application-new-branch", paths.newApplication({ repository: repository.publicId, from: "repository" })],
    ["16-mock-set", paths.mockSet("orders-portal", happy.publicId)],
    ["16-mock-set-new", paths.newMockSet("orders-portal")],
    ["16-mock-set-edit", paths.mockSetEdit("orders-portal", happy.publicId)],
    ["16-mock-rule-new", paths.newMockRule("orders-portal", happy.publicId)],
    ["16-mock-rule", paths.mockRule("orders-portal", happy.publicId, firstRule)],
    ["16-mock-set-upload", paths.mockSetUpload("orders-portal")],
    ["16-saved-preview-mock-set", paths.savedPreviewMockSet("orders-portal", "feature-new-nav")],
    ["16-mock-set-new-failed-calls", paths.newMockSet("orders-portal", { from: "failed-calls" })],
    ["16-onboarding-data", paths.newApplication({ step: "data", application: "orders-portal" })],
  ];
}

/** One failed call of each kind, as a capture records them. */
const FAILED_CALLS = [
  { url: "https://api.orders.test/v1/rates", kind: "connect" },
  { url: "https://api.orders.test/v1/accounts/42", kind: "status", status: 503, occurrences: 2 },
  { url: "https://auth.orders.test/v1/session", kind: "cors" },
  { method: "POST", url: "https://api.orders.test/v1/exports", kind: "not_mocked", status: 501 },
  { url: "wss://api.orders.test/v1/ticker", kind: "websocket" },
] as const;

/** Orders portal's sources as the Data step's Profile reads them: calls to https://api.orders.test, and MSW handlers. */
const DATA_STEP_FILES = {
  "package.json": manifest({ name: "orders-web", version: "1.0.0", dependencies: { react: "19.3.1", "react-dom": "19.3.1", msw: "2.12.0" }, devDependencies: { vite: "8.3.8" }, scripts: { build: "vite build" } }),
  "src/api.js": 'const API = "https://api.orders.test/v1";\nexport const recentOrders = () => fetch(`${API}/orders?limit=5`);\nexport const account = (id) => fetch(`${API}/accounts/${id}`);\nexport const search = (status) => fetch(`${API}/orders/search`, { method: "POST", body: JSON.stringify({ status }) });\n',
  "src/mocks/handlers.ts": 'import { http, HttpResponse } from "msw";\nexport const handlers = [http.get("https://api.orders.test/v1/orders", () => HttpResponse.json({ orders: [] }))];\n',
};

/**
 * Review HAR for the workspace +workspaceId+, whose upload of Orders
 * portal's Chrome recording it shows: drafts are readable only by the
 * workspace that uploaded them. Seed the application surfaces first.
 */
export function importReviewSurface(db: Db, workspaceId: number): Surface {
  const source = fs.readFileSync(path.resolve("test/fixtures/har/orders-portal.chrome.har"), "utf8");
  const draft = createDraft(db, { applicationId: mockApplicationId(db, "orders-portal"), workspaceId, fileName: "orders-portal.chrome.har", target: null, setName: "Recorded orders", fromOnboarding: false }, source, serverConfig());
  return ["16-mock-set-review", paths.mockSetImport("orders-portal", draft.publicId)];
}
