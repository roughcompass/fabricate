import crypto from "node:crypto";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import { detectorConfiguration } from "@repo-facts/bundle";
import { SURVEYOR_RELEASE } from "@/lib/surveys/surveyor-release";
import { CURRENT_VERSION } from "@/lib/documents/schemas";
import { JOB_PRIORITIES } from "@/lib/db/schema";
import { getAssessment } from "@/lib/assessments/assessment-records";
import { enqueue } from "@/lib/jobs/queue";
import { type Run, type RunTarget, LAUNCH_TOKEN, createRun, findRunByLaunchToken } from "./run-records";
import { resolveScope } from "./scope-resolver";

/**
 * Starts an Assessment for an Initiative.
 *
 * One immediate transaction reads the Initiative and catalog, resolves the
 * scope, writes the Assessment and every target copy, and enqueues the
 * coordinator job. The job exists only if the scope commits, so no worker can
 * observe a partial scope, and a failed resolution enqueues nothing. Standard
 * selections are deliberately not copied: an Assessment is current state only.
 *
 * The launch token makes submission idempotent: repeating it returns the
 * Assessment it already created instead of starting duplicate work.
 */

export const COORDINATE_RUN = "assessment.coordinate";

export interface LaunchResult {
  run: Run;
  targets: RunTarget[];
  duplicate: boolean;
}

/** The priority of a Run's jobs, and of the surveys it joins: ahead of background surveying. */
export const RUN_PRIORITY = JOB_PRIORITIES.normal;

export function launchRun(db: Executor, assessmentPublicId: string, launchToken: string, config: FrontendRegistryConfig = getConfig()): LaunchResult {
  const token = LAUNCH_TOKEN.test(launchToken) ? launchToken : crypto.randomUUID();
  try {
    return immediate(db, (tx) => {
      const assessment = getAssessment(tx, assessmentPublicId);
      const previous = findRunByLaunchToken(tx, assessment.id, token);
      if (previous) return { run: previous, targets: [], duplicate: true };
      const sources = resolveScope(tx, assessment);
      const { run, targets } = createRun(tx, {
        assessment,
        launchToken: token,
        surveyorRelease: SURVEYOR_RELEASE,
        // The bundle's configuration under this deployment's analysis limits; its digest is the Assessment's.
        configuration: detectorConfiguration(config.analysis).configuration,
        profileSchemaVersion: CURRENT_VERSION.repositoryProfile,
        relationshipSchemaVersion: CURRENT_VERSION.relationshipMap,
        sources,
      });
      enqueue(tx, { kind: COORDINATE_RUN, payload: { assessment: run.publicId }, idempotencyKey: `${COORDINATE_RUN}:${run.publicId}`, priority: RUN_PRIORITY });
      return { run, targets, duplicate: false };
    });
  } catch (error) {
    // A concurrent submission with the same token committed first.
    if (isUniqueViolation(error)) {
      const assessment = getAssessment(db, assessmentPublicId);
      const previous = findRunByLaunchToken(db, assessment.id, token);
      if (previous) return { run: previous, targets: [], duplicate: true };
    }
    throw error;
  }
}
