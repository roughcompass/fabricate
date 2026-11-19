import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Assessment, AssessmentTarget } from "@/lib/assessments/assessment-records";
import { LAUNCH_TOKEN } from "@/lib/assessments/assessment-records";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import {
  OUTCOMES,
  type Outcome,
  SEVERITIES,
  type Severity,
  SUBJECT_TYPES,
  type SubjectType,
  evaluationReleases,
  evaluations,
  findings,
} from "@/lib/db/schema";
import { type JsonObject, type JsonValue, digestOf, parseCanonical } from "@repo-facts/contract";
import { prepareDocument, readDocument } from "@/lib/documents/digested";
import type { Initiative } from "@/lib/initiatives/initiative-records";
import type { StandardRelease } from "@/lib/standards/standard-records";
import { sequenceNumber, sequenceNumbers } from "@/lib/db/sequence";

/** The outcomes and severities a page filters Findings by. */
export { OUTCOMES, SEVERITIES } from "@/lib/db/schema";

/**
 * Persistence for Evaluations, the Releases pinned to each one, and their
 * immutable Findings. State transitions live in transitions.ts.
 */

export type Evaluation = typeof evaluations.$inferSelect;
export type EvaluationRelease = typeof evaluationReleases.$inferSelect;
export type Finding = typeof findings.$inferSelect;

export interface NewEvaluation {
  initiative: Initiative;
  assessment: Assessment;
  launchToken: string;
  evaluatorVersion: string;
  configuration: JsonObject;
  profileSchemaVersion: number;
  relationshipSchemaVersion: number;
  coverageGaps: JsonValue[];
  /** Releases in evaluation order; each is pinned by its published digest. */
  releases: readonly StandardRelease[];
}

