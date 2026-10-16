import { and, asc, count, desc, eq, lte } from "drizzle-orm";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId, isPublicId } from "@/lib/db/ids";
import { REF_KINDS, type RefKind, assessmentTargets, assessments, sourceSnapshots, storedFileSets } from "@/lib/db/schema";
import { treeObjectId } from "@/lib/snapshot/stored-files";
import { type JsonObject, digestOf, parseCanonical, sha256 } from "@repo-facts/contract";
import type { Initiative } from "@/lib/initiatives/initiative-records";

/**
 * Persistence for Assessments, their immutable scope snapshot, and the
 * commits their targets were pinned to. State transitions live in
 * transitions.ts.
 */

export type Assessment = typeof assessments.$inferSelect;
export type AssessmentTarget = typeof assessmentTargets.$inferSelect;
export type SourceSnapshot = typeof sourceSnapshots.$inferSelect;

/** A target copied from a catalog source, which Git acquires. Template targets have no source. */
export type SourceTarget = AssessmentTarget & { kind: "source"; repositorySourceId: number; cloneUrl: string; canonicalUrl: string };
/** A source target's snapshot, pinned to a Git commit. A template target's snapshot is its stored files. */
export type CommitSnapshot = SourceSnapshot & { repositorySourceId: number; commitSha: string };

/** +target+ as a catalog source's copy, or an error for a template version. */
export function sourceTarget(target: AssessmentTarget): SourceTarget {
  if (target.kind !== "source" || target.repositorySourceId === null || target.cloneUrl === null || target.canonicalUrl === null) {
    throw new Error(`Assessment target ${target.publicId} is a template version, not a catalog source`);
  }
  return target as SourceTarget;
}

/** +snapshot+ as a pinned commit, or an error for stored files. */
export function commitSnapshot(snapshot: SourceSnapshot): CommitSnapshot {
  if (snapshot.commitSha === null || snapshot.repositorySourceId === null) throw new Error(`Snapshot ${snapshot.publicId} is stored files, not a Git commit`);
  return snapshot as CommitSnapshot;
}

export const LAUNCH_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OBJECT_ID = /^[0-9a-f]{40}$/;

export interface NewAssessment {
  initiative: Initiative;
  launchToken: string;
  detectorRelease: string;
  configuration: JsonObject;
  profileSchemaVersion: number;
  relationshipSchemaVersion: number;
  /** The resolved scope, in the order targets are processed and displayed. */
  sources: readonly RepositorySource[];
  /** Template versions to assess instead, under the Salt Patterns initiative. */
  templates?: readonly TemplateTargetInput[];
  /** Published Releases, by public id, to evaluate the Run against when it finishes, instead of its initiative's selection then. */
  evaluationReleases?: readonly string[];
}

/** A template version as a target: what it is, and its exported files, whose Git tree id becomes its content digest. */
export interface TemplateTargetInput {
  /** The target's stable key across Runs: the template's id, or the prototype's before its first acceptance. */
  key: string;
  name: string;
  templatePublicId: string | null;
  templateVersionPublicId: string | null;
  templateVersionNumber: number | null;
  prototypeVersionPublicId: string;
  /** The exported project, path to UTF-8 content: the same files the version's download contains. */
  files: Readonly<Record<string, string>>;
}

/**
 * Writes an Assessment and every target copy. The targets share the
 * Assessment's timestamp, which the database requires of a frozen scope.
 */
