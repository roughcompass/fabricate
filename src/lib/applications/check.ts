import { and, eq, isNull, ne } from "drizzle-orm";
import { normalizeAcquisitionError } from "@/lib/acquisition/acquire";
import type { Advertisement } from "@/lib/acquisition/mirror";
import type { Repository } from "@/lib/repositories/repository-records";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { applications, repositories } from "@/lib/db/schema";
import type { GitRunner } from "@/lib/git/runner";
import { isEnrolled } from "@/lib/previews/access";
import { settleAbandonedAttempts, settleAbandonedPreparations } from "@/lib/previews/records";
import { readRemote } from "@/lib/previews/refs";
import { settleAbandonedScreenshots } from "@/lib/previews/screenshots";
import { ApplicationBuildError, buildApplication } from "./pipeline";
import { branchLabel } from "./records";

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
 */

/** How many remotes the check reads at once. */
const PARALLEL_REMOTES = 4;

export interface ApplicationCheckResult {
  /** Applications whose branch the check read, or tried to. */
  readonly checked: number;
  /** Applications whose tracked branch had moved, for which an attempt started. */
  readonly started: number;
  /** Applications whose remote, or tracked branch, couldn't be read. */
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
  const rows = db
    .select({ publicId: applications.publicId, name: applications.name, trackedRef: applications.trackedRef, latestCommitSha: applications.latestCommitSha, repository: repositories })
    .from(applications)
    .innerJoin(repositories, eq(repositories.id, applications.repositoryId))
    .where(and(ne(applications.latestOutcome, "building"), isNull(repositories.deletedAt)))
    .all()
    .filter((row) => isEnrolled(db, config, row.repository));
  const remotes = new Map<number, { repository: Repository; applications: typeof rows }>();
  for (const row of rows) {
    const remote = remotes.get(row.repository.id) ?? { repository: row.repository, applications: [] };
    remote.applications.push(row);
    remotes.set(row.repository.id, remote);
  }

  let started = 0;
  let unreadable = 0;
  await eachLimited([...remotes.values()], PARALLEL_REMOTES, async ({ repository, applications: tracked }) => {
    let advertised: Advertisement;
    try {
      advertised = await readRemote(repository, { config, runner: options.runner, signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      unreadable += tracked.length;
      options.log?.(`applications check: ${repository.name}'s remote couldn't be read: ${normalizeAcquisitionError(error).message}`);
      return;
    }
    for (const application of tracked) {
      const head = advertised.refs.get(application.trackedRef);
      if (!head) {
        unreadable += 1;
        options.log?.(`applications check: ${repository.name} has no branch ${branchLabel(application.trackedRef)}, which ${application.name} tracks`);
        continue;
      }
      if (head === application.latestCommitSha) continue;
      try {
        await buildApplication(db, application.publicId, { config, runner: options.runner, signal: options.signal });
        started += 1;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // An attempt another request started meanwhile is already on its way.
        if (error instanceof ApplicationBuildError) continue;
        unreadable += 1;
        options.log?.(`applications check: ${application.name} couldn't start a build of ${branchLabel(application.trackedRef)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  return { checked: rows.length, started, unreadable };
}

/** Runs +work+ on every item, at most +limit+ at a time. */
async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
