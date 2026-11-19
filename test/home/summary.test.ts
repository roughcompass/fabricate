import type { MemoryFile } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { surveyRefFor } from "@/lib/acquisition/mirror";
import { deleteRepository } from "@/lib/repositories/registration";
import type { Repository } from "@/lib/repositories/repository-records";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { fleetSummary } from "@/lib/home/summary";
import { currentRecipe, moveSurvey, pinSurvey, recordConfiguredResolution, requestSurvey } from "@/lib/surveys/records";
import { finishSurvey } from "@/lib/surveys/run";
import { buildRun, buildAssessment, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, driveEvaluation, driveRun } from "../support/home";
import { manifest, memoryProfile, sha1 } from "../support/profiles";
import { seedRun } from "../support/scenarios";

/** A background survey of +source+'s configured reference, still queued, failed, or profiling +files+. */
async function backgroundSurvey(db: Db, repository: Repository, outcome: Readonly<Record<string, MemoryFile>> | "queued" | "failed"): Promise<void> {
  const commitSha = sha1(`commit:${repository.publicId}`);
  const { survey } = requestSurvey(db, { repositoryId: repository.id, commitSha, reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", ...currentRecipe(getConfig()) });
  recordConfiguredResolution(db, repository.id, commitSha, new Date());
  if (outcome === "queued") return;
  const running = pinSurvey(db, moveSurvey(db, survey, "running", { attempts: 1 }), { treeSha: null, internalRef: surveyRefFor(survey.publicId) });
  if (outcome === "failed") finishSurvey(db, running, { failure: { code: "source_unavailable", message: "The repository could not be reached" } });
  else finishSurvey(db, running, { document: (await memoryProfile(outcome, { public_id: repository.publicId, name: repository.name }, commitSha)).document });
}

describe("fleet summary", () => {
  it("counts every Repository, and those with a current Profile from any survey, not one only queued, failed, or deleted (Profiling coverage)", async () => {
    const db = createTestDb();
    const [profiled, assessed, queued, failed, deleted] = [buildRepository(db, { name: "profiled" }), buildRepository(db, { name: "assessed" }), buildRepository(db, { name: "queued" }), buildRepository(db, { name: "failed" }), buildRepository(db, { name: "deleted" })];
    for (const repository of [profiled, deleted]) await backgroundSurvey(db, repository, { "package.json": manifest({ name: repository.name, version: "1.0.0" }) });
    await backgroundSurvey(db, queued, "queued");
    await backgroundSurvey(db, failed, "failed");
    // An operator's Run profiles a repository too.
    await seedRun(db, buildAssessment(db, { repositories: [assessed] }), [assessed], [{ "package.json": manifest({ name: "assessed", version: "1.0.0" }) }]);
    deleteRepository(db, deleted.publicId, "deleted");

    expect(fleetSummary(db).repositories).toEqual({ empty: false, total: 4, profiled: 2 });
  });

  it("counts the operator's Assessments by conclusion and hides Not applicable at zero (Not applicable hidden at zero)", () => {
    const db = createTestDb();
    const repository = buildRepository(db);
    const evaluated = (conclusion: "gaps" | "conforms") => {
      const assessment = buildAssessment(db, { repositories: [repository] });
      driveEvaluation(db, buildEvaluation(db, assessment, driveRun(db, buildRun(db, { assessment }).run, "complete")), "complete", conclusion);
    };
    evaluated("gaps");
    evaluated("gaps");
    evaluated("conforms");
    buildAssessment(db, { repositories: [repository] });

    const { assessments } = fleetSummary(db);
    expect(assessments).toEqual({ empty: false, total: 4, byConclusion: { gaps: 2, undetermined: 0, conforms: 1, not_applicable: 0, none: 1 } });
  });

  it("reports every group empty in a fresh installation (Fresh installation)", () => {
    const db = createTestDb();
    const summary = fleetSummary(db);
    expect(summary.repositories.empty).toBe(true);
    expect(summary.assessments.empty).toBe(true);
  });

  it("counts no Assessment for a Repository surveyed in the background (No profiling Assessment)", async () => {
    const db = createTestDb();
    const repository = buildRepository(db);
    await backgroundSurvey(db, repository, { "package.json": manifest({ name: repository.name, version: "1.0.0" }) });
    expect(fleetSummary(db)).toMatchObject({ repositories: { total: 1, profiled: 1 }, assessments: { empty: true, total: 0 } });
  });
});