export function createAssessment(db: Executor, input: NewAssessment): { assessment: Assessment; targets: AssessmentTarget[] } {
  const issues = new IssueCollector();
  if (!LAUNCH_TOKEN.test(input.launchToken)) issues.add("launchToken", "Launch token must be a lowercase UUID");
  if (!input.detectorRelease.trim()) issues.add("detectorRelease", "Detector release is required");
  const templates = input.templates ?? [];
  if (input.sources.length + templates.length === 0) issues.add("sources", "An assessment needs at least one target");
  if (input.sources.length && templates.length) issues.add("sources", "An assessment assesses catalog sources or template versions, not both");
  for (const template of templates) if (Object.keys(template.files).length === 0) issues.add("templates", `${template.name} has no files to assess`);
  issues.throwIfAny();
  const digests = templates.map((template) => treeObjectId(template.files));

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
        evaluationReleases: input.evaluationReleases ? JSON.stringify(input.evaluationReleases) : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    const targets = tx
      .insert(assessmentTargets)
      .values([
        ...input.sources.map((source, position) => ({
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
        ...templates.map((template, position) => ({
          publicId: generatePublicId("tgt"),
          assessmentId: assessment.id,
          kind: "template" as const,
          position,
          sourcePublicId: template.key,
          sourceName: template.name,
          templatePublicId: template.templatePublicId,
          templateVersionPublicId: template.templateVersionPublicId,
          templateVersionNumber: template.templateVersionNumber,
          prototypeVersionPublicId: template.prototypeVersionPublicId,
          contentDigest: digests[position]!,
          createdAt: now,
          updatedAt: now,
        })),
      ])
      .returning()
      .all()
      .sort((a, b) => a.position - b.position);
    // Each template target's files are kept with it, so the worker reads them here and never opens the Prototypes database.
    templates.forEach((template, position) => {
      const target = targets.find((candidate) => candidate.kind === "template" && candidate.position === position)!;
      tx.insert(storedFileSets).values({ assessmentTargetId: target.id, digest: digests[position]!, files: digestOf(sortedFiles(template.files)).text, createdAt: now }).run();
    });
    return { assessment, targets };
  });
}

/** The Releases, by public id, a Run is to be evaluated against when it finishes, or null for its initiative's selection then. */
export function evaluationReleasesOf(assessment: Pick<Assessment, "evaluationReleases">): string[] | null {
  return assessment.evaluationReleases === null ? null : (JSON.parse(assessment.evaluationReleases) as string[]);
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

/**
 * An Assessment's sequence number within its Initiative, counting from 1 in
 * creation order: "Assessment #3". Stable because Assessments are never
 * deleted; a change that adds deletion must persist the numbers first.
 */
export function assessmentNumber(db: Executor, assessment: Pick<Assessment, "id" | "initiativeId">): number {
  return db.select({ value: count() }).from(assessments).where(and(eq(assessments.initiativeId, assessment.initiativeId), lte(assessments.id, assessment.id))).get()?.value ?? 0;
}

/** The sequence number of each of an Initiative's Assessments, by id. */
export function assessmentNumbers(db: Executor, initiativeId: number): Map<number, number> {
  const ids = db.select({ id: assessments.id }).from(assessments).where(eq(assessments.initiativeId, initiativeId)).orderBy(asc(assessments.id)).all();
  return new Map(ids.map(({ id }, index) => [id, index + 1]));
}

export function targetsOf(db: Executor, assessmentId: number): AssessmentTarget[] {
  return db.select().from(assessmentTargets).where(eq(assessmentTargets.assessmentId, assessmentId)).orderBy(asc(assessmentTargets.position)).all();
}

export function getTarget(db: Executor, publicId: string): AssessmentTarget {
  const target = db.select().from(assessmentTargets).where(eq(assessmentTargets.publicId, publicId)).get();
  if (!target) throw new NotFoundError(`Assessment target ${publicId} does not exist`);
  return target;
}

/** The detector configuration an Assessment recorded, verified against its digest. */
export function configurationOf(assessment: Assessment): JsonObject {
  if (sha256(assessment.configuration) !== assessment.configurationDigest) {
    throw new Error(`Assessment ${assessment.publicId} configuration failed digest verification`);
  }
  return parseCanonical(assessment.configuration) as JsonObject;
}

export function targetReferenceLabel(target: Pick<AssessmentTarget, "gitRef">): string {
  return target.gitRef ?? "default branch";
}

export interface SnapshotInput {
  /** The snapshot's public id, when its internal ref was created under it first. */
  publicId?: string;
  commitSha: string;
  treeSha: string;
  refKind: RefKind;
  resolvedRef: string;
  acquisitionMetadata: JsonObject;
  acquiredAt?: Date;
}

export function internalRefFor(snapshotPublicId: string): string {
  return `refs/fabricate/snapshots/${snapshotPublicId}`;
}

/** Records the commit an acquiring target was pinned to. */
export function recordSnapshot(db: Executor, copied: AssessmentTarget, input: SnapshotInput): CommitSnapshot {
  const target = sourceTarget(copied);
  const issues = new IssueCollector();
  if (!OBJECT_ID.test(input.commitSha)) issues.add("commitSha", "Commit must be a 40-character lowercase object id");
  if (!OBJECT_ID.test(input.treeSha)) issues.add("treeSha", "Tree must be a 40-character lowercase object id");
  if (!REF_KINDS.includes(input.refKind)) issues.add("refKind", "Reference kind is not supported");
  if (!input.resolvedRef) issues.add("resolvedRef", "Resolved reference is required");

  if (input.publicId !== undefined && !isPublicId(input.publicId, "snp")) issues.add("publicId", "Snapshot id is not valid");
  issues.throwIfAny();

  const publicId = input.publicId ?? generatePublicId("snp");
  const now = new Date();
  return db
    .insert(sourceSnapshots)
    .values({
      publicId,
      assessmentTargetId: target.id,
      repositorySourceId: target.repositorySourceId,
      commitSha: input.commitSha,
      treeSha: input.treeSha,
      refKind: input.refKind,
      resolvedRef: input.resolvedRef,
      internalRef: internalRefFor(publicId),
      acquisitionMetadata: digestOf(input.acquisitionMetadata).text,
      acquiredAt: input.acquiredAt ?? now,
      createdAt: now,
    })
    .returning()
    .get() as CommitSnapshot;
}

export interface StoredFilesSnapshotInput {
  /** The Git tree id of the files, which must be the target's content digest. */
  treeSha: string;
  /** The version the files were exported from: the template version, or the prototype version before its first acceptance. */
  resolvedRef: string;
  acquisitionMetadata: JsonObject;
}

/** Records the stored files an acquiring template target was read from, in place of a pinned commit. */
export function recordStoredFilesSnapshot(db: Executor, target: AssessmentTarget, input: StoredFilesSnapshotInput): SourceSnapshot {
  if (target.kind !== "template") throw new Error(`Assessment target ${target.publicId} is a catalog source, not a template version`);
  if (input.treeSha !== target.contentDigest) throw new Error(`The stored files of ${target.sourceName} no longer match the content digest the Run recorded`);
  const publicId = generatePublicId("snp");
  const now = new Date();
  return db
    .insert(sourceSnapshots)
    .values({
      publicId,
      assessmentTargetId: target.id,
      repositorySourceId: null,
      commitSha: null,
      treeSha: input.treeSha,
      refKind: "stored_files",
      resolvedRef: input.resolvedRef,
      internalRef: internalRefFor(publicId),
      acquisitionMetadata: digestOf(input.acquisitionMetadata).text,
      acquiredAt: now,
      createdAt: now,
    })
    .returning()
    .get();
}

const sortedFiles = (files: Readonly<Record<string, string>>): JsonObject => Object.fromEntries(Object.keys(files).sort().map((path) => [path, files[path]!]));

/** A template target's stored files, verified against the digest they were stored under. */
export function storedFilesOf(db: Executor, target: Pick<AssessmentTarget, "id" | "publicId" | "contentDigest">): Record<string, string> {
  const row = db.select().from(storedFileSets).where(eq(storedFileSets.assessmentTargetId, target.id)).get();
  if (!row) throw new NotFoundError(`Assessment target ${target.publicId} has no stored files`);
  const files = parseCanonical(row.files) as Record<string, string>;
  if (row.digest !== target.contentDigest || treeObjectId(files) !== row.digest) throw new Error(`The stored files of ${target.publicId} don't match their content digest`);
  return files;
}

export function snapshotOf(db: Executor, targetId: number): SourceSnapshot | undefined {
  return db.select().from(sourceSnapshots).where(eq(sourceSnapshots.assessmentTargetId, targetId)).get();
}
