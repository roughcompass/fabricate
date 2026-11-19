import { and, eq, inArray, max } from "drizzle-orm";
import type { Assessment, AssessmentTarget } from "@/lib/assessments/assessment-records";
import type { Executor } from "@/lib/db/client";
import { assessmentTargets, assessments, initiatives, profileVersions, repositoryProfiles, sourceSnapshots } from "@/lib/db/schema";
import type { RepositoryProfile } from "@/lib/profiles/profile-records";

/*
 * A repository's current Profile (prune-and-consolidate-code, design decision
 * 6): the newest Profile written for it, by any Run, a background profile
 * version or an operator's Assessment alike. A newer Run that failed leaves
 * the older Profile current. Every page that shows a repository's current
 * Profile reads it here.
 */

export interface CurrentProfile {
  profile: RepositoryProfile;
  target: AssessmentTarget;
  assessment: Assessment;
  /** The Assessment its Run belongs to. */
  initiative: { publicId: string; name: string };
  /** The commit the Profile describes. */
  commit: string;
  /** Its profile version's number, or null for a Profile from an operator's Run. */
  version: number | null;
}

/** Joins a profile version to the one target its Run has: the version's repository. */
export const versionTarget = and(eq(assessmentTargets.assessmentId, profileVersions.assessmentId), eq(assessmentTargets.repositorySourceId, profileVersions.repositorySourceId));

/** The id of the newest Profile of each repository in +sourceIds+, or of every repository: its current Profile. */
export function newestProfileIds(db: Executor, sourceIds?: readonly number[]) {
  return db
    .select({ id: max(repositoryProfiles.id) })
    .from(repositoryProfiles)
    .innerJoin(assessmentTargets, eq(assessmentTargets.id, repositoryProfiles.assessmentTargetId))
    .where(sourceIds ? inArray(assessmentTargets.repositorySourceId, [...sourceIds]) : undefined)
    .groupBy(assessmentTargets.repositorySourceId);
}

/** The current Profile of each repository in +sourceIds+, or of every repository, by source id, in one query. */
export function currentProfiles(db: Executor, sourceIds?: readonly number[]): Map<number, CurrentProfile> {
  if (sourceIds?.length === 0) return new Map();
  const rows = db
    .select({
      profile: repositoryProfiles,
      target: assessmentTargets,
      assessment: assessments,
      initiative: { publicId: initiatives.publicId, name: initiatives.name },
      commit: sourceSnapshots.commitSha,
      version: profileVersions.version,
    })
    .from(repositoryProfiles)
    .innerJoin(assessmentTargets, eq(assessmentTargets.id, repositoryProfiles.assessmentTargetId))
    .innerJoin(assessments, eq(assessments.id, repositoryProfiles.assessmentId))
    .innerJoin(initiatives, eq(initiatives.id, assessments.initiativeId))
    .innerJoin(sourceSnapshots, eq(sourceSnapshots.id, repositoryProfiles.sourceSnapshotId))
    .leftJoin(profileVersions, versionTarget)
    .where(inArray(repositoryProfiles.id, newestProfileIds(db, sourceIds)))
    .all();
  return new Map(rows.map((row) => [row.target.repositorySourceId, row]));
}

/** The current Profile of the repository +sourceId+, or undefined when no Run has profiled it. */
export function currentProfile(db: Executor, sourceId: number): CurrentProfile | undefined {
  return currentProfiles(db, [sourceId]).get(sourceId);
}
