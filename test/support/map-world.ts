import crypto from "node:crypto";
import { DETECTOR_RELEASE, detectorConfiguration } from "@repo-facts/bundle";
import type { JsonObject, MemoryFile } from "@repo-facts/contract";
import { type Assessment, createAssessment, getAssessment, recordSnapshot } from "@/lib/assessments/assessment-records";
import { transitionAssessment, transitionTarget } from "@/lib/assessments/transitions";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { CURRENT_VERSION } from "@/lib/documents/schemas";
import { type AssertionClaim, type SealApplication, ensureApplication, ensureLineOfBusiness, ensurePortal, recordAssertion } from "@/lib/ownership/records";
import { insertProfile } from "@/lib/profiles/profile-records";
import { profileProblems } from "@/lib/profiles/schema";
import { resolveMapDocument } from "@/lib/relationships/finalize";
import { insertRelationshipMap } from "@/lib/relationships/map-records";
import { buildInitiative, buildSource } from "./builders";
import { manifest, memoryProfile, sha1 } from "./profiles";

/*
 * A Run with portals, claims across two Lines of Business, and unclaimed
 * repositories, built through the real profiling, resolution, and projection
 * paths. The Access portal's host composes four applications by Module
 * Federation, reaches one of them a second way by an import map, and leaves
 * a claimed application unloaded; three applications share a design-tokens
 * library built in the Run; two unclaimed repositories form a runtime system.
 */

const federationHost = (name: string, remotes: Record<string, number>, extra: Record<string, MemoryFile> = {}) => ({
  "package.json": manifest({ name, version: "1.0.0", dependencies: { react: "^18.3.1" }, devDependencies: { webpack: "5.98.0" } }),
  "webpack.config.cjs": [
    'const { ModuleFederationPlugin } = require("webpack").container;',
    "module.exports = {",
    `  plugins: [new ModuleFederationPlugin({ name: "${name.replace(/-./g, (part) => part[1]!.toUpperCase())}", remotes: { ${Object.entries(remotes)
      .map(([remote, port]) => `${remote}: "${remote}@http://127.0.0.1:${port}/remoteEntry.js"`)
      .join(", ")} } })],`,
    "};",
    "",
  ].join("\n"),
  ...extra,
});

const federationRemote = (name: string, federationName: string, dependencies: Record<string, string> = {}) => ({
  "package.json": manifest({ name, version: "1.0.0", dependencies, devDependencies: { webpack: "5.98.0" } }),
  "webpack.config.cjs": `const { ModuleFederationPlugin } = require("webpack").container;\nmodule.exports = { plugins: [new ModuleFederationPlugin({ name: "${federationName}", filename: "remoteEntry.js", exposes: { "./App": "./src/App" } })] };\n`,
});

const tokens = { "@acme/design-tokens": "^1.0.0", react: "^18.3.1" };

export const MAP_WORLD: Record<string, Record<string, MemoryFile>> = {
  "access-shell": federationHost(
    "access-shell",
    { fxBoard: 9101, rates: 9102, payeeHub: 9103, legacyTool: 9104 },
    { "src/index.html": '<script type="systemjs-importmap">\n{ "imports": { "fx-board": "http://127.0.0.1:9101/fx-board.js" } }\n</script>\n' },
  ),
  "fx-board": federationRemote("fx-board", "fxBoard", tokens),
  rates: federationRemote("rates", "rates", tokens),
  "payee-hub": federationRemote("payee-hub", "payeeHub", tokens),
  "design-tokens": { "package.json": manifest({ name: "@acme/design-tokens", version: "1.0.0" }) },
  ledger: { "package.json": manifest({ name: "ledger", version: "1.0.0", dependencies: { react: "^18.3.1" } }) },
  "legacy-tool": federationRemote("legacy-tool", "legacyTool"),
  "orphan-shell": federationHost("orphan-shell", { orphanWidget: 9201 }),
  "orphan-widget": federationRemote("orphan-widget", "orphanWidget"),
  scratch: { "package.json": manifest({ name: "scratch", version: "1.0.0" }) },
};

export type MapClaims = ReturnType<typeof claimMapWorld>;

export interface MapWorldRun {
  assessment: Assessment;
  sources: Record<string, RepositorySource>;
}

export type MapWorld = MapWorldRun & MapClaims;

export interface MapWorldOptions {
  /** Adds a resolved runtime contract from payee-hub to its host, which today's resolver can't match by origin. */
  runtimeContract?: boolean;
}

/** The map world's Run, with no claims recorded, as for a Run started before anyone claimed its repositories. */
export async function seedMapWorldRun(db: Db, options: MapWorldOptions = {}): Promise<MapWorldRun> {
  const names = Object.keys(MAP_WORLD);
  const sources = Object.fromEntries(names.map((name) => [name, buildSource(db, { name })]));
  const initiative = buildInitiative(db, { name: "Fleet assessment", sources: Object.values(sources) });
  const assessment = await seedRun(db, initiative, Object.values(sources), names.map((name) => MAP_WORLD[name]!), options.runtimeContract ? addRuntimeContract : (document) => document);
  return { assessment, sources };
}

/** The map world's Run and its claims. */
export async function seedMapWorld(db: Db, options: MapWorldOptions = {}): Promise<MapWorld> {
  const run = await seedMapWorldRun(db, options);
  return { ...run, ...claimMapWorld(db, run.sources) };
}

