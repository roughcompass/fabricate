import { and, asc, desc, eq } from "drizzle-orm";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { sequenceNumber, sequenceNumbers } from "@/lib/db/sequence";
import { type RefKind, runTargets, runs } from "@/lib/db/schema";
import { type JsonObject, digestOf } from "@repo-facts/contract";
import type { Initiative } from "@/lib/initiatives/initiative-records";
import { transitionTarget } from "./transitions";
import { SURVEYOR_RELEASE_LABEL } from "@/lib/product";

/**
 * Persistence for Assessments, their immutable scope snapshot, and the
 * commits their targets were pinned to. State transitions live in
 * transitions.ts.
 */

export type Run = typeof runs.$inferSelect;
export type RunTarget = typeof runTargets.$inferSelect;

export const LAUNCH_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface NewRun {
  initiative: Initiative;
  launchToken: string;
  surveyorRelease: string;
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
export function createRun(db: Executor, input: NewRun): { run: Run; targets: RunTarget[] } {
  const issues = new IssueCollector();
  if (!LAUNCH_TOKEN.test(input.launchToken)) issues.add("launchToken", "Launch token must be a lowercase UUID");
  if (!input.surveyorRelease.trim()) issues.add("surveyorRelease", `${SURVEYOR_RELEASE_LABEL} is required`);
  if (input.sources.length === 0) issues.add("sources", "A Run needs at least one target");
  issues.throwIfAny();

  const configuration = digestOf(input.configuration);
  return immediate(db, (tx) => {
    const now = new Date();
    const run = tx
      .insert(runs)
      .values({
        publicId: generatePublicId("asm"),
        initiativeId: input.initiative.id,
        launchToken: input.launchToken,
        surveyorRelease: input.surveyorRelease,
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
      .insert(runTargets)
      .values(
        input.sources.map((source, position) => ({
          publicId: generatePublicId("tgt"),
          runId: run.id,
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
    return { run, targets };
  });
}

export function findRun(db: Executor, publicId: string): Run | undefined {
  return db.select().from(runs).where(eq(runs.publicId, publicId)).get();
}

export function getRun(db: Executor, publicId: string): Run {
  const run = findRun(db, publicId);
  if (!run) throw new NotFoundError(`Assessment ${publicId} does not exist`);
  return run;
}

export function findRunByLaunchToken(db: Executor, initiativeId: number, launchToken: string): Run | undefined {
  return db.select().from(runs).where(and(eq(runs.initiativeId, initiativeId), eq(runs.launchToken, launchToken))).get();
}

export function listRuns(db: Executor, initiativeId: number): Run[] {
  return db.select().from(runs).where(eq(runs.initiativeId, initiativeId)).orderBy(desc(runs.createdAt), desc(runs.id)).all();
}

/** A Run's sequence number within its Assessment: "Run #3" (src/lib/db/sequence.ts). */
export function runNumber(db: Executor, run: Pick<Run, "id" | "initiativeId">): number {
  return sequenceNumber(db, runs, run);
}

/** The sequence number of each of an Initiative's Runs, by id. */
export function runNumbers(db: Executor, initiativeId: number): Map<number, number> {
  return sequenceNumbers(db, runs, initiativeId);
}

export function targetsOf(db: Executor, runId: number): RunTarget[] {
  return db.select().from(runTargets).where(eq(runTargets.runId, runId)).orderBy(asc(runTargets.position)).all();
}

export function getTarget(db: Executor, publicId: string): RunTarget {
  const target = db.select().from(runTargets).where(eq(runTargets.publicId, publicId)).get();
  if (!target) throw new NotFoundError(`Assessment target ${publicId} does not exist`);
  return target;
}

export function targetReferenceLabel(target: Pick<RunTarget, "gitRef">): string {
  return target.gitRef ?? "default branch";
}

/**
 * Records how an acquiring target's reference resolved and the survey of its
 * commit, and moves it to analyzing to wait on that survey.
 */
export function linkSurvey(db: Executor, target: RunTarget, link: { refKind: RefKind; resolvedRef: string; surveyId: number }): RunTarget {
  const now = new Date();
  const linked = db
    .update(runTargets)
    .set({ refKind: link.refKind, resolvedRef: link.resolvedRef, resolvedAt: now, surveyId: link.surveyId, updatedAt: now })
    .where(eq(runTargets.id, target.id))
    .returning()
    .get();
  return transitionTarget(db, linked, "analyzing");
}
