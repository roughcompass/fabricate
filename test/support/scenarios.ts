import crypto from "node:crypto";
import { DETECTOR_RELEASE, detectorConfiguration } from "@repo-facts/bundle";
import { type JsonObject, type MemoryFile, digestOf } from "@repo-facts/contract";
import { type Assessment, type AssessmentTarget, createAssessment, getAssessment, linkSurvey } from "@/lib/assessments/assessment-records";
import { continueWaitingTargets } from "@/lib/assessments/waiting";
import { surveyRefFor } from "@/lib/acquisition/mirror";
import { sourceById } from "@/lib/catalog/source-records";
import { type Survey, currentRecipe, moveSurvey, pinSurvey, recordConfiguredResolution, requestSurvey, updateCurrentSurvey } from "@/lib/surveys/records";
import { finishSurvey } from "@/lib/surveys/run";
import { requestCancellation, transitionAssessment, transitionTarget } from "@/lib/assessments/transitions";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import { type Db, immediate } from "@/lib/db/client";
import type { SurveyTrigger } from "@/lib/db/schema";
import { type Initiative, getInitiative, selectedSources, updateInitiative } from "@/lib/initiatives/initiative-records";
import { insertProfile } from "@/lib/profiles/profile-records";
import { finalizeRelationshipMap, resolveMapDocument } from "@/lib/relationships/finalize";
import { insertRelationshipMap } from "@/lib/relationships/map-records";
import { publishDraft } from "@/lib/standards/publish";
import { type StandardRelease, createStandard, saveDraft } from "@/lib/standards/standard-records";
import { buildInitiative, buildSource } from "./builders";
import { manifest, memoryProfile, sha1 } from "./profiles";
import { standardDocument } from "./standards";
import { CURRENT_VERSION } from "@/lib/documents/schemas";

/** How one target of a seeded Assessment ends. */
export type Outcome = Readonly<Record<string, MemoryFile>> | "failed" | "canceled";

/**
 * A repository whose Profile has observed, inferred, mixed, conflicting,
 * unknown, and absent categories, a skipped input, and two unavailable
 * Service Dependencies with literal endpoints and no contract or substitute.
 */
export const ORDERS = {
  "package.json": manifest({ name: "orders", version: "1.0.0", engines: { node: ">=20" }, dependencies: { axios: "^1.6.0" } }),
  ".nvmrc": "18\n",
  "yarn.lock": "# yarn lockfile v1\n\n",
  ".github/workflows/ci.yml": "name: ci\non: [push\njobs: {",
  "src/payments.ts": 'export async function charge(id: string) {\n  const res = await fetch("https://payments.invalid/v1/charges", { method: "POST", body: JSON.stringify({ id }) });\n  const body = await res.json();\n  return body.status;\n}\n',
  "src/ledger.ts": 'const proxy = process.env.HTTPS_PROXY;\nexport async function entries() {\n  const res = await fetch("https://ledger.corp.internal/entries", { headers: { authorization: `Bearer ${process.env.LEDGER_TOKEN}` } });\n  return (await res.json()).items;\n}\n',
};

const STOREFRONT_DEPENDENCIES = { react: "19.1.0", "react-dom": "19.1.0" };
const STOREFRONT_DEV_DEPENDENCIES = { vite: "7.0.0", vitest: "3.2.0", eslint: "9.30.0", typescript: "5.8.3" };

/**
 * A React application built with Vite whose Profile has 2 production and 4
 * development dependencies, each resolved by its lockfile, 4 scripts, a CI
 * workflow with two run steps, an unknown composition, and two Service
 * Dependencies: one with a literal endpoint and one whose endpoint a caller supplies.
 */
export const STOREFRONT = {
  "package.json": manifest({
    name: "storefront",
    version: "2.1.0",
    private: true,
    engines: { node: ">=22" },
    scripts: { build: "vite build", test: "vitest run", lint: "eslint .", start: "vite" },
    dependencies: STOREFRONT_DEPENDENCIES,
    devDependencies: STOREFRONT_DEV_DEPENDENCIES,
  }),
  "package-lock.json": manifest({
    name: "storefront",
    version: "2.1.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "storefront", version: "2.1.0", dependencies: STOREFRONT_DEPENDENCIES, devDependencies: STOREFRONT_DEV_DEPENDENCIES },
      ...Object.fromEntries(Object.entries(STOREFRONT_DEPENDENCIES).map(([name, version]) => [`node_modules/${name}`, { version }])),
      ...Object.fromEntries(Object.entries(STOREFRONT_DEV_DEPENDENCIES).map(([name, version]) => [`node_modules/${name}`, { version, dev: true }])),
    },
  }),
  ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n",
  "vite.config.ts": 'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
  "src/main.tsx": 'import { createRoot } from "react-dom/client";\nexport const load = () => fetch("https://api.example.test/products");\ncreateRoot(document.body).render(<main>Shop</main>);\n',
  "src/client.ts": "export async function ping(base: string) {\n  return fetch(`${base}/ping`);\n}\n",
};

