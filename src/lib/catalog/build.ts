import { BUILD_FAILURES, CatalogBuildError, buildFromRegistry } from "@repo-facts/catalog-builder";
import type { JsonObject } from "@repo-facts/contract";
import { desc, eq, inArray } from "drizzle-orm";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { type JobState, JOB_PRIORITIES, catalogEntries, jobs } from "@/lib/db/schema";
import { type Job, enqueue, jobPayload } from "@/lib/jobs/queue";
import { NonRetryableError } from "@/lib/jobs/worker";
import { type CatalogConfiguration, type DescribedThing, catalogConfiguration } from "./configuration";
import { type Stored, type StoredEntry, entryByDigest, storeEntry } from "./entries";

/*
 * Catalog builds (establish-frontend-registry, design decision 5). Each
 * attempt to build one thing at one version is a `catalog.build` job: its
 * payload names the thing, the version, and why it was queued, and the job's
 * state and last error are the outcome. These jobs are never pruned, so they
 * are the history of builds, and the entry a build stored names its job.
 *
 * The Catalog Builder downloads the thing's packages from the configured
 * registry and reads them as data. A build that fails stores nothing, so the
 * entries in use stay as they were. One that writes an entry already stored,
 * such as a rebuild whose inputs didn't change, stores nothing new.
 */

export const BUILD_ENTRY = "catalog.build";

/** Why a build was queued: a Repository uses the version, it's the newest published, or the team's rules changed since its entry was built. */
export const BUILD_REASONS = ["in_use", "published", "rules"] as const;
export type BuildReason = (typeof BUILD_REASONS)[number];

export interface BuildRequest {
  kind: string;
  id: string;
  version: string;
  reason: BuildReason;
}

/** The name a failed build's last error starts with, before its reason. */
const FAILURE_NAME = "CatalogBuildError";

/**
 * Queues a build of +thing+ at +version+. One is queued per thing, version,
 * rules, and day, so a check repeated within a day queues nothing new, and a
 * build that failed is tried again the next day.
 */
export function queueBuild(db: Executor, thing: DescribedThing, version: string, reason: BuildReason, now = new Date()): Job {
  const day = now.toISOString().slice(0, 10);
  const payload: JsonObject = { kind: thing.kind, id: thing.id, version, reason };
  return enqueue(db, { kind: BUILD_ENTRY, payload, idempotencyKey: `${BUILD_ENTRY}:${thing.key}:${version}:${thing.rules.version}:${day}`, priority: JOB_PRIORITIES.normal, maxAttempts: 3 });
}

/** A build job's payload. */
export function buildRequest(payload: JsonObject): BuildRequest {
  const reason = String(payload.reason);
  return { kind: String(payload.kind), id: String(payload.id), version: String(payload.version), reason: (BUILD_REASONS as readonly string[]).includes(reason) ? (reason as BuildReason) : "in_use" };
}

export interface RunBuildOptions {
  config: FrontendRegistryConfig;
  catalog?: CatalogConfiguration;
  /** The job running the build, which the entry it stores names. */
  jobId?: number;
  /** The fetch the Catalog Builder downloads with; the global one by default. */
  fetch?: typeof fetch;
  now?: () => Date;
}

/**
 * Builds +request+'s entry from the configured registry and stores it. A
 * failure throws an error named CatalogBuildError whose message starts with
 * the Catalog Builder's reason; only an unreachable registry is worth
 * retrying.
 */
export async function runBuild(db: Executor, request: BuildRequest, options: RunBuildOptions): Promise<Stored> {
  const catalog = options.catalog ?? catalogConfiguration(options.config);
  const thing = catalog.things.find((candidate) => candidate.kind === request.kind && candidate.id === request.id);
  if (!thing) throw new NonRetryableError(`${request.kind}:${request.id} is no longer described in config/catalog.yaml`);
  let entry;
  try {
    entry = await buildFromRegistry(thing, request.version, { rules: thing.rules.text, registry: options.config.catalog.registry, ...(options.fetch && { fetch: options.fetch }), ...(options.now && { now: options.now }) });
  } catch (error) {
    if (error instanceof CatalogBuildError) throw buildFailure(error);
    throw error;
  }
  return storeEntry(db, entry, { buildJobId: options.jobId ?? null });
}

class RetryableBuildFailure extends Error {
  override name = FAILURE_NAME;
}

class BuildFailure extends NonRetryableError {
  override name = FAILURE_NAME;
}

function buildFailure(error: CatalogBuildError): Error {
  const message = `${error.reason}: ${error.message}`;
  return error.reason === "registry_unreachable" ? new RetryableBuildFailure(message) : new BuildFailure(message);
}

/** One attempt to build an entry, as the status page shows it. */
export interface CatalogBuild {
  jobId: number;
  request: BuildRequest;
  state: JobState;
  attempts: number;
  queuedAt: Date;
  finishedAt: Date | null;
  /** Why its latest attempt failed: the Catalog Builder's reason, such as registry_unreachable, and its message. */
  failure: { reason: string; message: string } | null;
  /** The entry it stored. Null for a build that failed, hasn't finished, or wrote an entry already stored. */
  entry: StoredEntry | null;
}

/**
 * The newest Catalog builds, newest first, at most +limit+.
 * @public The system status page lists recent builds and their outcomes through this.
 */
export function catalogBuilds(db: Executor, limit = 20): CatalogBuild[] {
  const rows = db.select().from(jobs).where(eq(jobs.kind, BUILD_ENTRY)).orderBy(desc(jobs.id)).limit(limit).all();
  if (rows.length === 0) return [];
  const stored = new Map(
    db
      .select({ jobId: catalogEntries.buildJobId, digest: catalogEntries.digest })
      .from(catalogEntries)
      .where(inArray(catalogEntries.buildJobId, rows.map((row) => row.id)))
      .all()
      .map((row) => [row.jobId!, row.digest]),
  );
  return rows.map((row) => {
    const digest = stored.get(row.id);
    return {
      jobId: row.id,
      request: buildRequest(jobPayload(row)),
      state: row.state,
      attempts: row.attempts,
      queuedAt: row.createdAt,
      finishedAt: row.finishedAt,
      failure: row.lastError ? buildFailureOf(row.lastError) : null,
      entry: digest ? (entryByDigest(db, digest) ?? null) : null,
    };
  });
}

/** The reason and message of a build job's last error. */
function buildFailureOf(lastError: string): { reason: string; message: string } {
  const match = /^CatalogBuildError: ([a-z_]+): ([\s\S]*)$/.exec(lastError);
  if (match && (BUILD_FAILURES as readonly string[]).includes(match[1]!)) return { reason: match[1]!, message: match[2]! };
  return { reason: "failed", message: lastError.replace(/^\w+Error: /, "") };
}
