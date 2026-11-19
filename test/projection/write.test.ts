import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { surveyRefFor } from "@/lib/acquisition/mirror";
import { insertProfile } from "@/lib/profiles/profile-records";
import { profileProblems } from "@/lib/profiles/schema";
import { moveSurvey, pinSurvey, requestSurvey } from "@/lib/surveys/records";
import { buildRun, buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { memoryProfile } from "../support/profiles";
import { count, pinnedRepository } from "../support/projection";
import { seedRun } from "../support/scenarios";

const sha1 = (seed: string) => crypto.createHash("sha1").update(seed).digest("hex");
const failInsertsInto = (db: ReturnType<typeof createTestDb>, table: string) =>
  rawRun(db, `create trigger fail_${table} before insert on ${table} begin select raise(abort, '${table}: projection failed'); end`);

describe("projection writes", () => {
  it("stores neither the Profile nor any of its rows when projecting it fails (Failed write)", async () => {
    const db = createTestDb();
    const source = buildSource(db, { name: "web" });
    const { run } = buildRun(db, { sources: [source] });
    const { survey: queued } = requestSurvey(db, {
      repositorySourceId: source.id,
      commitSha: sha1("c"),
      reference: "refs/heads/main",
      fromConfiguredReference: true,
      trigger: "run",
      requestedByRunId: run.id,
      surveyorRelease: run.surveyorRelease,
      configurationDigest: run.configurationDigest,
      profileSchemaVersion: run.profileSchemaVersion,
    });
    const survey = pinSurvey(db, moveSurvey(db, queued, "running", { attempts: 1 }), { treeSha: sha1("t"), internalRef: surveyRefFor(queued.publicId) });
    const { document } = await memoryProfile(pinnedRepository("web", { react: "16.14.0" }), { public_id: source.publicId, name: source.name }, survey.commitSha);
    failInsertsInto(db, "evidence_index");

    expect(() => insertProfile(db, { survey, document, validate: profileProblems })).toThrow(/projection failed/);
    expect(count(db, "repository_profiles")).toBe(0);
    expect(count(db, "dependency_facts")).toBe(0);
  });

  it("stores neither the map nor any of its rows when projecting it fails", async () => {
    const db = createTestDb();
    const sources = [buildSource(db, { name: "web" })];
    const initiative = buildInitiative(db, { sources });
    failInsertsInto(db, "graph_edges");

    await expect(seedRun(db, initiative, sources, [pinnedRepository("web", { react: "16.14.0" })])).rejects.toThrow(/projection failed/);
    expect(count(db, "relationship_maps")).toBe(0);
    expect(count(db, "graph_nodes")).toBe(0);
    expect(count(db, "repository_profiles")).toBe(1);
  });
});
