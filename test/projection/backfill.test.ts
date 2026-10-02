import { describe, expect, it } from "vitest";
import type { Assessment } from "@/lib/assessments/assessment-records";
import type { Db } from "@/lib/db/client";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { rebuildProjection } from "@/lib/projection/rebuild";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import { ORDERS, STOREFRONT } from "../../e2e/support/results";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { manifest } from "../support/profiles";
import { count } from "../support/projection";
import { seedAssessment } from "../support/scenarios";

interface Fact {
  value?: { manifest?: string; name?: string };
}

/** The Runs the e2e suite seeds: the Relationship Map's states and gap, and the Profile's every category state. */
async function seedFixtureRuns(db: Db): Promise<Assessment[]> {
  const names = ["web", "client", "ui-a", "ui-b", "billing"];
  const sources = names.map((name) => buildSource(db, { name }));
  buildSource(db, { name: "legacy-ui" });
  const map = await seedAssessment(db, buildInitiative(db, { name: "Fleet assessment", sources }), sources, [
    {
      "package.json": manifest({ name: "web", version: "1.0.0", private: true, dependencies: { "@acme/client": "^1.0.0", "@acme/ui": "^2.0.0", "left-pad": "^1.3.0", "legacy-ui": "^0.1.0" } }),
      "src/payments.ts": 'export const charge = () => fetch("https://payments.invalid/v1/charges", { method: "POST" });\n',
    },
    { "package.json": manifest({ name: "@acme/client", version: "1.0.0" }) },
    { "package.json": manifest({ name: "@acme/ui", version: "2.0.0" }) },
    { "package.json": manifest({ name: "@acme/ui", version: "2.1.0" }) },
    "failed",
  ]);
  const results = [buildSource(db, { name: "orders" }), buildSource(db, { name: "storefront" })];
  const profiled = await seedAssessment(db, buildInitiative(db, { name: "Results", sources: results }), results, [ORDERS, STOREFRONT]);
  return [map, profiled];
}

/** Dependency facts a Profile document implies: each declaration, plus each resolved version no declaration names. */
function expectedDependencies(document: Record<string, unknown>): number {
  const categories = (document.fact_document as { categories: Record<string, { facts: Fact[] }> }).categories;
  const key = (fact: Fact) => `${fact.value?.manifest}\u0000${fact.value?.name}`;
  const declared = categories.dependencies?.facts ?? [];
  const names = new Set(declared.map(key));
  return declared.length + (categories.resolved_dependencies?.facts ?? []).filter((fact) => !names.has(key(fact))).length;
}

describe("projection backfill", () => {
  it("rebuilds every fixture Run with as many rows as its documents hold", async () => {
    const db = createTestDb();
    const runs = await seedFixtureRuns(db);

    expect(rebuildProjection(db).skipped).toEqual([]);

    for (const run of runs) {
      for (const { profile } of profilesOf(db, run.id)) {
        const document = profileDocument(profile) as Record<string, unknown>;
        expect(count(db, "dependency_facts", "profile_id = ?", profile.id), profile.publicId).toBe(expectedDependencies(document));
        expect(count(db, "evidence_index", "profile_id = ?", profile.id), profile.publicId).toBe(Object.keys((document.fact_document as { evidence: object }).evidence).length);
      }
      const map = mapOf(db, run.id)!;
      const document = mapDocument(map) as { nodes: unknown[]; edges: unknown[] };
      expect(count(db, "graph_nodes", "map_id = ?", map.id)).toBe(document.nodes.length);
      expect(count(db, "graph_edges", "map_id = ?", map.id)).toBe(document.edges.length);
      expect(count(db, "projection_coverage", "assessment_id = ?", run.id)).toBe(count(db, "assessment_targets", "assessment_id = ?", run.id));
    }
  });
});
