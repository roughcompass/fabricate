import { asc, desc, eq } from "drizzle-orm";
import type { Assessment, AssessmentTarget, SourceSnapshot } from "@/lib/assessments/assessment-records";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { assessmentTargets, repositoryProfiles } from "@/lib/db/schema";
import { type JsonObject, type JsonValue, SKIPPED_INPUT_REASONS } from "@repo-facts/contract";
import { prepareDocument, readDocument } from "@/lib/documents/digested";
import { projectProfile } from "@/lib/projection/project";

/** Persistence for immutable Repository Profiles, one per pinned snapshot. */

export type RepositoryProfile = typeof repositoryProfiles.$inferSelect;

export interface NewProfile {
  assessment: Assessment;
  target: AssessmentTarget;
  snapshot: SourceSnapshot;
  document: JsonValue | string;
  /** Structural validation of the document contract; returns problems. */
  validate?: (document: JsonObject) => string[];
}

export function insertProfile(db: Executor, input: NewProfile): RepositoryProfile {
  const prepared = prepareDocument("repositoryProfile", input.document);
  const issues = new IssueCollector();
  if (input.snapshot.refKind === "stored_files") {
    if (prepared.value.content_digest !== input.snapshot.treeSha) issues.add("document", "The Profile must describe the stored files' content digest");
  } else if (prepared.value.commit !== input.snapshot.commitSha) issues.add("document", "The Profile must describe the pinned commit");
  if (prepared.value.detector_release !== input.assessment.detectorRelease) issues.add("document", "The Profile must record the Assessment's detector release");
  if (prepared.value.detector_configuration_digest !== input.assessment.configurationDigest) issues.add("document", "The Profile must record the Assessment's detector configuration digest");
  for (const problem of input.validate?.(prepared.value) ?? []) issues.add("document", problem);
  issues.throwIfAny();

  // The Profile and its projection rows commit together or not at all.
  return immediate(db, (tx) => {
    const profile = tx
      .insert(repositoryProfiles)
      .values({
        publicId: generatePublicId("prf"),
        assessmentId: input.assessment.id,
        assessmentTargetId: input.target.id,
        sourceSnapshotId: input.snapshot.id,
        schemaVersion: prepared.schemaVersion,
        detectorRelease: input.assessment.detectorRelease,
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

export function profileOfTarget(db: Executor, targetId: number): RepositoryProfile | undefined {
  return db.select().from(repositoryProfiles).where(eq(repositoryProfiles.assessmentTargetId, targetId)).get();
}

/** Every Profile of an Assessment, in scope order. */
export function profilesOf(db: Executor, assessmentId: number): { profile: RepositoryProfile; target: AssessmentTarget }[] {
  return db
    .select({ profile: repositoryProfiles, target: assessmentTargets })
    .from(repositoryProfiles)
    .innerJoin(assessmentTargets, eq(assessmentTargets.id, repositoryProfiles.assessmentTargetId))
    .where(eq(repositoryProfiles.assessmentId, assessmentId))
    .orderBy(asc(assessmentTargets.position))
    .all();
}

/** The most recent Profile of a repository source across Assessments, for noting that an earlier one is historical. */
export function latestProfileOfSource(db: Executor, sourcePublicId: string): { profile: RepositoryProfile; target: AssessmentTarget } | undefined {
  return db
    .select({ profile: repositoryProfiles, target: assessmentTargets })
    .from(repositoryProfiles)
    .innerJoin(assessmentTargets, eq(assessmentTargets.id, repositoryProfiles.assessmentTargetId))
    .where(eq(assessmentTargets.sourcePublicId, sourcePublicId))
    .orderBy(desc(repositoryProfiles.id))
    .get();
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
