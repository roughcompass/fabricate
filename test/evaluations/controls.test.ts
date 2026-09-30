import type { JsonObject, MemoryFile } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { type EvaluationInputs, type ReleaseInput, type TargetInput, evaluateReleaseControls } from "@/lib/evaluations/controls";
import { type CatalogIdentity, type ResolverTarget, resolveRelationships } from "@/lib/relationships/resolve";
import type { MapDocument } from "@/lib/relationships/schema";
import { contributed, manifest, missing } from "../support/profiles";

const toTarget = (target: ResolverTarget): TargetInput => ({
  public_id: target.public_id,
  source: target.source,
  state: target.state,
  failure: target.failure,
  profile: target.profile ? { public_id: `prf_${target.source.name}`, digest: target.profile.digest, commit: String(target.profile.document.commit), factDocument: target.profile.document.fact_document as JsonObject } : null,
});

function inputs(targets: ResolverTarget[], outOfScope: CatalogIdentity[] = []): EvaluationInputs {
  const map = resolveRelationships({ targets, outOfScope }) as unknown as MapDocument;
  return { targets: targets.map(toTarget), map: { public_id: "map_test", digest: "0".repeat(64), document: map } };
}

const release = (...controls: JsonObject[]): ReleaseInput => ({
  public_id: "rel_test",
  digest: "1".repeat(64),
  version: 1,
  standard: "Test Standard",
  document: { schema: "fabricate.standard", schema_version: 1, input_schemas: { repository_profile: [1], relationship_map: [1] }, controls },
});
const control = (key: string, applicability: JsonObject, condition: JsonObject, subject = "repository"): JsonObject => ({ key, title: key, rationale: "Test", severity: "medium", subject, applicability, condition, guidance: `Consider ${key}.` });
const ALWAYS = { op: "always" };

/** Outcomes by subject name for one Control. */
function outcomes(findings: JsonObject[], key: string): Record<string, string> {
  return Object.fromEntries(findings.filter((finding) => (finding.control as JsonObject).key === key).map((finding) => [String((finding.subject as JsonObject).name), String(finding.outcome)]));
}

