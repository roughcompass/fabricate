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