export function createEvaluation(db: Executor, input: NewEvaluation): { evaluation: Evaluation; releases: EvaluationRelease[] } {
  const issues = new IssueCollector();
  if (!LAUNCH_TOKEN.test(input.launchToken)) issues.add("launchToken", "Launch token must be a lowercase UUID");
  if (!input.evaluatorVersion.trim()) issues.add("evaluatorVersion", "Evaluator version is required");
  if (input.releases.length === 0) issues.add("releases", "An Evaluation needs at least one published Release");
  if (new Set(input.releases.map((release) => release.id)).size !== input.releases.length) issues.add("releases", "A Release can be pinned only once");
  issues.throwIfAny();

  const configuration = digestOf(input.configuration);
  const coverageGaps = digestOf(input.coverageGaps).text;
  return immediate(db, (tx) => {
    const now = new Date();
    const evaluation = tx
      .insert(evaluations)
      .values({
        publicId: generatePublicId("evl"),
        initiativeId: input.initiative.id,
        assessmentId: input.assessment.id,
        launchToken: input.launchToken,
        evaluatorVersion: input.evaluatorVersion,
        configuration: configuration.text,
        configurationDigest: configuration.digest,
        profileSchemaVersion: input.profileSchemaVersion,
        relationshipSchemaVersion: input.relationshipSchemaVersion,
        coverageGaps,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const releases = tx
      .insert(evaluationReleases)
      .values(
        input.releases.map((release, position) => ({
          evaluationId: evaluation.id,
          standardReleaseId: release.id,
          releaseDigest: release.digest,
          position,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .returning()
      .all()
      .sort((a, b) => a.position - b.position);
    return { evaluation, releases };
  });
}

export function findEvaluation(db: Executor, publicId: string): Evaluation | undefined {
  return db.select().from(evaluations).where(eq(evaluations.publicId, publicId)).get();
}

export function getEvaluation(db: Executor, publicId: string): Evaluation {
  const evaluation = findEvaluation(db, publicId);
  if (!evaluation) throw new NotFoundError(`Evaluation ${publicId} does not exist`);
  return evaluation;
}

export function findEvaluationByLaunchToken(db: Executor, initiativeId: number, launchToken: string): Evaluation | undefined {
  return db.select().from(evaluations).where(and(eq(evaluations.initiativeId, initiativeId), eq(evaluations.launchToken, launchToken))).get();
}

export function listEvaluations(db: Executor, filter: { initiativeId?: number; assessmentId?: number }): Evaluation[] {
  const conditions = [];
  if (filter.initiativeId !== undefined) conditions.push(eq(evaluations.initiativeId, filter.initiativeId));
  if (filter.assessmentId !== undefined) conditions.push(eq(evaluations.assessmentId, filter.assessmentId));
  return db
    .select()
    .from(evaluations)
    .where(and(...conditions))
    .orderBy(desc(evaluations.createdAt), desc(evaluations.id))
    .all();
}

/** An Evaluation's sequence number within its Assessment: "Evaluation #2" (src/lib/db/sequence.ts). */
export function evaluationNumber(db: Executor, evaluation: Pick<Evaluation, "id" | "initiativeId">): number {
  return sequenceNumber(db, evaluations, evaluation);
}

/** The sequence number of each of an Initiative's Evaluations, by id. */
export function evaluationNumbers(db: Executor, initiativeId: number): Map<number, number> {
  return sequenceNumbers(db, evaluations, initiativeId);
}

export function evaluationReleasesOf(db: Executor, evaluationId: number): EvaluationRelease[] {
  return db.select().from(evaluationReleases).where(eq(evaluationReleases.evaluationId, evaluationId)).orderBy(asc(evaluationReleases.position)).all();
}

export function coverageGapsOf(evaluation: Evaluation): JsonValue[] {
  return parseCanonical(evaluation.coverageGaps) as JsonValue[];
}

export interface NewFinding {
  evaluation: Evaluation;
  evaluationRelease: EvaluationRelease;
  /** The subject target of a repository Finding; absent for relationship Findings. */
  target?: AssessmentTarget;
  position: number;
  document: JsonObject;
}

/**
 * Writes one immutable Finding. Its indexed columns are read from the
 * document, so they cannot disagree with the details a reviewer sees.
 */
export function insertFinding(db: Executor, input: NewFinding): Finding {
  const { document } = input;
  const control = document.control as JsonObject | undefined;
  const subject = document.subject as JsonObject | undefined;
  const controlKey = control?.key;
  const severity = control?.severity;
  const subjectType = subject?.type;
  const subjectKey = subject?.key;
  const outcome = document.outcome;

  const prepared = prepareDocument("finding", document);
  const issues = new IssueCollector();
  if (typeof controlKey !== "string" || !controlKey) issues.add("control.key", "A Finding names its Control");
  if (!SEVERITIES.includes(severity as Severity)) issues.add("control.severity", "A Finding records a supported severity");
  if (!SUBJECT_TYPES.includes(subjectType as SubjectType)) issues.add("subject.type", "A Finding names a repository or the relationship map");
  if (typeof subjectKey !== "string" || !subjectKey) issues.add("subject.key", "A Finding names its subject");
  if (!OUTCOMES.includes(outcome as Outcome)) issues.add("outcome", "A Finding records Meets, Gap, Indeterminate, or Not applicable");
  if ((subjectType === "repository") !== (input.target !== undefined)) issues.add("subject", "Repository Findings, and only they, name an Assessment target");
  issues.throwIfAny();

  return db
    .insert(findings)
    .values({
      publicId: generatePublicId("fnd"),
      evaluationId: input.evaluation.id,
      evaluationReleaseId: input.evaluationRelease.id,
      standardReleaseId: input.evaluationRelease.standardReleaseId,
      assessmentTargetId: input.target?.id ?? null,
      controlKey: controlKey as string,
      subjectType: subjectType as SubjectType,
      subjectKey: subjectKey as string,
      outcome: outcome as Outcome,
      severity: severity as Severity,
      position: input.position,
      documentSchemaVersion: prepared.schemaVersion,
      document: prepared.text,
      digest: prepared.digest,
      createdAt: new Date(),
    })
    .returning()
    .get();
}

export interface FindingFilter {
  evaluationReleaseIds?: number[];
  outcomes?: Outcome[];
  severities?: Severity[];
  controlKey?: string;
  subjectKey?: string;
}

/** The Finding +publicId+ of +evaluation+, or undefined when it belongs to another. */
export function findFinding(db: Executor, evaluation: Pick<Evaluation, "id">, publicId: string): Finding | undefined {
  return db.select().from(findings).where(and(eq(findings.publicId, publicId), eq(findings.evaluationId, evaluation.id))).get();
}

export function findingsOf(db: Executor, evaluationId: number, filter: FindingFilter = {}): Finding[] {
  const conditions = [eq(findings.evaluationId, evaluationId)];
  if (filter.evaluationReleaseIds?.length) conditions.push(inArray(findings.evaluationReleaseId, filter.evaluationReleaseIds));
  if (filter.outcomes?.length) conditions.push(inArray(findings.outcome, filter.outcomes));
  if (filter.severities?.length) conditions.push(inArray(findings.severity, filter.severities));
  if (filter.controlKey) conditions.push(eq(findings.controlKey, filter.controlKey));
  if (filter.subjectKey) conditions.push(eq(findings.subjectKey, filter.subjectKey));
  return db
    .select()
    .from(findings)
    .innerJoin(evaluationReleases, eq(evaluationReleases.id, findings.evaluationReleaseId))
    .where(and(...conditions))
    .orderBy(asc(evaluationReleases.position), asc(findings.position))
    .all()
    .map((row) => row.findings);
}

/** The Finding document, verified against its digest. */
export function findingDocument(finding: Finding): JsonObject {
  return readDocument("finding", finding, `Finding ${finding.publicId}`);
}

export function outcomeLabel(outcome: Outcome): string {
  return { meets: "Meets", gap: "Gap", indeterminate: "Indeterminate", not_applicable: "Not applicable" }[outcome];
}
