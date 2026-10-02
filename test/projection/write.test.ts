import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordSnapshot } from "@/lib/assessments/assessment-records";
import { transitionTarget } from "@/lib/assessments/transitions";
import { insertProfile } from "@/lib/profiles/profile-records";
import { profileProblems } from "@/lib/profiles/schema";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { memoryProfile } from "../support/profiles";
import { count, pinnedRepository } from "../support/projection";
import { seedAssessment } from "../support/scenarios";

const sha1 = (seed: string) => crypto.createHash("sha1").update(seed).digest("hex");
const failInsertsInto = (db: ReturnType<typeof createTestDb>, table: string) =>
  rawRun(db, `create trigger fail_${table} before insert on ${table} begin select raise(abort, '${table}: projection failed'); end`);

describe("projection writes", () => {
  it("stores neither the Profile nor any of its rows when projecting it fails (Failed write)", async () => {
    const db = createTestDb();
    const source = buildSource(db, { name: "web" });
    const { assessment, targets } = buildAssessment(db, { sources: [source] });
    const acquiring = transitionTarget(db, targets[0]!, "acquiring");
    const snapshot = recordSnapshot(db, acquiring, { commitSha: sha1("c"), treeSha: sha1("t"), refKind: "default_branch", resolvedRef: "refs/heads/main", acquisitionMetadata: {} });
    const analyzing = transitionTarget(db, acquiring, "analyzing");
    const { document } = await memoryProfile(pinnedRepository("web", { react: "16.14.0" }), { public_id: source.publicId, name: source.name }, snapshot.commitSha);
    failInsertsInto(db, "evidence_index");

    expect(() => insertProfile(db, { assessment, target: analyzing, snapshot, document, validate: profileProblems })).toThrow(/projection failed/);
    expect(count(db, "repository_profiles")).toBe(0);
    expect(count(db, "dependency_facts")).toBe(0);
  });

  it("stores neither the map nor any of its rows when projecting it fails", async () => {
    const db = createTestDb();
    const sources = [buildSource(db, { name: "web" })];
    const initiative = buildInitiative(db, { sources });
    failInsertsInto(db, "graph_edges");

    await expect(seedAssessment(db, initiative, sources, [pinnedRepository("web", { react: "16.14.0" })])).rejects.toThrow(/projection failed/);
    expect(count(db, "relationship_maps")).toBe(0);
    expect(count(db, "graph_nodes")).toBe(0);
    expect(count(db, "repository_profiles")).toBe(1);
  });
});
