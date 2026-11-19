import { and, asc, eq } from "drizzle-orm";
import type { RunTarget } from "@/lib/runs/run-records";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { runTargets, repositoryProfiles, repositories, surveys } from "@/lib/db/schema";
import { type JsonObject, type JsonValue, SKIPPED_INPUT_REASONS } from "@repo-facts/contract";
import { prepareDocument, readDocument } from "@/lib/documents/digested";
import { projectProfile } from "@/lib/projection/project";
import type { Survey } from "@/lib/surveys/records";

/** Persistence for immutable Repository Profiles, one per successful survey. */

export type RepositoryProfile = typeof repositoryProfiles.$inferSelect;

export interface NewProfile {
  survey: Survey;
  document: JsonValue | string;
  /** Structural validation of the document contract; returns problems. */
  validate?: (document: JsonObject) => string[];
}

export function insertProfile(db: Executor, input: NewProfile): RepositoryProfile {
  const prepared = prepareDocument("repositoryProfile", input.document);
  const issues = new IssueCollector();
  if (prepared.value.commit !== input.survey.commitSha) issues.add("document", "The Profile must describe the survey's commit");
  if (prepared.value.detector_release !== input.survey.surveyorRelease) issues.add("document", "The Profile must record the survey's Surveyor release");
  if (prepared.value.detector_configuration_digest !== input.survey.configurationDigest) issues.add("document", "The Profile must record the survey's configuration digest");
  for (const problem of input.validate?.(prepared.value) ?? []) issues.add("document", problem);
  issues.throwIfAny();

  // The Profile and its projection rows commit together or not at all.
  return immediate(db, (tx) => {
    const profile = tx
      .insert(repositoryProfiles)
      .values({
        publicId: generatePublicId("prf"),
        surveyId: input.survey.id,
        schemaVersion: prepared.schemaVersion,
        surveyorRelease: input.survey.surveyorRelease,
        document: prepared.text,
        digest: prepared.digest,
        createdAt: new Date(),
      })
      .returning()
      .get();
    projectProfile(tx, profile, prepared.value);
    return profile;
  });
}

export function findProfile(db: Executor, publicId: string): RepositoryProfile | undefined {
  return db.select().from(repositoryProfiles).where(eq(repositoryProfiles.publicId, publicId)).get();
}

export function getProfile(db: Executor, publicId: string): RepositoryProfile {
  const profile = findProfile(db, publicId);
  if (!profile) throw new NotFoundError(`Repository Profile ${publicId} does not exist`);
  return profile;
}

/** The Repository a Profile describes, through its survey. */
export function profileRepository(db: Executor, profile: Pick<RepositoryProfile, "surveyId">): { id: number; publicId: string; name: string } {
  return db
    .select({ id: repositories.id, publicId: repositories.publicId, name: repositories.name })
    .from(surveys)
    .innerJoin(repositories, eq(repositories.id, surveys.repositoryId))
    .where(eq(surveys.id, profile.surveyId))
    .get()!;
}

/** The Profile a survey wrote, once it succeeded. */
export function profileOfSurvey(db: Executor, surveyId: number): RepositoryProfile | undefined {
  return db.select().from(repositoryProfiles).where(eq(repositoryProfiles.surveyId, surveyId)).get();
}

/** Every Profile of an Assessment's completed targets, in scope order. */
export function profilesOf(db: Executor, runId: number): { profile: RepositoryProfile; target: RunTarget }[] {
  return db
    .select({ profile: repositoryProfiles, target: runTargets })
    .from(runTargets)
    .innerJoin(repositoryProfiles, eq(repositoryProfiles.surveyId, runTargets.surveyId))
    .where(and(eq(runTargets.runId, runId), eq(runTargets.state, "complete")))
    .orderBy(asc(runTargets.position))
    .all();
}

/** The Profile document, verified against its digest. */
export function profileDocument(profile: RepositoryProfile): JsonObject {
  return readDocument("repositoryProfile", profile, `Repository Profile ${profile.publicId}`);
}

/** A Profile's diagnostics, split into inputs that were skipped or not understood and other notes. */
export function profileDiagnostics(document: JsonObject): { skipped: JsonObject[]; notes: JsonObject[] } {
  const facts = document.fact_document as JsonObject;
  const diagnostics = (Array.isArray(facts.diagnostics) ? facts.diagnostics : []) as JsonObject[];
  return {
    skipped: diagnostics.filter((diagnostic) => SKIPPED_INPUT_REASONS.has(String(diagnostic.reason))),
    notes: diagnostics.filter((diagnostic) => !SKIPPED_INPUT_REASONS.has(String(diagnostic.reason))),
  };
}
