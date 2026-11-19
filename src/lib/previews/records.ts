import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type ArtifactLayout, type PreviewRefKind, jobs, previewBuilds, previewPreparations } from "@/lib/db/schema";
import { dump, parseCanonical, type JsonObject, type JsonValue } from "@repo-facts/contract";
import { enqueue } from "@/lib/jobs/queue";
import type { Eligibility, PackageVerdict, Refusal } from "./eligibility";

/**
 * Persistence for repository previews (design decision 1). A preparation is
 * one per Repository and commit, so every ref at that commit shares it, and
 * a preview is one per Repository, commit, and package among undeleted
 * rows, so every ref at that commit opens the same preview. A preview's
 * latest attempt is tracked apart from the artifact it last published: a
 * rebuild starts a new attempt and leaves the artifact serving, and only the
 * current attempt of an undeleted preview can publish or fail.
 *
 * Starting preparation or an attempt enqueues its job in the same
 * transaction, so the job exists exactly when the work it does is recorded.
 */

export type PreviewPreparation = typeof previewPreparations.$inferSelect;
export type PreviewBuild = typeof previewBuilds.$inferSelect;

export const PREPARE_PREVIEW = "preview.prepare";
export const BUILD_PREVIEW = "preview.build";

/** A commit pinned for previews, as the operator named it. */
export interface PinnedCommit {
  readonly commitSha: string;
  /** The qualified remote ref (refs/heads/main, refs/tags/v1), or null when a commit SHA was given. */
  readonly refName: string | null;
  readonly refKind: PreviewRefKind;
}

/** Why a preview can't start from a preparation. */
export class PreviewRequestError extends Error {
  override name = "PreviewRequestError";

  constructor(
    readonly code: "not_ready" | "not_qualifying",
    message: string,
  ) {
    super(message);
  }
}

// -- Preparations -----------------------------------------------------------------

/**
 * The preparation of +pinned+ for +source+: a new one profiling, or the one
 * that exists for that commit. One still profiling or Ready is returned as it
 * is, unless its job was abandoned. A Refused or Failed one is prepared
 * again, so it's decided under the current settings, such as newly
 * configured Node versions; the Profile it already has is kept for the job to
 * reuse.
 */
export function openPreparation(db: Executor, source: Pick<RepositorySource, "id">, pinned: PinnedCommit): { preparation: PreviewPreparation; started: boolean } {
  return immediate(db, (tx) => {
    // A preparation whose job was abandoned is Failed, so it's prepared again rather than left profiling.
    settleAbandonedPreparations(tx);
    const now = new Date();
    const existing = tx
      .select()
      .from(previewPreparations)
      .where(and(eq(previewPreparations.repositorySourceId, source.id), eq(previewPreparations.commitSha, pinned.commitSha)))
      .get();
    if (existing && (existing.state === "profiling" || existing.state === "ready")) return { preparation: existing, started: false };

    // Each request is later than the last, so its job's idempotency key is new.
    const requestedAt = existing ? new Date(Math.max(now.getTime(), existing.requestedAt.getTime() + 1)) : now;
    const preparation = existing
      ? tx
          .update(previewPreparations)
          .set({ state: "profiling", packages: null, refusal: null, failure: null, requestedAt, updatedAt: now, finishedAt: null })
          .where(eq(previewPreparations.id, existing.id))
          .returning()
          .get()
      : tx
          .insert(previewPreparations)
          .values({ publicId: generatePublicId("ppr"), repositorySourceId: source.id, commitSha: pinned.commitSha, refName: pinned.refName, refKind: pinned.refKind, requestedAt: now, createdAt: now, updatedAt: now })
          .returning()
          .get();
    enqueue(tx, { kind: PREPARE_PREVIEW, payload: preparationJob(preparation), idempotencyKey: `${PREPARE_PREVIEW}:${preparation.publicId}:${preparation.requestedAt.getTime()}` });
    return { preparation, started: true };
  });
}

/** The job payload that prepares +preparation+ as it was last requested. */
export function preparationJob(preparation: Pick<PreviewPreparation, "publicId" | "requestedAt">): JsonObject {
  return { preparation: preparation.publicId, requested: preparation.requestedAt.getTime() };
}

export function findPreparation(db: Executor, publicId: string): PreviewPreparation | undefined {
  return db.select().from(previewPreparations).where(eq(previewPreparations.publicId, publicId)).get();
}

/** The Profile a decision was made from: the Repository's own, or a document the preparation made itself. */
export type PreparationProfile = { readonly repositoryProfileId: number; readonly digest: string } | { readonly document: string; readonly digest: string };