/**
 * A finished Assessment seeded directly: each target is pinned to a synthetic
 * commit and profiled in memory by the pinned bundle, or ends failed or
 * canceled. The map is finalized and the aggregate outcome recorded, exactly
 * as orchestration would. No Git is involved, so evidence excerpts are not
 * available for these snapshots.
 */
export async function seedAssessment(db: Db, initiative: Initiative, sources: readonly RepositorySource[], outcomes: readonly Outcome[], options: RunOptions = {}): Promise<Assessment> {
  const { assessment, targets } = createAssessment(db, {
    initiative,
    launchToken: crypto.randomUUID(),
    detectorRelease: DETECTOR_RELEASE,
    configuration: detectorConfiguration(getConfig().analysis).configuration,
    profileSchemaVersion: options.profileVersion1 ? 1 : CURRENT_VERSION.repositoryProfile,
    relationshipSchemaVersion: 1,
    sources,
  });
  return completeRun(db, assessment, targets, sources, outcomes, options);
}

/** How a seeded Run ends: canceled, with Profile version 1 documents, or with its resolved map document adjusted before it's stored. */
export interface RunOptions {
  cancel?: boolean;
  profileVersion1?: boolean;
  transformMap?: (document: JsonObject) => JsonObject;
}

/** Drives the queued Run +assessment+ to its end: each target, in +sources+ order, ends as its outcome; then the map and outcome. */
export async function completeRun(
  db: Db,
  assessment: Assessment,
  targets: readonly AssessmentTarget[],
  sources: readonly Pick<RepositorySource, "publicId">[],
  outcomes: readonly Outcome[],
  options: RunOptions = {},
): Promise<Assessment> {
  if (options.cancel) requestCancellation(db, assessment.id);
  for (const [index, outcome] of outcomes.entries()) await completeTarget(db, assessment, targets.find((item) => item.sourcePublicId === sources[index]!.publicId)!, outcome, options);
  const finalizing = finalizingRun(db, assessment);
  if (options.transformMap) insertRelationshipMap(db, { assessment: finalizing, document: options.transformMap(resolveMapDocument(db, finalizing)) });
  else finalizeRelationshipMap(db, finalizing);
  const profiles = outcomes.filter((outcome) => typeof outcome === "object").length;
  const state = options.cancel ? "canceled" : profiles === outcomes.length ? "complete" : profiles > 0 ? "complete_with_issues" : "failed";
  return transitionAssessment(db, finalizing, state, state === "failed" ? { failureReason: "No repository could be assessed" } : {});
}

let surveyed = 0;

/**
 * A background or preview survey of a new synthetic commit of +source+,
 * succeeded with a Profile of +files+, as the survey job writes one. A
 * survey of the configured reference records that reference's resolution,
 * as background surveying does.
 */
export async function seedSurvey(db: Db, source: Pick<RepositorySource, "id" | "publicId" | "name">, options: { trigger?: SurveyTrigger; reference?: string; fromConfiguredReference?: boolean; files?: Readonly<Record<string, MemoryFile>> } = {}): Promise<Survey> {
  const commitSha = sha1(`survey:${source.publicId}:${++surveyed}`);
  const configured = options.fromConfiguredReference ?? true;
  const { survey } = requestSurvey(db, { repositorySourceId: source.id, commitSha, reference: options.reference ?? "refs/heads/main", fromConfiguredReference: configured, trigger: options.trigger ?? "added", ...currentRecipe(getConfig()) });
  if (configured) recordConfiguredResolution(db, source.id, commitSha, new Date());
  const running = pinSurvey(db, moveSurvey(db, survey, "running", { attempts: 1 }), { treeSha: sha1(`tree:${commitSha}`), internalRef: surveyRefFor(survey.publicId) });
  const { document } = await memoryProfile(options.files ?? { "package.json": manifest({ name: source.name, version: "1.0.0" }) }, { public_id: source.publicId, name: source.name }, commitSha);
  return finishSurvey(db, running, { document });
}

/** The Run +assessment+ moved to finalizing, unless its last survey already moved it there, as it does when it completes the last target. */
export function finalizingRun(db: Db, assessment: Pick<Assessment, "publicId">): Assessment {
  const current = getAssessment(db, assessment.publicId);
  return current.state === "finalizing" ? current : transitionAssessment(db, current, "finalizing");
}

/**
 * Ends +target+ as +outcome+: canceled, failed while resolving its
 * reference, or joined to a survey of a synthetic commit under the Run's
 * recipe, which pins it, profiles its files with the pinned bundle, and
 * succeeds, completing the target as a real survey does.
 */