const claimant = { source: "person" as const, providedBy: "ana@example.com" };

/** The claims of the map world: who owns what, in which portal, under which Line of Business. */
export function claimMapWorld(db: Db, sources: Record<string, RepositorySource>, at = new Date()) {
  const linesOfBusiness = { payments: ensureLineOfBusiness(db, "Payments"), markets: ensureLineOfBusiness(db, "Markets") };
  const applications = {
    shell: ensureApplication(db, "SEAL-100", "Access shell"),
    fx: ensureApplication(db, "SEAL-200", "FX Board"),
    rates: ensureApplication(db, "SEAL-300", "Rates"),
    payee: ensureApplication(db, "SEAL-400", "Payee hub"),
    design: ensureApplication(db, "SEAL-500", "Design system"),
    ledger: ensureApplication(db, "SEAL-600", "Ledger"),
  };
  const portals = { access: ensurePortal(db, "Access"), markets: ensurePortal(db, "Markets") };
  const assert = (claim: AssertionClaim) => recordAssertion(db, { ...claim, ...claimant, recordedAt: at });

  const repositories: [string, SealApplication][] = [
    ["access-shell", applications.shell],
    ["fx-board", applications.fx],
    ["rates", applications.rates],
    ["payee-hub", applications.payee],
    ["design-tokens", applications.design],
    ["ledger", applications.ledger],
  ];
  for (const [name, application] of repositories) assert({ attribute: "seal_id", repository: sources[name]!.id, application: application.id });
  for (const application of [applications.shell, applications.payee, applications.design, applications.ledger]) assert({ attribute: "line_of_business", application: application.id, lineOfBusiness: linesOfBusiness.payments.id });
  for (const application of [applications.fx, applications.rates]) assert({ attribute: "line_of_business", application: application.id, lineOfBusiness: linesOfBusiness.markets.id });
  for (const application of [applications.fx, applications.rates, applications.payee, applications.ledger]) assert({ attribute: "portal", operation: "add", application: application.id, portal: portals.access.id });
  assert({ attribute: "portal", operation: "add", application: applications.fx.id, portal: portals.markets.id });
  assert({ attribute: "owner", portal: portals.access.id, application: applications.shell.id });
  assert({ attribute: "host", portal: portals.access.id, repository: sources["access-shell"]!.id });
  assert({ attribute: "owner", portal: portals.markets.id, application: applications.fx.id });
  return { applications, portals, linesOfBusiness };
}

/** Seeds a finished Assessment like seedAssessment, letting the test adjust the resolved map document before it's stored. */
async function seedRun(db: Db, initiative: ReturnType<typeof buildInitiative>, sources: readonly RepositorySource[], trees: readonly Record<string, MemoryFile>[], transform: (document: JsonObject) => JsonObject): Promise<Assessment> {
  const { assessment, targets } = createAssessment(db, {
    initiative,
    launchToken: crypto.randomUUID(),
    detectorRelease: DETECTOR_RELEASE,
    configuration: detectorConfiguration(getConfig().analysis).configuration,
    profileSchemaVersion: CURRENT_VERSION.repositoryProfile,
    relationshipSchemaVersion: 1,
    sources,
  });
  for (const [index, files] of trees.entries()) {
    const target = targets.find((item) => item.sourcePublicId === sources[index]!.publicId)!;
    const acquiring = transitionTarget(db, target, "acquiring");
    const snapshot = recordSnapshot(db, acquiring, { commitSha: sha1(`commit:${target.publicId}`), treeSha: sha1(`tree:${target.publicId}`), refKind: "default_branch", resolvedRef: "refs/heads/main", acquisitionMetadata: {} });
    const analyzing = transitionTarget(db, acquiring, "analyzing");
    const { document } = await memoryProfile(files, { public_id: target.sourcePublicId, name: target.sourceName }, snapshot.commitSha);
    insertProfile(db, { assessment, target: analyzing, snapshot, document, validate: profileProblems });
    transitionTarget(db, analyzing, "complete");
  }
  const finalizing = transitionAssessment(db, getAssessment(db, assessment.publicId), "finalizing");
  insertRelationshipMap(db, { assessment: finalizing, document: transform(resolveMapDocument(db, finalizing)) });
  return transitionAssessment(db, finalizing, "complete");
}

/** A resolved runtime contract from payee-hub to access-shell, citing payee-hub's own evidence. */
function addRuntimeContract(document: JsonObject): JsonObject {
  const nodes = document.nodes as { id: string; kind: string; source?: { name: string } }[];
  const edges = document.edges as JsonObject[];
  const node = (name: string) => nodes.find((item) => item.kind === "repository" && item.source?.name === name)!.id;
  const evidence = (edges.find((edge) => edge.from === node("payee-hub"))!.evidence as string[]).slice(0, 1);
  const contract = {
    id: `edge_${crypto.createHash("sha256").update("contract:payee-hub").digest("hex").slice(0, 24)}`,
    type: "runtime_contract",
    from: node("payee-hub"),
    to: node("access-shell"),
    state: "resolved",
    candidates: [],
    reference: { type: "runtime_contract", role: "sender", identifier: { contract: "postMessage", origin: "http://127.0.0.1:9100" } },
    rule: "runtime-contract.served-origin",
    basis: "observed",
    reason: null,
    evidence,
    details: {},
  };
  return { ...document, edges: [...edges, contract].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)) };
}