/**
 * Records the decision for the request +requested+ (a job payload's time) of
 * a preparation still profiling: Ready when some package qualifies, else
 * Refused. Returns null when the preparation was since decided or requested
 * again, so a late job changes nothing.
 */
export function decidePreparation(db: Executor, publicId: string, requested: number, profile: PreparationProfile, eligibility: Eligibility): PreviewPreparation | null {
  const now = new Date();
  const refused = eligibility.packages.every((verdict) => !verdict.qualifies);
  return (
    db
      .update(previewPreparations)
      .set({
        state: refused ? "refused" : "ready",
        repositoryProfileId: "repositoryProfileId" in profile ? profile.repositoryProfileId : null,
        profileDocument: "document" in profile ? profile.document : null,
        profileDigest: profile.digest,
        packages: dump(eligibility.packages as unknown as JsonValue),
        refusal: refused ? dump(eligibility.refusal as unknown as JsonValue) : null,
        updatedAt: now,
        finishedAt: now,
      })
      .where(and(eq(previewPreparations.publicId, publicId), eq(previewPreparations.state, "profiling"), eq(previewPreparations.requestedAt, new Date(requested))))
      .returning()
      .get() ?? null
  );
}

/** Records why preparation stopped before a decision, unless it was since decided or requested again. */
export function failPreparation(db: Executor, publicId: string, requested: number, failure: string): PreviewPreparation | null {
  const now = new Date();
  return (
    db
      .update(previewPreparations)
      .set({ state: "failed", failure: failure.slice(0, 1_000) || "Preparation failed", updatedAt: now, finishedAt: now })
      .where(and(eq(previewPreparations.publicId, publicId), eq(previewPreparations.state, "profiling"), eq(previewPreparations.requestedAt, new Date(requested))))
      .returning()
      .get() ?? null
  );
}

/** Every package's verdict, once decided. */
export function preparationPackages(preparation: PreviewPreparation): PackageVerdict[] {
  return preparation.packages === null ? [] : (parseCanonical(preparation.packages) as unknown as PackageVerdict[]);
}

/** Why the commit is Not previewable, when it's refused. */
export function preparationRefusal(preparation: PreviewPreparation): Refusal | null {
  return preparation.refusal === null ? null : (parseCanonical(preparation.refusal) as unknown as Refusal);
}

// -- Previews -------------------------------------------------------------------------

/**
 * Starts the preview of the qualifying package +packageDir+ of a ready
 * preparation, at the preparation's commit, never resolving its ref again.
 * When the Repository, commit, and package already have a preview, it's
 * opened instead, and no second build starts.
 */
