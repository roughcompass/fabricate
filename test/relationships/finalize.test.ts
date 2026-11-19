import type { JsonObject } from "@repo-facts/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { targetsOf } from "@/lib/runs/run-records";
import { transitionRun, transitionTarget } from "@/lib/runs/transitions";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { MapNotReadyError, finalizeRelationshipMap } from "@/lib/relationships/finalize";
import { mapDocument } from "@/lib/relationships/map-records";
import { type MapDocument, mapProblems } from "@/lib/relationships/schema";
import { buildRun, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { manifest } from "../support/profiles";
import { type Outcome, completeTarget, finalizingRun } from "../support/scenarios";

const UI = { "package.json": manifest({ name: "@acme/ui", version: "1.0.0" }) };
const APP = {
  "package.json": manifest({ name: "orders-app", version: "1.0.0", dependencies: { "@acme/ui": "^1.0.0" }, devDependencies: { webpack: "5.98.0" } }),
  "webpack.config.cjs": 'const { ModuleFederationPlugin } = require("webpack").container;\nmodule.exports = { plugins: [new ModuleFederationPlugin({ name: "shell", remotes: { admin: "admin@http://127.0.0.1:9101/remoteEntry.js" } })] };\n',
  "src/runtime.js": 'window.parent.postMessage({ type: "ready" }, "http://127.0.0.1:9100");\n',
  "src/api.ts": 'export const orders = () => fetch("https://api.example.test/orders");\n',
};
const ADMIN = {
  "package.json": manifest({ name: "admin", version: "1.0.0", devDependencies: { webpack: "5.98.0" } }),
  "webpack.config.cjs": 'const { ModuleFederationPlugin } = require("webpack").container;\nmodule.exports = { plugins: [new ModuleFederationPlugin({ name: "admin", filename: "remoteEntry.js", exposes: { "./App": "./src/App" } })] };\n',
};

describe("Relationship Map finalization", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  /** An Assessment over +sources+ whose targets end as +outcomes+ (a file tree, or a failure). */
  async function assessed(sources: RepositorySource[], outcomes: Outcome[]) {
    const { run, targets } = buildRun(db, { sources });
    for (const [index, outcome] of outcomes.entries()) await completeTarget(db, run, targets.find((item) => item.sourcePublicId === sources[index]!.publicId)!, outcome);
    return finalizingRun(db, run);
  }

  const read = (map: ReturnType<typeof finalizeRelationshipMap>) => mapDocument(map) as unknown as MapDocument;

  it("writes one immutable map from the terminal targets, and returns it again on a repeated finalization", async () => {
    const run = await assessed([buildSource(db, { name: "ui" }), buildSource(db, { name: "app" })], [UI, APP]);

    const first = finalizeRelationshipMap(db, run);
    const again = finalizeRelationshipMap(db, run);
    expect(again.id).toBe(first.id);
    expect(again.digest).toBe(first.digest);
    expect(first).toMatchObject({ resolverVersion: "1", schemaVersion: 1 });
    expect(mapProblems(mapDocument(first))).toEqual([]);
    expect(read(first).coverage.complete).toBe(true);
  });

  it("keeps the package, composition, runtime-contract, and service edges of successful Profiles and records each missing target", async () => {
    const run = await assessed([buildSource(db, { name: "ui" }), buildSource(db, { name: "app" }), buildSource(db, { name: "admin" }), buildSource(db, { name: "billing" })], [UI, APP, ADMIN, "failed"]);
    const map = read(finalizeRelationshipMap(db, run));
    const byType = (type: string) => map.edges.filter((edge) => edge.type === type).map((edge) => edge.state);

    expect(byType("package_dependency")).toContain("resolved");
    expect(byType("composition")).toEqual(["resolved"]);
    expect(byType("runtime_contract")).toEqual(["unresolved"]);
    expect(byType("service_call")).toEqual(["resolved"]);
    const billing = targetsOf(db, run.id).find((target) => target.sourceName === "billing")!;
    expect(map.coverage).toMatchObject({ complete: false, gaps: [{ target: billing.publicId, source: { public_id: billing.sourcePublicId, name: "billing" }, state: "failed", reason: "source_unavailable" }] });
    expect(map.coverage.contributors).toHaveLength(3);
  });

  it("finalizes an Assessment whose targets all failed or were canceled, with only coverage gaps", async () => {
    const run = await assessed([buildSource(db, { name: "a" }), buildSource(db, { name: "b" })], ["failed", "canceled"]);
    const map = read(finalizeRelationshipMap(db, run));

    expect(map.nodes).toEqual([]);
    expect(map.edges).toEqual([]);
    expect(map.coverage.gaps.map((gap) => gap.state).sort()).toEqual(["canceled", "failed"]);
  });

  it("refuses to write a map before the Assessment is finalizing or while a target is in progress", async () => {
    const early = buildRun(db, { sources: [buildSource(db, { name: "early" })] });
    expect(() => finalizeRelationshipMap(db, early.run)).toThrow(MapNotReadyError);

    const { run, targets } = buildRun(db, { sources: [buildSource(db, { name: "slow" })] });
    transitionTarget(db, targets[0]!, "acquiring");
    const finalizing = transitionRun(db, run, "finalizing");
    expect(() => finalizeRelationshipMap(db, finalizing)).toThrow(/still in progress/);
  });

  it("labels out-of-scope catalog sources from identity metadata alone, never from their historical Profiles, and never adds a target", async () => {
    const ui = buildSource(db, { name: "ui-library" });
    const app = buildSource(db, { name: "app" });
    const named = buildSource(db, { name: "@acme/ui", cloneUrl: "https://git.example.com/acme/other.git" });
    // An earlier Assessment profiled ui-library, which produces @acme/ui.
    const earlier = await assessed([ui], [UI]);
    finalizeRelationshipMap(db, earlier);

    const current = await assessed([app], [APP]);
    const map = read(finalizeRelationshipMap(db, current));

    expect(targetsOf(db, current.id)).toHaveLength(1);
    expect(map.nodes.filter((node) => node.kind === "repository").map((node) => (node as { source: { name: string } }).source.name)).toEqual(["app"]);
    // The consumer is labeled with the catalog source whose name matches, not resolved through ui-library's historical Profile.
    const dependency = map.edges.find((edge) => edge.type === "package_dependency" && edge.reference.identifier.name === "@acme/ui")!;
    expect(dependency).toMatchObject({ state: "out_of_scope", rule: "catalog.name" });
    expect(map.nodes.find((node) => node.id === dependency.to)).toEqual({ id: dependency.to, kind: "out_of_scope_source", source: { public_id: named.publicId, name: "@acme/ui", canonical_url: named.canonicalUrl } });
    expect(JSON.stringify(map)).not.toContain(ui.publicId);
    const document = mapDocument(finalizeRelationshipMap(db, current)) as JsonObject;
    expect(Object.keys(document.evidence as JsonObject).every((id) => id.startsWith("ev_"))).toBe(true);
  });
});
