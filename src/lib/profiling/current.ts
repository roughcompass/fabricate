import { eq, inArray } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { repositoryProfiles, repositorySources, surveys } from "@/lib/db/schema";
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
export function currentProfiles(db: Executor, sourceIds?: readonly number[]): Map<number, CurrentProfile> {
  if (sourceIds?.length === 0) return new Map();
  const rows = db
    .select({ sourceId: repositorySources.id, profile: repositoryProfiles, survey: surveys })
    .from(repositorySources)
    .innerJoin(surveys, eq(surveys.id, repositorySources.currentSurveyId))
    .innerJoin(repositoryProfiles, eq(repositoryProfiles.surveyId, surveys.id))
    .where(sourceIds ? inArray(repositorySources.id, [...sourceIds]) : undefined)
    .all();
  return new Map(rows.map((row) => [row.sourceId, { profile: row.profile, survey: row.survey, commit: row.survey.commitSha, version: row.survey.number }]));
}

/** The current Profile of the repository +sourceId+, or undefined when none of its surveys of the configured reference has succeeded. */
export function currentProfile(db: Executor, sourceId: number): CurrentProfile | undefined {
  return currentProfiles(db, [sourceId]).get(sourceId);
}