export function startPreview(db: Executor, preparationPublicId: string, packageDir: string): { preview: PreviewBuild; created: boolean } {
  return immediate(db, (tx) => {
    const preparation = findPreparation(tx, preparationPublicId);
    if (!preparation) throw new NotFoundError(`Preview preparation ${preparationPublicId} does not exist`);
    if (preparation.state !== "ready") throw new PreviewRequestError("not_ready", `The commit ${preparation.commitSha.slice(0, 12)} has no package to preview yet (${preparation.state})`);
    const verdict = preparationPackages(preparation).find((candidate) => candidate.directory === packageDir && candidate.qualifies);
    if (!verdict) throw new PreviewRequestError("not_qualifying", `${packageDir} is not a package of ${preparation.commitSha.slice(0, 12)} that can be previewed`);

    const existing = tx
      .select()
      .from(previewBuilds)
      .where(and(eq(previewBuilds.repositorySourceId, preparation.repositorySourceId), eq(previewBuilds.commitSha, preparation.commitSha), eq(previewBuilds.packageDir, packageDir), isNull(previewBuilds.deletedAt)))
      .get();
    if (existing) return { preview: existing, created: false };

    const now = new Date();
    const preview = tx
      .insert(previewBuilds)
      .values({
        publicId: generatePublicId("pvw"),
        repositorySourceId: preparation.repositorySourceId,
        preparationId: preparation.id,
        commitSha: preparation.commitSha,
        packageDir,
        refName: preparation.refName,
        refKind: preparation.refKind,
        profileDigest: preparation.profileDigest!,
        decidingFacts: dump(verdict as unknown as JsonValue),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    enqueueAttempt(tx, preview);
    return { preview, created: true };
  });
}

/** An undeleted preview. */
export function findPreview(db: Executor, publicId: string): PreviewBuild | undefined {
  return db
    .select()
    .from(previewBuilds)
    .where(and(eq(previewBuilds.publicId, publicId), isNull(previewBuilds.deletedAt)))
    .get();
}

/**
 * Starts the next attempt of a preview, keeping its published artifact
 * serving until that attempt publishes. A preview whose latest attempt is
 * still queued or building is returned as it is, unless its build job was
 * abandoned, which fails the attempt first so it can be rebuilt.
 */
export function rebuildPreview(db: Executor, publicId: string): PreviewBuild {
  return immediate(db, (tx) => {
    settleAbandonedAttempts(tx, { publicId });
    const preview = findPreview(tx, publicId);
    if (!preview) throw new NotFoundError(`Preview ${publicId} does not exist`);
    if (preview.attemptState === "queued" || preview.attemptState === "building") return preview;
    const now = new Date();
    const next = tx
      .update(previewBuilds)
      .set({ attempt: preview.attempt + 1, attemptState: "queued", attemptClaim: null, attemptReason: null, attemptLog: null, attemptStartedAt: null, finishedAt: null, updatedAt: now })
      .where(eq(previewBuilds.id, preview.id))
      .returning()
      .get();
    enqueueAttempt(tx, next);
    return next;
  });
}

/**
 * Starts the current attempt under the worker claim +claim+, or takes it over
 * from a claim whose lease expired: the attempt becomes Building, only that
 * claim can publish or fail it, and its log is +log+. Returns null when
 * +attempt+ is no longer the current attempt of an undeleted preview, or has
 * finished.
 */
export function claimAttempt(db: Executor, publicId: string, attempt: number, claim: string, log: string): PreviewBuild | null {
  const now = new Date();
  return (
    db
      .update(previewBuilds)
      .set({ attemptState: "building", attemptClaim: claim, attemptLog: log, attemptStartedAt: now, updatedAt: now })
      .where(currentAttempt(publicId, { attempt }))
      .returning()
      .get() ?? null
  );
}

/** The output an attempt publishes: where it is in the preview's storage, and how it was built. */
export interface PublishedArtifact {
  directory: string;
  layout: ArtifactLayout;
  entry: JsonObject;
  outputBytes: number;
  buildMs: number;
  nodeVersion: string;
  packageManager: string;
  log?: string;
}

/** Identifies the attempt doing the work; with a claim, only that worker's claim of it. */
export interface AttemptIdentity {
  attempt: number;
  claim?: string;
}

/**
 * Publishes +artifact+ as the preview's output and marks the attempt Ready,
 * only while +identity+ is the current attempt of an undeleted preview.
 * Returns false otherwise, leaving the published artifact as it was.
 */
export function publishAttempt(db: Executor, publicId: string, identity: AttemptIdentity, artifact: PublishedArtifact): boolean {
  const now = new Date();
  const result = db
    .update(previewBuilds)
    .set({
      attemptState: "ready",
      attemptReason: null,
      ...(artifact.log !== undefined && { attemptLog: artifact.log }),
      artifact: artifact.directory,
      artifactAttempt: identity.attempt,
      artifactLayout: artifact.layout,
      artifactEntry: dump(artifact.entry),
      outputBytes: artifact.outputBytes,
      buildMs: artifact.buildMs,
      nodeVersion: artifact.nodeVersion,
      packageManager: artifact.packageManager,
      finishedAt: now,
      updatedAt: now,
    })
    .where(currentAttempt(publicId, identity))
    .run();
  return result.changes === 1;
}

/** Marks the current attempt Failed with +reason+, keeping the published artifact. Returns false if it's no longer current. */
export function failAttempt(db: Executor, publicId: string, identity: AttemptIdentity, reason: string, log?: string): boolean {
  const now = new Date();
  const result = db
    .update(previewBuilds)
    .set({ attemptState: "failed", attemptReason: reason.slice(0, 1_000) || "The build failed", ...(log !== undefined && { attemptLog: log }), finishedAt: now, updatedAt: now })
    .where(currentAttempt(publicId, identity))
    .run();
  return result.changes === 1;
}

/**
 * Fails each queued or building attempt whose `preview.build` job can no
 * longer run it: the job failed, for example after the worker running it
 * stopped or lost its lease on every try; it ended without settling the
 * attempt; it's running under an expired lease with no tries left, which the
 * queue would fail rather than run again; or it no longer exists. Without
 * this such a preview would stay Building, so it could be neither rebuilt
 * nor pruned. Limited to +publicId+ when given. Returns the previews failed.
 */
export function settleAbandonedAttempts(db: Executor, options: { publicId?: string; now?: Date } = {}): string[] {
  const now = options.now ?? new Date();
  const rows = db
    .select({ publicId: previewBuilds.publicId, attempt: previewBuilds.attempt, job: jobs.id, state: jobs.state, tries: jobs.attempts, maxTries: jobs.maxAttempts, leaseExpiresAt: jobs.leaseExpiresAt, lastError: jobs.lastError })
    .from(previewBuilds)
    .leftJoin(jobs, eq(jobs.idempotencyKey, sql`${`${BUILD_PREVIEW}:`} || ${previewBuilds.publicId} || ':' || ${previewBuilds.attempt}`))
    .where(and(isNull(previewBuilds.deletedAt), inArray(previewBuilds.attemptState, ["queued", "building"]), options.publicId === undefined ? undefined : eq(previewBuilds.publicId, options.publicId)))
    .all();
  return rows.flatMap((row) => {
    const reason = abandonment(row, now, "build");
    return reason !== null && failAttempt(db, row.publicId, { attempt: row.attempt }, reason) ? [row.publicId] : [];
  });
}

/**
 * Fails each preparation still profiling whose `preview.prepare` job can no
 * longer run it, by the same rule as settleAbandonedAttempts, so the commit
 * can be prepared again rather than stay Profiling. Returns those failed.
 */
export function settleAbandonedPreparations(db: Executor, now = new Date()): string[] {
  const rows = db
    .select({ publicId: previewPreparations.publicId, requestedAt: previewPreparations.requestedAt, job: jobs.id, state: jobs.state, tries: jobs.attempts, maxTries: jobs.maxAttempts, leaseExpiresAt: jobs.leaseExpiresAt, lastError: jobs.lastError })
    .from(previewPreparations)
    .leftJoin(jobs, eq(jobs.idempotencyKey, sql`${`${PREPARE_PREVIEW}:`} || ${previewPreparations.publicId} || ':' || ${previewPreparations.requestedAt}`))
    .where(eq(previewPreparations.state, "profiling"))
    .all();
  return rows.flatMap((row) => {
    const reason = abandonment(row, now, "preparation");
    return reason !== null && failPreparation(db, row.publicId, row.requestedAt.getTime(), reason) ? [row.publicId] : [];
  });
}

/** Why work whose job is +job+ can no longer finish, or null while the job can still run it. */
function abandonment(job: { job: number | null; state: string | null; tries: number | null; maxTries: number | null; leaseExpiresAt: Date | null; lastError: string | null }, now: Date, work: "build" | "preparation"): string | null {
  const again = work === "build" ? "Rebuild the preview to try again." : "Request the commit again to retry.";
  if (job.job === null) return `The ${work}'s job no longer exists, so it can't finish. ${again}`;
  if (job.state === "succeeded") return `The ${work}'s job ended without finishing it. ${again}`;
  if (job.state === "failed" || (job.state === "running" && job.leaseExpiresAt !== null && job.leaseExpiresAt <= now && job.tries! >= job.maxTries!)) {
    const tries = job.tries === 1 ? "its one try" : `each of its ${job.tries} tries`;
    return `The ${work} stopped before it finished: the worker running it stopped or lost the job on ${tries}.${job.lastError ? ` Last error: ${job.lastError}` : ""}`;
  }
  return null;
}

/** How often serving records that a preview was opened, at most. */
const OPENED_RESOLUTION_MS = 60_000;

/**
 * Records that a preview was opened, for pruning by least recent use. Serving
 * calls it for the artifact's page, and writes at most once a minute per
 * preview.
 */
export function markOpened(db: Executor, publicId: string, now = new Date()): void {
  db.update(previewBuilds)
    .set({ lastOpenedAt: now })
    .where(and(eq(previewBuilds.publicId, publicId), isNull(previewBuilds.deletedAt), or(isNull(previewBuilds.lastOpenedAt), lt(previewBuilds.lastOpenedAt, new Date(now.getTime() - OPENED_RESOLUTION_MS)))))
    .run();
}

function currentAttempt(publicId: string, identity: AttemptIdentity) {
  return and(
    eq(previewBuilds.publicId, publicId),
    eq(previewBuilds.attempt, identity.attempt),
    inArray(previewBuilds.attemptState, ["queued", "building"]),
    isNull(previewBuilds.deletedAt),
    ...(identity.claim === undefined ? [] : [eq(previewBuilds.attemptClaim, identity.claim)]),
  );
}

function enqueueAttempt(db: Executor, preview: PreviewBuild): void {
  enqueue(db, { kind: BUILD_PREVIEW, payload: { preview: preview.publicId, attempt: preview.attempt }, idempotencyKey: `${BUILD_PREVIEW}:${preview.publicId}:${preview.attempt}` });
}
