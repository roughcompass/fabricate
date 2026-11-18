import crypto from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Assessment } from "@/lib/assessments/assessment-records";
import { launchAssessment } from "@/lib/assessments/launcher";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { type ProfileTrigger, assessmentTargets, assessments, profileVersions, repositoryProfiles, sourceSnapshots } from "@/lib/db/schema";
import { PROFILING_INITIATIVE_ID } from "@/lib/initiatives/initiative-records";

/*
 * Profile versions (docs/profiling.md). Every enabled repository is profiled
 * in the background, and each profile is a numbered version of it: a Run of
 * the Repository profiling initiative that profiles the repository alone, at
 * the reference the catalog sets for it. A repository has at most one version
 * queued or running at a time.
 */

export type ProfileVersionRow = typeof profileVersions.$inferSelect;

/** A Run that hasn't finished. */
export const ACTIVE_STATES = ["queued", "acquiring", "analyzing", "finalizing"] as const;

export const TRIGGER_LABELS: Record<ProfileTrigger, string> = {
  imported: "Imported",
  added: "Added",
  edited: "Edited",
  manual: "Re-profiled",
  initial: "First profile",
  commit: "New commits",
  detector: "Detector upgrade",
};

export interface ProfileVersion {
  readonly version: number;
  readonly trigger: ProfileTrigger;
  readonly createdAt: Date;
  readonly headCommit: string | null;
  readonly assessment: Assessment;
  /** The Profile the version wrote, once its Run profiled the repository. */
  readonly profile: { readonly id: number; readonly publicId: string; readonly createdAt: Date } | null;
  /** The commit the version profiled, once it was acquired. */
  readonly commit: string | null;
  /** Why the repository couldn't be profiled, when it couldn't. */
  readonly failure: { readonly code: string; readonly message: string } | null;
}

export type QueueResult = { readonly status: "queued"; readonly version: ProfileVersion } | { readonly status: "active"; readonly version: ProfileVersion } | { readonly status: "disabled" };

export function isActive(version: Pick<ProfileVersion, "assessment">): boolean {
  return (ACTIVE_STATES as readonly string[]).includes(version.assessment.state);
}

/**
 * Queues the next profile version of +source+ for +trigger+, unless the
 * repository is disabled or already has a version queued or running. The
 * version's Run is launched in the same transaction, so the version exists
 * exactly when its jobs do.
 */
export function queueProfile(db: Executor, source: RepositorySource, trigger: ProfileTrigger, options: { headCommit?: string | null; launchToken?: string; config?: FabricateConfig } = {}): QueueResult {
  return immediate(db, (tx) => {
    if (!source.enabled) return { status: "disabled" };
    const latest = versionsOf(tx, source.id, 1)[0];
    if (latest && isActive(latest)) return { status: "active", version: latest };
    const launched = launchAssessment(tx, PROFILING_INITIATIVE_ID, options.launchToken ?? crypto.randomUUID(), options.config ?? getConfig(), { sources: [source] });
    // A repeated launch token, such as a form submitted twice, names the version it already queued.
    if (launched.duplicate) return { status: "active", version: versionsOf(tx, source.id).find((version) => version.assessment.id === launched.assessment.id)! };
    const number = (latest?.version ?? 0) + 1;
    tx.insert(profileVersions).values({ repositorySourceId: source.id, assessmentId: launched.assessment.id, version: number, trigger, headCommit: options.headCommit ?? null, createdAt: launched.assessment.createdAt }).run();
    return { status: "queued", version: versionsOf(tx, source.id, 1)[0]! };
  });
}

/** The versions of the repository +sourceId+, newest first: at most +limit+, after skipping +offset+. One query. */
export function versionsOf(db: Executor, sourceId: number, limit = -1, offset = 0): ProfileVersion[] {
  return db
    .select({
      row: profileVersions,
      assessment: assessments,
      profileId: repositoryProfiles.id,
      profilePublicId: repositoryProfiles.publicId,
      profileCreatedAt: repositoryProfiles.createdAt,
      commit: sourceSnapshots.commitSha,
      failureCode: assessmentTargets.failureCode,
      failureMessage: assessmentTargets.failureMessage,
    })
    .from(profileVersions)
    .innerJoin(assessments, eq(assessments.id, profileVersions.assessmentId))
    .leftJoin(assessmentTargets, and(eq(assessmentTargets.assessmentId, profileVersions.assessmentId), eq(assessmentTargets.repositorySourceId, profileVersions.repositorySourceId)))
    .leftJoin(sourceSnapshots, eq(sourceSnapshots.assessmentTargetId, assessmentTargets.id))
    .leftJoin(repositoryProfiles, eq(repositoryProfiles.assessmentTargetId, assessmentTargets.id))
    .where(eq(profileVersions.repositorySourceId, sourceId))
    .orderBy(desc(profileVersions.version))
    .limit(limit)
    .offset(offset)
    .all()
    .map((found) => ({
      version: found.row.version,
      trigger: found.row.trigger,
      createdAt: found.row.createdAt,
      headCommit: found.row.headCommit,
      assessment: found.assessment,
      profile: found.profileId === null ? null : { id: found.profileId, publicId: found.profilePublicId!, createdAt: found.profileCreatedAt! },
      commit: found.commit,
      failure: found.failureCode === null ? null : { code: found.failureCode, message: found.failureMessage ?? "" },
    }));
}