const CI = { ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n", "package.json": manifest({ name: "ci-app", version: "1.0.0" }) };
const NO_CI = { "package.json": manifest({ name: "no-ci", version: "1.0.0" }) };
const CONFLICT = { "package.json": manifest({ name: "conflict", version: "1.0.0", engines: { node: ">=20" } }), ".nvmrc": "18\n" };
const JS_ONLY: Record<string, MemoryFile> = { "src/app.js": 'export const load = () => fetch("https://api.example.test/orders");\n', "package.json": manifest({ name: "js-only", version: "1.0.0" }) };
const CONFIGURED: Record<string, MemoryFile> = { "src/api.ts": "export const load = () => fetch(`${import.meta.env.VITE_API}/orders`);\n" };
const SKIPPED: Record<string, MemoryFile> = { ...CONFIGURED, "src/broken.ts": "export const = ;\n" };

describe("repository Controls", () => {
  it("produce exactly one Finding per Control and target, over successful, missing, conflicting, and skipped-input Profiles", async () => {
    const targets = [await contributed("ci", CI), await contributed("no-ci", NO_CI), await contributed("conflict", CONFLICT), await contributed("js-only", JS_ONLY), await contributed("configured", CONFIGURED), await contributed("skipped", SKIPPED), missing("billing", "failed")];
    const controls = [
      control("has-ci", ALWAYS, { op: "exists", selector: "repository.ci_systems" }),
      control("node-current", { op: "exists", selector: "repository.node_range" }, { op: "semver_satisfies", selector: "repository.node_range", range: ">=20.0.0" }),
      control("services-configurable", { op: "some", collection: "service_dependencies", condition: ALWAYS }, { op: "every", collection: "service_dependencies", condition: { op: "in", selector: "service.endpoint_derivation", values: ["configured", "host_provided"] } }),
      control("typescript-only", { op: "contains", selector: "repository.languages", mode: "any", values: ["TypeScript"] }, { op: "not", item: { op: "contains", selector: "repository.languages", mode: "any", values: ["JavaScript"] } }),
    ];
    const findings = evaluateReleaseControls(release(...controls), inputs(targets));

    expect(findings).toHaveLength(controls.length * targets.length);
    expect(outcomes(findings, "has-ci")).toMatchObject({ ci: "meets", "no-ci": "gap", billing: "indeterminate" });
    // Conflicting Node declarations: one satisfies the range and one does not.
    expect(outcomes(findings, "node-current")).toMatchObject({ conflict: "indeterminate", ci: "not_applicable", billing: "indeterminate" });
    // A skipped source file may hide a Service Dependency that is not configurable.
    expect(outcomes(findings, "services-configurable")).toMatchObject({ "js-only": "gap", configured: "meets", skipped: "indeterminate", "no-ci": "not_applicable", billing: "indeterminate" });
    expect(outcomes(findings, "typescript-only")).toMatchObject({ "js-only": "not_applicable", configured: "meets", billing: "indeterminate" });
  });

  it("explain each outcome with traces, causes, evidence, and diagnostic guidance", async () => {
    const targets = [await contributed("ci", CI), await contributed("conflict", CONFLICT), await contributed("skipped", SKIPPED), missing("billing", "failed")];
    const findings = evaluateReleaseControls(
      release(
        control("has-ci", ALWAYS, { op: "exists", selector: "repository.ci_systems" }),
        control("node-current", { op: "exists", selector: "repository.node_range" }, { op: "semver_satisfies", selector: "repository.node_range", range: ">=20.0.0" }),
        control("services-configurable", ALWAYS, { op: "every", collection: "service_dependencies", condition: { op: "in", selector: "service.endpoint_derivation", values: ["configured"] } }),
      ),
      inputs(targets),
    );
    const find = (key: string, subject: string) => findings.find((finding) => (finding.control as JsonObject).key === key && (finding.subject as JsonObject).name === subject)!;

    const meets = find("has-ci", "ci");
    expect(meets).toMatchObject({ outcome: "meets", reasoning: expect.stringContaining("expected condition holds"), guidance: { text: "Consider has-ci.", kind: "diagnostic" }, subject: { type: "repository", key: "src_ci", target: "tgt_ci" } });
    expect(Object.values(meets.evidence as JsonObject).map((record) => (record as JsonObject).path)).toContain(".github/workflows/ci.yml");
    expect(meets.condition).toMatchObject({ op: "exists", selector: "repository.ci_systems", observed: ["github-actions"], result: "true" });

    expect(find("has-ci", "billing")).toMatchObject({ outcome: "indeterminate", condition: { result: "unknown" }, causes: [{ reason: "billing has no Profile: its assessment failed (remote_unavailable)" }], subject: { commit: null, profile: null } });
    expect(find("node-current", "conflict")).toMatchObject({ outcome: "indeterminate", causes: [{ selector: "repository.node_range", reason: "The runtime requirements declarations conflict, and the candidates disagree" }] });
    expect((find("services-configurable", "skipped").causes as JsonObject[])[0]!.reason).toMatch(/src\/broken\.ts was skipped \(syntax_error\)/);
  });
});

describe("relationship Controls", () => {
  const root = () =>
    contributed("root", {
      "package.json": manifest({ name: "spa-root", version: "1.0.0", dependencies: { "single-spa": "6.0.3", "@acme/ui": "^1.0.0" } }),
      "src/index.html": '<script type="systemjs-importmap">\n{ "imports": { "spa-orders": "http://127.0.0.1:9001/spa-orders.js", "spa-reports": "http://127.0.0.1:9002/spa-reports.js" } }\n</script>\n',
    });
  const orders = () => contributed("orders", { "package.json": manifest({ name: "spa-orders", version: "1.0.0" }) });
  const composes = (from: string, to: string) =>
    control(`${from}-composes-${to}`, ALWAYS, { op: "some", collection: "edges", where: { op: "all", items: [{ op: "equals", selector: "edge.type", value: "composition" }, { op: "equals", selector: "edge.from", value: from }] }, condition: { op: "equals", selector: "edge.to", value: to } }, "relationship_map");

  it("meet a resolved edge, and stay Indeterminate for unresolved endpoints and relevant coverage gaps instead of reading them as absent", async () => {
    const map = inputs([await root(), await orders(), missing("reports", "failed")], [{ public_id: "src_catalog_ui", name: "@acme/ui", canonical_url: "https://git.example.com/acme/ui" }]);
    const findings = evaluateReleaseControls(
      release(
        composes("root", "orders"),
        composes("root", "reports"),
        control("reports-declares-something", ALWAYS, { op: "some", collection: "edges", where: { op: "equals", selector: "edge.from", value: "reports" }, condition: ALWAYS }, "relationship_map"),
        control("orders-depends-on-nothing-missing", ALWAYS, { op: "some", collection: "edges", where: { op: "all", items: [{ op: "equals", selector: "edge.from", value: "orders" }, { op: "equals", selector: "edge.type", value: "package_dependency" }] }, condition: ALWAYS }, "relationship_map"),
        control("one-out-of-scope", ALWAYS, { op: "count", collection: "edges", where: { op: "equals", selector: "edge.state", value: "out_of_scope" }, comparator: "eq", value: 1 }, "relationship_map"),
        control("some-out-of-scope", ALWAYS, { op: "count", collection: "edges", where: { op: "equals", selector: "edge.state", value: "out_of_scope" }, comparator: "gte", value: 1 }, "relationship_map"),
        control("full-coverage", ALWAYS, { op: "equals", selector: "map.coverage_complete", value: true }, "relationship_map"),
      ),
      map,
    );
    const by = Object.fromEntries(findings.map((finding) => [String((finding.control as JsonObject).key), finding]));

    expect(findings).toHaveLength(7);
    expect(by["root-composes-orders"]).toMatchObject({ outcome: "meets", subject: { type: "relationship_map", key: "relationship_map", map: { coverage_complete: false, coverage_gaps: 1 } } });
    // spa-reports failed, so its edge is unresolved rather than absent.
    expect(by["root-composes-reports"]).toMatchObject({ outcome: "indeterminate" });
    expect((by["root-composes-reports"]!.causes as JsonObject[]).map((cause) => cause.reason).join(" ")).toMatch(/No repository in this Assessment declares a package named spa-reports/);
    // Relationships reports might declare are unknown; orders contributed, so a missing edge from it is a real Gap.
    expect(by["reports-declares-something"]).toMatchObject({ outcome: "indeterminate", causes: [{ reason: "reports has no Profile (failed), so its relationships are not known" }] });
    expect(by["orders-depends-on-nothing-missing"]).toMatchObject({ outcome: "gap" });
    // reports could declare an out-of-scope relationship too, so exactly one is undecidable; at least one is not.
    expect(by["one-out-of-scope"]).toMatchObject({ outcome: "indeterminate" });
    expect(by["some-out-of-scope"]).toMatchObject({ outcome: "meets" });
    expect(by["full-coverage"]).toMatchObject({ outcome: "gap" });
  });

  it("keep an ambiguous endpoint Indeterminate and list its candidates", async () => {
    const shell = await contributed("shell", {
      "package.json": manifest({ name: "mf-shell", version: "1.0.0", devDependencies: { webpack: "5.98.0" } }),
      "webpack.config.cjs": 'const { ModuleFederationPlugin } = require("webpack").container;\nmodule.exports = { plugins: [new ModuleFederationPlugin({ name: "shell", remotes: { admin: "admin@http://127.0.0.1:9101/remoteEntry.js" } })] };\n',
    });
    const remote = (name: string) =>
      contributed(name, { "package.json": manifest({ name, version: "1.0.0" }), "webpack.config.cjs": 'const { ModuleFederationPlugin } = require("webpack").container;\nmodule.exports = { plugins: [new ModuleFederationPlugin({ name: "admin", exposes: { "./App": "./src/App" } })] };\n' });
    const findings = evaluateReleaseControls(release(composes("shell", "admin")), inputs([shell, await remote("admin"), await remote("admin-next")]));

    expect(findings).toEqual([expect.objectContaining({ outcome: "indeterminate" })]);
    expect((findings[0]!.causes as JsonObject[])[0]!.reason).toBe("The endpoint is ambiguous among admin, admin-next");
  });
});
