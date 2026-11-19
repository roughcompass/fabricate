import type { JsonObject } from "@repo-facts/contract";
import { and, eq, inArray } from "drizzle-orm";
import type { RunTarget } from "@/lib/runs/run-records";
import { sourceById } from "@/lib/catalog/source-records";
import type { Executor } from "@/lib/db/client";
import { runTargets, evidenceIndex, repositoryProfiles, surveys } from "@/lib/db/schema";
import type { Survey } from "@/lib/surveys/records";
import { type RepositoryProfile, findProfile, profileDocument } from "./profile-records";

/*
 * Where an evidence record lives (unify-surveys, design decision 7): in a
 * Profile, which a Run reaches through its completed targets' surveys and a
 * version reaches directly. The evidence index finds a Run's record without
 * parsing every Profile of the Run.
 */

export interface FoundEvidence {
  profile: RepositoryProfile;
  survey: Survey;
  /** The Repository as the page names it. */
  repository: { publicId: string; name: string };
  facts: JsonObject;
  record: JsonObject;
}

/** The ids of the Profiles the completed targets of Run +assessmentId+ use, as a subquery. */
export function runProfileIds(db: Executor, runId: number) {
  return db
    .select({ id: repositoryProfiles.id })
    .from(runTargets)
    .innerJoin(repositoryProfiles, eq(repositoryProfiles.surveyId, runTargets.surveyId))
    .where(and(eq(runTargets.runId, runId), eq(runTargets.state, "complete")));
}

function recordOf(profile: RepositoryProfile, evidenceId: string): { facts: JsonObject; record: JsonObject } | undefined {
  const facts = profileDocument(profile).fact_document as JsonObject;
  const record = (facts.evidence as JsonObject | undefined)?.[evidenceId];
  return record && typeof record === "object" && !Array.isArray(record) ? { facts, record } : undefined;
}

/** Evidence +evidenceId+ of a completed target of Run +assessmentId+. */
export function runEvidence(db: Executor, runId: number, evidenceId: string): (FoundEvidence & { target: RunTarget }) | undefined {
  const row = db
    .select({ profile: repositoryProfiles, survey: surveys, target: runTargets })
    .from(evidenceIndex)
    .innerJoin(repositoryProfiles, eq(repositoryProfiles.id, evidenceIndex.profileId))
    .innerJoin(surveys, eq(surveys.id, repositoryProfiles.surveyId))
    .innerJoin(runTargets, and(eq(runTargets.surveyId, surveys.id), eq(runTargets.runId, runId), eq(runTargets.state, "complete")))
    .where(and(eq(evidenceIndex.evidenceId, evidenceId), inArray(evidenceIndex.profileId, runProfileIds(db, runId))))
    .get();
  const found = row && recordOf(row.profile, evidenceId);
  return row && found ? { ...row, ...found, repository: { publicId: row.target.sourcePublicId, name: row.target.sourceName } } : undefined;
}

/** Evidence +evidenceId+ of the Profile +profilePublicId+, as a version's page reaches it. */
export function profileEvidence(db: Executor, profilePublicId: string, evidenceId: string): FoundEvidence | undefined {
  const profile = findProfile(db, profilePublicId);
  if (!profile) return undefined;
  const found = recordOf(profile, evidenceId);
  if (!found) return undefined;
  const survey = db.select().from(surveys).where(eq(surveys.id, profile.surveyId)).get()!;
  const repository = sourceById(db, survey.repositorySourceId);
  return { profile, survey, ...found, repository: { publicId: repository.publicId, name: repository.name } };
}
