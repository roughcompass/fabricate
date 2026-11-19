import { and, asc, desc, eq } from "drizzle-orm";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { sequenceNumber, sequenceNumbers } from "@/lib/db/sequence";
import { type RefKind, assessmentTargets, assessments } from "@/lib/db/schema";
import { type JsonObject, digestOf } from "@repo-facts/contract";
import type { Initiative } from "@/lib/initiatives/initiative-records";
import { transitionTarget } from "./transitions";

/**
 * Persistence for Assessments, their immutable scope snapshot, and the
 * commits their targets were pinned to. State transitions live in
 * transitions.ts.
 */

export type Assessment = typeof assessments.$inferSelect;
export type AssessmentTarget = typeof assessmentTargets.$inferSelect;

export const LAUNCH_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface NewAssessment {
  initiative: Initiative;
  launchToken: string;
  detectorRelease: string;
  configuration: JsonObject;
  profileSchemaVersion: number;
  relationshipSchemaVersion: number;
  /** The resolved scope, in the order targets are processed and displayed. */
  sources: readonly RepositorySource[];
}

/**
 * Writes an Assessment and every target copy. The targets share the
 * Assessment's timestamp, which the database requires of a frozen scope.
 */
export function createAssessment(db: Executor, input: NewAssessment): { assessment: Assessment; targets: AssessmentTarget[] } {
  const issues = new IssueCollector();
  if (!LAUNCH_TOKEN.test(input.launchToken)) issues.add("launchToken", "Launch token must be a lowercase UUID");
  if (!input.detectorRelease.trim()) issues.add("detectorRelease", "Detector release is required");
  if (input.sources.length === 0) issues.add("sources", "An assessment needs at least one target");
  issues.throwIfAny();

  const configuration = digestOf(input.configuration);
  return immediate(db, (tx) => {
    const now = new Date();
    const assessment = tx
      .insert(assessments)
      .values({
        publicId: generatePublicId("asm"),
        initiativeId: input.initiative.id,
        launchToken: input.launchToken,
        detectorRelease: input.detectorRelease,
        configuration: configuration.text,
        configurationDigest: configuration.digest,
        profileSchemaVersion: input.profileSchemaVersion,
        relationshipSchemaVersion: input.relationshipSchemaVersion,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    const targets = tx
      .insert(assessmentTargets)
      .values(
        input.sources.map((source, position) => ({
          publicId: generatePublicId("tgt"),
          assessmentId: assessment.id,
          repositorySourceId: source.id,
          position,
          sourcePublicId: source.publicId,
          sourceName: source.name,
          cloneUrl: source.cloneUrl,
          canonicalUrl: source.canonicalUrl,
          gitRef: source.gitRef,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .returning()
      .all()
      .sort((a, b) => a.position - b.position);
    return { assessment, targets };
  });
}

export function findAssessment(db: Executor, publicId: string): Assessment | undefined {
  return db.select().from(assessments).where(eq(assessments.publicId, publicId)).get();
}

export function getAssessment(db: Executor, publicId: string): Assessment {
  const assessment = findAssessment(db, publicId);
  if (!assessment) throw new NotFoundError(`Assessment ${publicId} does not exist`);
  return assessment;
}

export function findAssessmentByLaunchToken(db: Executor, initiativeId: number, launchToken: string): Assessment | undefined {
  return db.select().from(assessments).where(and(eq(assessments.initiativeId, initiativeId), eq(assessments.launchToken, launchToken))).get();
}

export function listAssessments(db: Executor, initiativeId: number): Assessment[] {
  return db.select().from(assessments).where(eq(assessments.initiativeId, initiativeId)).orderBy(desc(assessments.createdAt), desc(assessments.id)).all();
}

/** A Run's sequence number within its Assessment: "Run #3" (src/lib/db/sequence.ts). */
export function assessmentNumber(db: Executor, assessment: Pick<Assessment, "id" | "initiativeId">): number {
  return sequenceNumber(db, assessments, assessment);
}

/** The sequence number of each of an Initiative's Runs, by id. */
export function assessmentNumbers(db: Executor, initiativeId: number): Map<number, number> {
  return sequenceNumbers(db, assessments, initiativeId);
}

export function targetsOf(db: Executor, assessmentId: number): AssessmentTarget[] {
  return db.select().from(assessmentTargets).where(eq(assessmentTargets.assessmentId, assessmentId)).orderBy(asc(assessmentTargets.position)).all();
}

export function getTarget(db: Executor, publicId: string): AssessmentTarget {
  const target = db.select().from(assessmentTargets).where(eq(assessmentTargets.publicId, publicId)).get();
  if (!target) throw new NotFoundError(`Assessment target ${publicId} does not exist`);
  return target;
}

export function targetReferenceLabel(target: Pick<AssessmentTarget, "gitRef">): string {
  return target.gitRef ?? "default branch";
}

/**
 * Records how an acquiring target's reference resolved and the survey of its
 * commit, and moves it to analyzing to wait on that survey.
 */
export function linkSurvey(db: Executor, target: AssessmentTarget, link: { refKind: RefKind; resolvedRef: string; surveyId: number }): AssessmentTarget {
  const now = new Date();
  const linked = db
    .update(assessmentTargets)
    .set({ refKind: link.refKind, resolvedRef: link.resolvedRef, resolvedAt: now, surveyId: link.surveyId, updatedAt: now })
    .where(eq(assessmentTargets.id, target.id))
    .returning()
    .get();
  return transitionTarget(db, linked, "analyzing");
}
