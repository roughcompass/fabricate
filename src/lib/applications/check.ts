import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { normalizeAcquisitionError } from "@/lib/acquisition/acquire";
import type { Advertisement } from "@/lib/acquisition/mirror";
import type { Repository } from "@/lib/repositories/repository-records";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { JOB_PRIORITIES, applicationPreviews, applications, repositories } from "@/lib/db/schema";
import type { GitRunner } from "@/lib/git/runner";
import { isEnrolled } from "@/lib/previews/access";
import { settleAbandonedAttempts, settleAbandonedPreparations } from "@/lib/previews/records";
import { readRemote } from "@/lib/previews/refs";
import { settleAbandonedScreenshots } from "@/lib/previews/screenshots";
import { ApplicationBuildError, buildApplication, buildSavedPreview } from "./pipeline";
import { branchLabel } from "./records";
import { refKind, refLabel } from "./saved-previews";

/*
 * The automatic check for new commits (add-applications, design decision 3;
 * docs/previews.md, "Automatic rebuilds"). It runs in each profiling.check
 * job, after the profiling check, so tracked branches are read on the same
 * schedule as Repositories' references. For every application with no
 * attempt under way, it reads its remote with `ls-remote`, four remotes at a
 * time and once per remote however many of its packages are applications,
 * and starts the pipeline when the tracked branch names a commit other than
 * the latest attempt's. A commit whose build failed or was refused is the
 * latest attempt's, so it isn't tried again until the branch moves or an
 * operator rebuilds. A remote that can't be read is logged and skipped,
 * leaving its applications as they were, and the next check reads it again.
 *
 * Saved previews are compared against the same read of their remote
 * (restore-toolbar-tools-and-branch-previews, design decision 3), so they add
 * no remote reads: a saved branch that moved starts an attempt, queued at
 * background priority behind tracked branches and operator actions; a saved
 * tag is never rebuilt; and a saved ref the remote no longer has is marked
 * missing, keeping its last build, until it returns.
 */

/** How many remotes the check reads at once. */
const PARALLEL_REMOTES = 4;

export interface ApplicationCheckResult {
  /** Applications and saved previews whose branch or tag the check read, or tried to. */
  readonly checked: number;
  /** Applications and saved branches that had moved, for which an attempt started. */
  readonly started: number;
  /** Applications and saved previews whose remote, or ref, couldn't be read. */
  readonly unreadable: number;
}

export interface ApplicationCheckOptions {
  runner?: GitRunner;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export async function checkApplications(db: Executor, config: FrontendRegistryConfig, options: ApplicationCheckOptions = {}): Promise<ApplicationCheckResult> {
  if (!config.previews.enabled) return { checked: 0, started: 0, unreadable: 0 };
  // Attempts and captures whose jobs were lost end now, so their applications are checked again rather than stay Building.
  settleAbandonedPreparations(db);
  settleAbandonedAttempts(db);
  settleAbandonedScreenshots(db);
  const enrolled = new Map<number, boolean>();
  const isChecked = (repository: Repository) => enrolled.get(repository.id) ?? enrolled.set(repository.id, isEnrolled(db, config, repository)).get(repository.id)!;
  const rows = db
    .select({ publicId: applications.publicId, name: applications.name, trackedRef: applications.trackedRef, latestCommitSha: applications.latestCommitSha, repository: repositories })
    .from(applications)
    .innerJoin(repositories, eq(repositories.id, applications.repositoryId))
    .where(and(ne(applications.latestOutcome, "building"), isNull(repositories.deletedAt)))
    .all()
    .filter((row) => isChecked(row.repository));
  const saved = db
    .select({ id: applicationPreviews.id, publicId: applicationPreviews.publicId, ref: applicationPreviews.ref, latestCommitSha: applicationPreviews.latestCommitSha, missing: applicationPreviews.remoteMissingAt, name: applications.name, repository: repositories })
    .from(applicationPreviews)
    .innerJoin(applications, eq(applications.id, applicationPreviews.applicationId))
    .innerJoin(repositories, eq(repositories.id, applications.repositoryId))
    .where(and(ne(applicationPreviews.latestOutcome, "building"), isNull(repositories.deletedAt)))
    .all()
    .filter((row) => isChecked(row.repository));
  const remotes = new Map<number, { repository: Repository; applications: typeof rows; saved: typeof saved }>();
  const remoteOf = (repository: Repository) => remotes.get(repository.id) ?? remotes.set(repository.id, { repository, applications: [], saved: [] }).get(repository.id)!;
  for (const row of rows) remoteOf(row.repository).applications.push(row);
  for (const row of saved) remoteOf(row.repository).saved.push(row);

  let started = 0;
  let unreadable = 0;
  const missing: number[] = [];
  const returned: number[] = [];
  /** Starts an attempt, counting it; one another request started meanwhile is already on its way. */
  const start = async (what: string, ref: string, build: () => Promise<unknown>) => {
    try {
      await build();
      started += 1;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof ApplicationBuildError) return;
      unreadable += 1;
      options.log?.(`applications check: ${what} couldn't start a build of ${ref}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await eachLimited([...remotes.values()], PARALLEL_REMOTES, async ({ repository, applications: tracked, saved: kept }) => {
    let advertised: Advertisement;
    try {
      advertised = await readRemote(repository, { config, runner: options.runner, signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      unreadable += tracked.length + kept.length;
      options.log?.(`applications check: ${repository.name}'s remote couldn't be read: ${normalizeAcquisitionError(error).message}`);
      return;
    }
    const refOptions = { config, runner: options.runner, signal: options.signal };
    for (const application of tracked) {
      const head = advertised.refs.get(application.trackedRef);
      if (!head) {
        unreadable += 1;
        options.log?.(`applications check: ${repository.name} has no branch ${branchLabel(application.trackedRef)}, which ${application.name} tracks`);
        continue;
      }
      if (head !== application.latestCommitSha) await start(application.name, branchLabel(application.trackedRef), () => buildApplication(db, application.publicId, refOptions));
    }
    // Saved previews after tracked branches, and their builds behind them in the queue.
    for (const preview of kept) {
      const head = advertised.refs.get(preview.ref);
      if (!head) {
        unreadable += 1;
        if (preview.missing === null) {
          missing.push(preview.id);
          options.log?.(`applications check: ${repository.name} has no ${refKind(preview.ref)} ${refLabel(preview.ref)}, which ${preview.name} keeps a preview of`);
        }
        continue;
      }
      if (preview.missing !== null) returned.push(preview.id);
      if (refKind(preview.ref) === "tag" || head === preview.latestCommitSha) continue;
      await start(`${preview.name} (${refLabel(preview.ref)})`, refLabel(preview.ref), () => buildSavedPreview(db, preview.publicId, { ...refOptions, priority: JOB_PRIORITIES.background }));
    }
  });
  markRemoteMissing(db, missing, returned);
  return { checked: rows.length + saved.length, started, unreadable };
}

/** How many saved previews one statement marks; a fleet can have thousands. */
const MARK_BATCH = 500;

/** Records that the remote no longer has the saved previews +missing+, and has +returned+ again. */
function markRemoteMissing(db: Executor, missing: readonly number[], returned: readonly number[]): void {
  const now = new Date();
  for (const [ids, value] of [[missing, now], [returned, null]] as const) {
    for (let start = 0; start < ids.length; start += MARK_BATCH) {
      db.update(applicationPreviews).set({ remoteMissingAt: value }).where(inArray(applicationPreviews.id, ids.slice(start, start + MARK_BATCH))).run();
    }
  }
}

/** Runs +work+ on every item, at most +limit+ at a time. */
async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
