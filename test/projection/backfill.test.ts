import { describe, expect, it } from "vitest";
import type { Run } from "@/lib/runs/run-records";
import type { Db } from "@/lib/db/client";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { rebuildProjection } from "@/lib/projection/rebuild";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import { buildAssessment, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { count } from "../support/projection";
import { ORDERS, STOREFRONT, seedRun, seedMapStates } from "../support/scenarios";

interface Fact {
  value?: { manifest?: string; name?: string };
}

/** The Runs the e2e suite seeds: the Relationship Map's states and gap, and the Profile's every category state. */
async function seedFixtureRuns(db: Db): Promise<Run[]> {
  const { run: map } = await seedMapStates(db);
  const results = [buildRepository(db, { name: "orders" }), buildRepository(db, { name: "storefront" })];
  const profiled = await seedRun(db, buildAssessment(db, { name: "Results", repositories: results }), results, [ORDERS, STOREFRONT]);
  return [map, profiled];
}

/** Packages a Profile document says its repository produces: its producer references. */
function producedPackages(document: Record<string, unknown>): number {
  const references = (document.fact_document as { relationship_references?: { type: string; role: string; identifier?: { name?: string } }[] }).relationship_references ?? [];
  return references.filter((reference) => reference.type === "package" && reference.role === "producer" && reference.identifier?.name).length;
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
        expect(count(db, "dependency_facts", "profile_id = ? and kind = 'dependency'", profile.id), profile.publicId).toBe(expectedDependencies(document));
        expect(count(db, "dependency_facts", "profile_id = ? and kind = 'produced'", profile.id), profile.publicId).toBe(producedPackages(document));
        expect(count(db, "evidence_index", "profile_id = ?", profile.id), profile.publicId).toBe(Object.keys((document.fact_document as { evidence: object }).evidence).length);
      }
      const map = mapOf(db, run.id)!;
      const document = mapDocument(map) as { nodes: unknown[]; edges: unknown[] };
      expect(count(db, "graph_nodes", "map_id = ?", map.id)).toBe(document.nodes.length);
      expect(count(db, "graph_edges", "map_id = ?", map.id)).toBe(document.edges.length);
    }
  });
});
