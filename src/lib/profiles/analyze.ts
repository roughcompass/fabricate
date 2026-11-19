import { analyze } from "@repo-facts/bundle";
import { SURVEYOR_RELEASE } from "@/lib/surveys/surveyor-release";
import type { JsonObject } from "@repo-facts/contract";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { GitRunner } from "@/lib/git/runner";
import { openSnapshot } from "@/lib/snapshot/open";
import { type Survey, currentRecipe } from "@/lib/surveys/records";
import { buildProfile } from "./schema";

/**
 * Runs the pinned Surveyor bundle on a survey's pinned commit and returns
 * its Profile document. The bundle sees the commit only through a
 * SnapshotReader. The worker must run the recipe the survey records, or the
 * Profile wouldn't be the one its key promises, so analysis refuses to run.
 */

export class AnalysisMismatchError extends Error {
  override name = "AnalysisMismatchError";
}

export interface SurveyCommitInput {
  survey: Survey;
  repository: Pick<Repository, "publicId">;
  config?: FrontendRegistryConfig;
  runner?: GitRunner;
  signal?: AbortSignal;
}

export async function surveyDocument(input: SurveyCommitInput): Promise<JsonObject> {
  const config = input.config ?? getConfig();
  const { survey, repository } = input;
  const recipe = currentRecipe(config);
  if (recipe.surveyorRelease !== survey.surveyorRelease || recipe.configurationDigest !== survey.configurationDigest || recipe.profileSchemaVersion !== survey.profileSchemaVersion) {
    throw new AnalysisMismatchError(`Survey ${survey.publicId} needs Surveyor ${survey.surveyorRelease} with its recorded configuration and Profile version ${survey.profileSchemaVersion}, but this worker runs Surveyor ${recipe.surveyorRelease}`);
  }
  if (!survey.internalRef) throw new AnalysisMismatchError(`Survey ${survey.publicId} has no pinned commit`);
  const reader = await openSnapshot({ repositoryPublicId: repository.publicId }, { internalRef: survey.internalRef, commitSha: survey.commitSha }, { config, ...(input.runner && { runner: input.runner }) });
  const factDocument = await analyze(reader, { ...(input.signal && { signal: input.signal }) });
  return buildProfile({
    repository: repository.publicId,
    commit: survey.commitSha,
    surveyorRelease: SURVEYOR_RELEASE,
    configurationDigest: survey.configurationDigest,
    factDocument,
  });
}
