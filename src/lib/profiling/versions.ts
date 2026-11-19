import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type SurveyState, type SurveyTrigger, assessments, initiatives, repositoryProfiles, surveys } from "@/lib/db/schema";
import type { JsonValue } from "@repo-facts/contract";
import { statusVersion } from "@/lib/assessments/status";
import { SURVEY_MACHINE, activeStates } from "@/lib/db/state-machines";
import type { Survey } from "@/lib/surveys/records";
import { type CurrentProfile, currentProfile, currentProfiles } from "./current";

/*
 * A Repository's versions (unify-surveys, design decision 1): its surveys,
 * numbered from 1 in the order they were created, whatever started them:
 * adding or editing it, a new commit, a new recipe, an operator, a Run, or a
 * preview. Numbers are stored, so a version keeps its address.
 */

/** The states of a survey on its way: those the survey machine moves on from, but failed, which waits to be requested again. */
export const ACTIVE_STATES: readonly SurveyState[] = activeStates(SURVEY_MACHINE).filter((state) => state !== "failed");

export const TRIGGER_LABELS: Record<SurveyTrigger, string> = {
  added: "Added",
  edited: "Edited",
  commit: "New commit",
  recipe: "Surveyor upgrade",
  manual: "Re-profiled",
  run: "Assessment Run",
  preview: "Preview",
};

export interface ProfileVersion {
  readonly version: number;
  readonly trigger: SurveyTrigger;
  readonly createdAt: Date;
  readonly survey: Survey;
  /** The Profile the survey wrote, once it succeeded. */
  readonly profile: { readonly id: number; readonly publicId: string; readonly createdAt: Date } | null;
  /** The commit the version surveys. */
  readonly commit: string;
  /** Why the survey failed, when its latest attempt did. */
  readonly failure: { readonly code: string; readonly message: string } | null;
  /** The Assessment whose Run started it, when one did. */
  readonly requestedBy: { readonly assessmentPublicId: string; readonly name: string } | null;
}

export function isActive(version: Pick<ProfileVersion, "survey">): boolean {
  return ACTIVE_STATES.includes(version.survey.state);
}

/** The versions of the repository +sourceId+, newest first: at most +limit+, after skipping +offset+. One query. */
export function versionsOf(db: Executor, sourceId: number, limit = -1, offset = 0): ProfileVersion[] {
  return db
    .select({ survey: surveys, profileId: repositoryProfiles.id, profilePublicId: repositoryProfiles.publicId, profileCreatedAt: repositoryProfiles.createdAt, assessmentPublicId: assessments.publicId, initiativeName: initiatives.name })
    .from(surveys)
    .leftJoin(repositoryProfiles, eq(repositoryProfiles.surveyId, surveys.id))
    .leftJoin(assessments, eq(assessments.id, surveys.requestedByAssessmentId))
    .leftJoin(initiatives, eq(initiatives.id, assessments.initiativeId))
    .where(eq(surveys.repositorySourceId, sourceId))
    .orderBy(desc(surveys.number))
    .limit(limit)
    .offset(offset)
    .all()
    .map((found) => ({
      version: found.survey.number,
      trigger: found.survey.trigger,
      createdAt: found.survey.createdAt,
      survey: found.survey,
      profile: found.profileId === null ? null : { id: found.profileId, publicId: found.profilePublicId!, createdAt: found.profileCreatedAt! },
      commit: found.survey.commitSha,
      failure: found.survey.state === "failed" ? { code: found.survey.failureCode ?? "analysis_failed", message: found.survey.failureMessage ?? "" } : null,
      requestedBy: found.assessmentPublicId === null ? null : { assessmentPublicId: found.assessmentPublicId, name: found.initiativeName ?? "" },
    }));
}

/** How many versions the repository +sourceId+ has. */
export function versionCount(db: Executor, sourceId: number): number {
  return db.select({ count: count() }).from(surveys).where(eq(surveys.repositorySourceId, sourceId)).get()?.count ?? 0;
}

/** The version of +sourceId+ numbered +version+. */
export function findVersion(db: Executor, sourceId: number, version: number): ProfileVersion | undefined {
  if (!Number.isInteger(version) || version < 1) return undefined;
  const total = versionCount(db, sourceId);
  if (version > total) return undefined;
  // Numbers run from 1 without gaps, so the newest-first offset of version n is total - n.
  return versionsOf(db, sourceId, 1, total - version)[0];
}

/**
 * What a Repository's page shows of its surveys: its current Profile, and
 * its newest version, whose number is how many it has.
 */
export function repositoryProfiling(db: Executor, sourceId: number): { current: CurrentProfile | undefined; latest: ProfileVersion | undefined; count: number } {
  const latest = versionsOf(db, sourceId, 1)[0];
  return { current: currentProfile(db, sourceId), latest, count: latest?.version ?? 0 };
}

export interface ProfileSummary {
  /** The newest version, whatever its state, and whether it wrote a Profile. */
  readonly latest: { readonly version: number; readonly state: SurveyState; readonly createdAt: Date; readonly profiled: boolean };
  /** The current Profile: its version, and when it was written. */
  readonly current: { readonly version: number; readonly profilePublicId: string; readonly profiledAt: Date } | null;
}

/** Each repository's newest version and current Profile, by source id, in two queries, for the Repositories list. */
export function profileSummaries(db: Executor): Map<number, ProfileSummary> {
  const rows = db.all<{ source_id: number; number: number; state: SurveyState; created_at: number; profiled: number }>(sql`
    select s.repository_source_id as source_id, s.number, s.state, s.created_at, p.id is not null as profiled
    from ${surveys} s
    left join ${repositoryProfiles} p on p.survey_id = s.id
    where s.number = (select max(o.number) from ${surveys} o where o.repository_source_id = s.repository_source_id)`);
  const current = currentProfiles(db);
  return new Map(
    rows.map((row) => {
      const profile = current.get(row.source_id);
      return [
        row.source_id,
        {
          latest: { version: row.number, state: row.state, createdAt: new Date(row.created_at), profiled: Boolean(row.profiled) },
          current: profile ? { version: profile.version, profilePublicId: profile.profile.publicId, profiledAt: profile.profile.createdAt } : null,
        },
      ];
    }),
  );
}

export interface ProfilingActivity {
  /** Surveys running now. */
  readonly profiling: number;
  /** Surveys waiting their turn. */
  readonly queued: number;
  /** Changes whenever a survey starts or finishes, so a page can refresh. */
  readonly version: string;
}

/** What is being surveyed now, in one query, for the Repositories list and its status endpoint. */
export function profilingActivity(db: Executor): ProfilingActivity {
  const rows = db
    .select({ id: surveys.id, state: surveys.state })
    .from(surveys)
    .where(and(inArray(surveys.state, [...ACTIVE_STATES])))
    .orderBy(surveys.id)
    .all();
  return {
    profiling: rows.filter((row) => row.state === "running").length,
    queued: rows.filter((row) => row.state === "queued").length,
    version: statusVersion(rows as unknown as JsonValue),
  };
}
