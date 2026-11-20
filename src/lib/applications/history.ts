import { and, desc, eq, isNull } from "drizzle-orm";
import type { JsonObject } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import { type ApplicationOutcome, type AttemptState, type BuildOutcome, type BuildTrigger, applicationBuilds, previewBuilds, repositories } from "@/lib/db/schema";
import type { ApplicationReason, ApplicationRow } from "./records";

/**
 * An application's build history (catalog spec, "The application page lists
 * its builds"): every attempt it starts, its first build, one the automatic
 * check starts, a Rebuild, or a branch switch, recorded when it starts and
 * settled with the attempt, in the same transactions as the application's
 * own latest outcome. Builds of other refs that preview mode starts aren't
 * the application's. A newer attempt that starts before an earlier one's
 * commit was decided replaces it.
 */

/** Records that +application+ started an attempt at +preparation+'s commit, for +trigger+, replacing any not yet building a package. */
export function startHistory(db: Executor, application: Pick<ApplicationRow, "id" | "trackedRef">, trigger: BuildTrigger, preparation: { id: number; commitSha: string }, now = new Date()): void {
  db.update(applicationBuilds)
    .set({ outcome: "replaced", finishedAt: now })
    .where(and(eq(applicationBuilds.applicationId, application.id), eq(applicationBuilds.outcome, "building"), isNull(applicationBuilds.previewId)))
    .run();
  db.insert(applicationBuilds).values({ applicationId: application.id, trigger, trackedRef: application.trackedRef, commitSha: preparation.commitSha, preparationId: preparation.id, startedAt: now }).run();
}

/** Records a rebuild of +preview+ an operator started from its preview page, for the application whose latest attempt it is. */
export function startRebuildHistory(db: Executor, application: Pick<ApplicationRow, "id" | "trackedRef">, preview: { id: number; attempt: number; commitSha: string; preparationId: number }, now = new Date()): void {
  db.insert(applicationBuilds)
    .values({ applicationId: application.id, trigger: "rebuild", trackedRef: application.trackedRef, commitSha: preview.commitSha, preparationId: preview.preparationId, previewId: preview.id, attempt: preview.attempt, startedAt: now })
    .run();
}

/** Records how +application+'s newest attempt stands: its build, once started, and its outcome when it's settled. */
export function settleNewestHistory(db: Executor, applicationId: number, values: { preview?: { id: number; attempt: number }; outcome: ApplicationOutcome; reasons?: readonly ApplicationReason[] | null }, now = new Date()): void {
  const newest = db.select({ id: applicationBuilds.id }).from(applicationBuilds).where(eq(applicationBuilds.applicationId, applicationId)).orderBy(desc(applicationBuilds.id)).limit(1).get();
  if (!newest) return;
  db.update(applicationBuilds)
    .set({ ...(values.preview && { previewId: values.preview.id, attempt: values.preview.attempt }), ...settled(values.outcome, values.reasons, now) })
    .where(eq(applicationBuilds.id, newest.id))
    .run();
}

/** Settles every attempt that is +preview+'s attempt +attempt+ and still building. */
export function settleBuildHistory(db: Executor, preview: { id: number; attempt: number }, outcome: "ready" | "failed" | "not_previewable", reasons: readonly ApplicationReason[] | null, now = new Date()): void {
  db.update(applicationBuilds)
    .set(settled(outcome, reasons, now))
    .where(and(eq(applicationBuilds.previewId, preview.id), eq(applicationBuilds.attempt, preview.attempt), eq(applicationBuilds.outcome, "building")))
    .run();
}

/** Fails every attempt still waiting on the preparation with row id +preparationId+ to build its package. */
export function failPreparationHistory(db: Executor, preparationId: number, reasons: readonly ApplicationReason[], now = new Date()): void {
  db.update(applicationBuilds)
    .set(settled("failed", reasons, now))
    .where(and(eq(applicationBuilds.preparationId, preparationId), isNull(applicationBuilds.previewId), eq(applicationBuilds.outcome, "building")))
    .run();
}

function settled(outcome: BuildOutcome, reasons: readonly ApplicationReason[] | null | undefined, now: Date) {
  const failed = outcome === "failed" || outcome === "not_previewable";
  return { outcome, reasons: failed ? ((reasons?.length ? reasons : [{ text: "The build failed." }]) as unknown as JsonObject[]) : null, finishedAt: outcome === "building" ? null : now };
}

/** One attempt in an application's history, as its page lists it. */
export interface ApplicationBuildEntry {
  readonly trigger: BuildTrigger;
  readonly branch: string;
  readonly commitSha: string;
  readonly outcome: BuildOutcome;
  readonly reasons: readonly ApplicationReason[];
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  /** How long it took, from starting to settling, in milliseconds; null while it runs. */
  readonly durationMs: number | null;
  /** Its build, once its package's build started: the preview, its Repository, and this attempt. */
  readonly build: {
    readonly preview: string;
    readonly repository: string;
    readonly attempt: number;
    /** The preview's latest attempt's state; this attempt's when it's the latest. */
    readonly latestAttempt: number;
    readonly latestState: AttemptState;
    /** Whether this attempt's log is still kept: only a preview's latest attempt's is, until the preview is deleted or pruned. */
    readonly logKept: boolean;
  } | null;
}

/**
 * +application+'s attempts, newest first, at most +limit+.
 * @public The application page lists them (add-applications task 6.4).
 */
export function applicationHistory(db: Executor, applicationId: number, limit = 50): ApplicationBuildEntry[] {
  return db
    .select({ row: applicationBuilds, preview: { publicId: previewBuilds.publicId, attempt: previewBuilds.attempt, attemptState: previewBuilds.attemptState, attemptLog: previewBuilds.attemptLog, deletedAt: previewBuilds.deletedAt }, repository: repositories.publicId })
    .from(applicationBuilds)
    .leftJoin(previewBuilds, eq(previewBuilds.id, applicationBuilds.previewId))
    .leftJoin(repositories, eq(repositories.id, previewBuilds.repositoryId))
    .where(eq(applicationBuilds.applicationId, applicationId))
    .orderBy(desc(applicationBuilds.id))
    .limit(limit)
    .all()
    .map(({ row, preview, repository }) => ({
      trigger: row.trigger,
      branch: row.trackedRef.replace(/^refs\/heads\//, ""),
      commitSha: row.commitSha,
      outcome: row.outcome,
      reasons: (row.reasons ?? []) as unknown as ApplicationReason[],
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.finishedAt ? Math.max(0, row.finishedAt.getTime() - row.startedAt.getTime()) : null,
      build:
        preview?.publicId && row.attempt !== null && repository
          ? { preview: preview.publicId, repository, attempt: row.attempt, latestAttempt: preview.attempt!, latestState: preview.attemptState!, logKept: preview.deletedAt === null && preview.attempt === row.attempt && preview.attemptLog !== null }
          : null,
    }));
}
