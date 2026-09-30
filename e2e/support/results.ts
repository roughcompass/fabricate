import crypto from "node:crypto";
import type { JsonObject } from "@repo-facts/contract";
import { loadConfig } from "../../src/lib/config";
import type { Db } from "../../src/lib/db/client";
import { startEvaluation } from "../../src/lib/evaluations/start";
import { jobHandlers } from "../../src/lib/jobs/registry";
import { drainJobs } from "../../src/lib/jobs/worker";
import { buildInitiative, buildSource } from "../../test/support/builders";
import { manifest } from "../../test/support/profiles";
import { publishStandard, seedAssessment, selectReleases } from "../../test/support/scenarios";
import { E2E_ENV } from "./env";

/** The server's configuration, so jobs run from the test process use its database and storage. */
export const serverConfig = () => loadConfig({ env: { ...process.env, ...E2E_ENV } });

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

const control = (fields: JsonObject): JsonObject => ({ applicability: { op: "always" }, guidance: null, subject: "repository", ...fields });

/** Controls that give ORDERS every outcome: Meets, Gap, Not applicable, and Indeterminate with one or several causes. */
export const BASELINE_CONTROLS: JsonObject[] = [
  control({ key: "has-ci", title: "Runs continuous integration", rationale: "Changes need automated verification before they merge.", severity: "high", condition: { op: "exists", selector: "repository.ci_systems" }, guidance: "Add a workflow that runs the tests." }),
  control({ key: "no-submodules", title: "Declares no submodules", rationale: "Submodules complicate reproducible checkouts.", severity: "low", condition: { op: "compare", selector: "repository.submodule_count", comparator: "eq", value: 0 } }),
  control({ key: "pnpm-only", title: "Uses pnpm", rationale: "One package manager keeps lockfiles reproducible.", severity: "medium", condition: { op: "contains", selector: "repository.package_managers", mode: "all", values: ["pnpm"] } }),
  control({
    key: "react-18",
    title: "Declares React 18 or newer",
    rationale: "The shared component library requires React 18.",
    severity: "medium",
    applicability: { op: "exists", selector: "repository.declared_range", parameter: "react" },
    condition: { op: "semver_satisfies", selector: "repository.declared_range", parameter: "react", range: ">=18.0.0" },
  }),
  control({
    key: "verified-runtime",
    title: "Verified on a current runtime",
    rationale: "Supported runtimes receive security fixes.",
    severity: "high",
    condition: { op: "all", items: [{ op: "exists", selector: "repository.ci_systems" }, { op: "semver_satisfies", selector: "repository.node_range", range: ">=20.0.0" }] },
  }),
];

export const SERVICE_CONTROLS: JsonObject[] = [
  control({
    key: "services-configurable",
    title: "Service destinations are configurable or contracted",
    rationale: "Migrations need to point services at test doubles without code changes.",
    severity: "critical",
    condition: {
      op: "every",
      collection: "service_dependencies",
      condition: { op: "any", items: [{ op: "in", selector: "service.endpoint_derivation", values: ["configured", "host_provided"] }, { op: "equals", selector: "service.has_contract", value: true }] },
    },
    guidance: "Read the base URL from configuration, or commit the service's OpenAPI document.",
  }),
  control({ key: "full-coverage", title: "Every repository was assessed", rationale: "Relationships from a missing repository are unknown.", severity: "info", subject: "relationship_map", condition: { op: "equals", selector: "map.coverage_complete", value: true } }),
];

/** A finished Assessment of ORDERS and a failed billing repository, and an Initiative that selects both Standards. */
export async function seedResults(db: Db) {
  const orders = buildSource(db, { name: "orders" });
  const billing = buildSource(db, { name: "billing" });
  const initiative = buildInitiative(db, { name: "Fleet assessment", sources: [orders, billing] });
  const assessment = await seedAssessment(db, initiative, [orders, billing], [ORDERS, "failed"]);
  const baseline = publishStandard(db, "Engineering baseline", BASELINE_CONTROLS);
  const services = publishStandard(db, "Service readiness", SERVICE_CONTROLS);
  selectReleases(db, initiative, [baseline, services]);
  return { initiative, assessment, baseline, services };
}

/** Starts an Evaluation of the seeded Assessment and runs its jobs to completion. */
export async function evaluate(db: Db, initiativeId: string, assessmentId: string) {
  const { evaluation } = startEvaluation(db, initiativeId, assessmentId, crypto.randomUUID());
  await drainJobs(db, jobHandlers(db, serverConfig()));
  return evaluation;
}
