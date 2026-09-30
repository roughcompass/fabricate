import { DETECTOR_RELEASE, analyze, detectorConfiguration } from "@repo-facts/bundle";
import type { Stage } from "@repo-facts/contract";
import type { Assessment, AssessmentTarget, SourceSnapshot } from "@/lib/assessments/assessment-records";
import { type FabricateConfig, getConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import type { GitRunner } from "@/lib/git/runner";
import { openSnapshot } from "@/lib/snapshot/open";
import { type RepositoryProfile, insertProfile, profileOfTarget } from "./profile-records";
import { buildProfile, profileProblems } from "./schema";

/**
 * Analyzes one pinned snapshot with the pinned repo-facts bundle and stores
 * its immutable Profile.
 *
 * The bundle sees the snapshot only through a SnapshotReader. The worker must
 * run the detector release and configuration the Assessment recorded when it
 * started; otherwise the Profile could not be reproduced from the Assessment's
 * inputs, and analysis refuses to run. Analysis is idempotent per target: a
 * rerun after an expired lease returns the Profile already stored.
 */

export class AnalysisMismatchError extends Error {
  override name = "AnalysisMismatchError";
}

export interface AnalyzeSnapshotInput {
  assessment: Assessment;
  target: AssessmentTarget;
  snapshot: SourceSnapshot;
  config?: FabricateConfig;
  runner?: GitRunner;
  signal?: AbortSignal;
  /** Called before each detector stage, for cancellation checks. */
  checkpoint?: (stage: Stage) => void;
}

export async function analyzeSnapshot(db: Executor, input: AnalyzeSnapshotInput): Promise<RepositoryProfile> {
  const existing = profileOfTarget(db, input.target.id);
  if (existing) return existing;

  const config = input.config ?? getConfig();
  const { digest } = detectorConfiguration(config.analysis);
  if (input.assessment.detectorRelease !== DETECTOR_RELEASE) {
    throw new AnalysisMismatchError(`Assessment ${input.assessment.publicId} recorded detector release ${input.assessment.detectorRelease}, but this worker runs ${DETECTOR_RELEASE}`);
  }
  if (input.assessment.configurationDigest !== digest) {
    throw new AnalysisMismatchError(`Assessment ${input.assessment.publicId} recorded a different detector configuration than this worker's analysis limits produce`);
  }

  const reader = await openSnapshot(input.target, input.snapshot, { config, ...(input.runner && { runner: input.runner }) });
  const factDocument = await analyze(reader, { ...(input.signal && { signal: input.signal }), ...(input.checkpoint && { checkpoint: input.checkpoint }) });
  const document = buildProfile({
    source: { public_id: input.target.sourcePublicId, name: input.target.sourceName, clone_url: input.target.cloneUrl, git_ref: input.target.gitRef },
    commit: input.snapshot.commitSha,
    detectorRelease: DETECTOR_RELEASE,
    configurationDigest: digest,
    factDocument,
  });
  return insertProfile(db, { assessment: input.assessment, target: input.target, snapshot: input.snapshot, document, validate: profileProblems });
}
