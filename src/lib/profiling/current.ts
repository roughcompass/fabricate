import { eq, inArray } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { repositoryProfiles, repositories, surveys } from "@/lib/db/schema";
import type { RepositoryProfile } from "@/lib/profiles/profile-records";
import type { Survey } from "@/lib/surveys/records";

/*
 * A Repository's current Profile (unify-surveys, design decision 4): the
 * Profile of the survey its `current_survey_id` names, the newest successful
 * survey of a commit resolved from its configured reference, whether a Run,
 * a background check, or a preview started it. A newer survey that failed
 * leaves the older one current. Every page that shows a Repository's current
 * Profile reads it here.
 */

export interface CurrentProfile {
  profile: RepositoryProfile;
  survey: Survey;
  /** The commit the Profile describes. */
  commit: string;
  /** Its survey's version number. */
  version: number;
}

/** The current Profile of each repository in +sourceIds+, or of every repository, by source id, in one query. */
export function currentProfiles(db: Executor, repositoryIds?: readonly number[]): Map<number, CurrentProfile> {
  if (repositoryIds?.length === 0) return new Map();
  const rows = db
    .select({ repositoryId: repositories.id, profile: repositoryProfiles, survey: surveys })
    .from(repositories)
    .innerJoin(surveys, eq(surveys.id, repositories.currentSurveyId))
    .innerJoin(repositoryProfiles, eq(repositoryProfiles.surveyId, surveys.id))
    .where(repositoryIds ? inArray(repositories.id, [...repositoryIds]) : undefined)
    .all();
  return new Map(rows.map((row) => [row.repositoryId, { profile: row.profile, survey: row.survey, commit: row.survey.commitSha, version: row.survey.number }]));
}

/** The current Profile of the repository +repositoryId+, or undefined when none of its surveys of the configured reference has succeeded. */
export function currentProfile(db: Executor, repositoryId: number): CurrentProfile | undefined {
  return currentProfiles(db, [repositoryId]).get(repositoryId);
}