/** How many versions the repository +sourceId+ has. */
export function versionCount(db: Executor, sourceId: number): number {
  return db.select({ count: count() }).from(profileVersions).where(eq(profileVersions.repositorySourceId, sourceId)).get()?.count ?? 0;
}

/** The version that is the Run +assessmentId+, with its repository's public ID and name; null for any other Run. */
export function versionOfAssessment(db: Executor, assessmentId: number): { version: number; sourcePublicId: string; sourceName: string } | null {
  const row = db
    .select({ version: profileVersions.version, sourcePublicId: assessmentTargets.sourcePublicId, sourceName: assessmentTargets.sourceName })
    .from(profileVersions)
    .innerJoin(assessmentTargets, and(eq(assessmentTargets.assessmentId, profileVersions.assessmentId), eq(assessmentTargets.repositorySourceId, profileVersions.repositorySourceId)))
    .where(eq(profileVersions.assessmentId, assessmentId))
    .get();
  return row ?? null;
}

/** The newest version of the repository +sourceId+ that wrote a Profile. */
export function currentVersion(db: Executor, sourceId: number): ProfileVersion | undefined {
  const row = db
    .select({ version: profileVersions.version })
    .from(profileVersions)
    .innerJoin(assessmentTargets, and(eq(assessmentTargets.assessmentId, profileVersions.assessmentId), eq(assessmentTargets.repositorySourceId, profileVersions.repositorySourceId)))
    .innerJoin(repositoryProfiles, eq(repositoryProfiles.assessmentTargetId, assessmentTargets.id))
    .where(eq(profileVersions.repositorySourceId, sourceId))
    .orderBy(desc(profileVersions.version))
    .limit(1)
    .get();
  return row ? findVersion(db, sourceId, row.version) : undefined;
}

export interface ProfileSummary {
  /** The newest version, whatever its state. */
  readonly latest: { readonly version: number; readonly state: Assessment["state"]; readonly createdAt: Date };
  /** The newest version that wrote a Profile. */
  readonly current: { readonly version: number; readonly profiledAt: Date } | null;
}

/** Each repository's newest version and newest profiled version, by source id, in one query, for the Repositories list. */
export function profileSummaries(db: Executor): Map<number, ProfileSummary> {
  const rows = db.all<{ source_id: number; version: number; state: Assessment["state"]; created_at: number; current_version: number | null; profiled_at: number | null }>(sql`
    with ranked as (
      select v.repository_source_id as source_id, v.version, a.state, v.created_at, p.created_at as profiled_at,
        row_number() over (partition by v.repository_source_id order by v.version desc) as recency,
        case when p.id is null then null else row_number() over (partition by v.repository_source_id, p.id is not null order by v.version desc) end as profiled_recency
      from ${profileVersions} v
      join assessments a on a.id = v.assessment_id
      left join ${assessmentTargets} t on t.assessment_id = v.assessment_id and t.repository_source_id = v.repository_source_id
      left join ${repositoryProfiles} p on p.assessment_target_id = t.id
    )
    select l.source_id, l.version, l.state, l.created_at, c.version as current_version, c.profiled_at
    from ranked l
    left join ranked c on c.source_id = l.source_id and c.profiled_recency = 1
    where l.recency = 1`);
  return new Map(
    rows.map((row) => [
      row.source_id,
      {
        latest: { version: row.version, state: row.state, createdAt: new Date(row.created_at) },
        current: row.current_version === null ? null : { version: row.current_version, profiledAt: new Date(row.profiled_at!) },
      },
    ]),
  );
}

/** What the scheduled check compares of a repository's newest version. */
export interface CheckState {
  readonly version: number;
  readonly state: Assessment["state"];
  readonly headCommit: string | null;
  /** The commit the version profiled, or failing that, the one the check saw when it queued it. */
  readonly knownCommit: string | null;
  readonly detectorRelease: string;
  readonly profileSchemaVersion: number;
}

/** The newest version of every repository, by source id, in one query. */
export function latestVersions(db: Executor): Map<number, CheckState> {
  const rows = db.all<{ source_id: number; version: number; state: Assessment["state"]; head_commit: string | null; commit_sha: string | null; detector_release: string; profile_schema_version: number }>(sql`
    select v.repository_source_id as source_id, v.version, a.state, v.head_commit, s.commit_sha, a.detector_release, a.profile_schema_version
    from ${profileVersions} v
    join assessments a on a.id = v.assessment_id
    left join ${assessmentTargets} t on t.assessment_id = v.assessment_id and t.repository_source_id = v.repository_source_id
    left join ${sourceSnapshots} s on s.assessment_target_id = t.id
    where v.version = (select max(o.version) from ${profileVersions} o where o.repository_source_id = v.repository_source_id)`);
  return new Map(
    rows.map((row) => [
      row.source_id,
      { version: row.version, state: row.state, headCommit: row.head_commit, knownCommit: row.commit_sha ?? row.head_commit, detectorRelease: row.detector_release, profileSchemaVersion: row.profile_schema_version },
    ]),
  );
}

/** The version of +sourceId+ numbered +version+. */
export function findVersion(db: Executor, sourceId: number, version: number): ProfileVersion | undefined {
  const total = versionCount(db, sourceId);
  if (!Number.isInteger(version) || version < 1 || version > total) return undefined;
  // Versions are numbered from 1 without gaps, so the newest-first offset of version n is total - n.
  return versionsOf(db, sourceId, 1, total - version)[0];
}
