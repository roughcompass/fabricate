import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { rebuildProjection } from "@/lib/projection/rebuild";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { count, pinnedRepository, projectionRows } from "../support/projection";
import { seedAssessment } from "../support/scenarios";

describe("projection rebuild", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    const sources = [buildSource(db, { name: "web" }), buildSource(db, { name: "client" }), buildSource(db, { name: "billing" })];
    await seedAssessment(db, buildInitiative(db, { sources }), sources, [pinnedRepository("web", { "@acme/client": "1.0.0", react: "16.14.0" }), pinnedRepository("@acme/client", { react: "18.3.1" }), "failed"]);
  });

  it("produces the same rows on every rebuild, and the same rows the writes produced (Repeatable rebuild)", () => {
    const written = projectionRows(db);

    expect(rebuildProjection(db)).toEqual({ profiles: 2, maps: 1, skipped: [] });
    const first = projectionRows(db);
    rebuildProjection(db);

    expect(projectionRows(db)).toEqual(first);
    expect(first).toEqual(written);
  });

  it("reports a document whose digest no longer matches, and doesn't project it (Digest mismatch)", () => {
    const { id, public_id: publicId } = db.$client.prepare("select profile.id, profile.public_id from repository_profiles profile join assessment_targets target on target.id = profile.assessment_target_id where target.source_name = 'web'").get() as { id: number; public_id: string };
    rawRun(db, "drop trigger repository_profiles_immutable");
    rawRun(db, "update repository_profiles set document = replace(document, '16.14.0', '16.14.1') where id = ?", id);

    const report = rebuildProjection(db);

    expect(report.profiles).toBe(1);
    expect(report.skipped).toEqual([{ kind: "profile", publicId, reason: expect.stringMatching(/digest verification/) }]);
    expect(count(db, "dependency_facts", "profile_id = ?", id)).toBe(0);
    expect(count(db, "evidence_index", "profile_id = ?", id)).toBe(0);
    expect(count(db, "dependency_facts")).toBeGreaterThan(0);
  });
});