export async function completeTarget(db: Db, assessment: Assessment, target: AssessmentTarget, outcome: Outcome, options: Pick<RunOptions, "profileVersion1"> = {}): Promise<void> {
  if (outcome === "canceled") {
    transitionTarget(db, target, "canceled");
    return;
  }
  const acquiring = transitionTarget(db, target, "acquiring");
  if (outcome === "failed") {
    transitionTarget(db, acquiring, "failed", { failureCode: "source_unavailable", failureMessage: "The repository could not be reached" });
    return;
  }
  const commitSha = sha1(`commit:${target.publicId}`);
  const configured = target.gitRef === sourceById(db, target.repositorySourceId).gitRef;
  const { survey } = requestSurvey(db, {
    repositorySourceId: target.repositorySourceId,
    commitSha,
    reference: "refs/heads/main",
    fromConfiguredReference: configured,
    trigger: "run",
    requestedByAssessmentId: assessment.id,
    surveyorRelease: assessment.detectorRelease,
    configurationDigest: assessment.configurationDigest,
    profileSchemaVersion: assessment.profileSchemaVersion,
  });
  if (configured) recordConfiguredResolution(db, target.repositorySourceId, commitSha, new Date());
  linkSurvey(db, acquiring, { refKind: "default_branch", resolvedRef: "refs/heads/main", surveyId: survey.id });
  const running = pinSurvey(db, moveSurvey(db, survey, "running", { attempts: 1 }), { treeSha: sha1(`tree:${target.publicId}`), internalRef: surveyRefFor(survey.publicId) });
  const { document } = await memoryProfile(outcome, { public_id: target.sourcePublicId, name: target.sourceName }, commitSha);
  // A Profile as an earlier release stored it isn't valid under today's contract, so it's written without validation.
  if (!options.profileVersion1) return void finishSurvey(db, running, { document });
  immediate(db, (tx) => {
    insertProfile(tx, { survey: running, document: asProfileVersion1(document) });
    const finished = moveSurvey(tx, running, "succeeded", {});
    updateCurrentSurvey(tx, finished);
    continueWaitingTargets(tx, finished);
  });
}

/**
 * The outcomes of a Run whose Relationship Map has every edge state and one
 * coverage gap: web's dependencies resolve to client, are ambiguous between
 * ui-a and ui-b, stay unresolved for left-pad, and reach legacy-ui outside the
 * Run; billing fails.
 */
export const MAP_STATE_OUTCOMES: Readonly<Record<string, Outcome>> = {
  web: {
    "package.json": manifest({ name: "web", version: "1.0.0", private: true, dependencies: { "@acme/client": "^1.0.0", "@acme/ui": "^2.0.0", "left-pad": "^1.3.0", "legacy-ui": "^0.1.0" } }),
    "src/payments.ts": 'export const charge = () => fetch("https://payments.invalid/v1/charges", { method: "POST" });\n',
  },
  client: { "package.json": manifest({ name: "@acme/client", version: "1.0.0" }) },
  "ui-a": { "package.json": manifest({ name: "@acme/ui", version: "2.0.0" }) },
  "ui-b": { "package.json": manifest({ name: "@acme/ui", version: "2.1.0" }) },
  billing: "failed",
};

/** Seeds the Run of MAP_STATE_OUTCOMES, and +also+ after it, with legacy-ui in the catalog outside the Run. */
export async function seedMapStates(db: Db, options: { initiativeName?: string; also?: Readonly<Record<string, Outcome>> } = {}) {
  const outcomes = { ...MAP_STATE_OUTCOMES, ...options.also };
  const sources = Object.keys(outcomes).map((name) => buildSource(db, { name }));
  buildSource(db, { name: "legacy-ui" });
  const initiative = buildInitiative(db, { name: options.initiativeName ?? "Fleet assessment", sources });
  const assessment = await seedAssessment(db, initiative, sources, Object.values(outcomes));
  return { initiative, sources, assessment };
}

/** Publishes a Standard with +controls+, reading Repository Profile +profileVersions+, and returns its Release. */
export function publishStandard(db: Db, name: string, controls: readonly JsonObject[], options: { profileVersions?: readonly number[] } = {}): StandardRelease {
  const { standard, draft } = createStandard(db, { name, purpose: `${name} expectations` });
  const saved = saveDraft(db, draft, draft.lockVersion, standardDocument(controls, options));
  return publishDraft(db, standard.publicId, saved.lockVersion);
}

export function selectReleases(db: Db, initiative: Initiative, releases: readonly StandardRelease[]): Initiative {
  const current = getInitiative(db, initiative.publicId);
  return updateInitiative(db, current.publicId, current.lockVersion, {
    name: current.name,
    objective: current.objective,
    selectionMode: current.selectionMode,
    sourcePublicIds: selectedSources(db, current.id).map((source) => source.publicId),
    standardReleasePublicIds: releases.map((release) => release.publicId),
  });
}

/**
 * A Profile as Surveyor release 0.1.0 stored it: a version 1 envelope around
 * fact document version 1, without the design-system categories. Historical
 * Profiles are kept as written, so nothing validates them against the newer
 * contract.
 */
export function asProfileVersion1(document: JsonObject): JsonObject {
  const factDocument = structuredClone(document.fact_document) as JsonObject & { categories: Record<string, unknown> };
  for (const id of ["design_systems", "ui_elements", "style_values"]) delete factDocument.categories[id];
  factDocument.schema_version = 1;
  return { ...document, schema_version: 1, fact_document: factDocument, fact_document_digest: digestOf(factDocument).digest };
}
