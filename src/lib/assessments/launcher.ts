import crypto from "node:crypto";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import { DETECTOR_RELEASE, detectorConfiguration } from "@repo-facts/bundle";
import { CURRENT_VERSION } from "@/lib/documents/schemas";
import { JOB_PRIORITIES } from "@/lib/db/schema";
import { getInitiative } from "@/lib/initiatives/initiative-records";
import { enqueue } from "@/lib/jobs/queue";
import { type Assessment, type AssessmentTarget, LAUNCH_TOKEN, createAssessment, findAssessmentByLaunchToken } from "./assessment-records";
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

export const COORDINATE_ASSESSMENT = "assessment.coordinate";

export interface LaunchResult {
  assessment: Assessment;
  targets: AssessmentTarget[];
  duplicate: boolean;
}

/** The priority of a Run's jobs, and of the surveys it joins: ahead of background surveying. */
export const RUN_PRIORITY = JOB_PRIORITIES.normal;

export function launchAssessment(db: Executor, initiativePublicId: string, launchToken: string, config: FabricateConfig = getConfig()): LaunchResult {
  const token = LAUNCH_TOKEN.test(launchToken) ? launchToken : crypto.randomUUID();
  try {
    return immediate(db, (tx) => {
      const initiative = getInitiative(tx, initiativePublicId);
      const previous = findAssessmentByLaunchToken(tx, initiative.id, token);
      if (previous) return { assessment: previous, targets: [], duplicate: true };
      const sources = resolveScope(tx, initiative);
      const { assessment, targets } = createAssessment(tx, {
        initiative,
        launchToken: token,
        detectorRelease: DETECTOR_RELEASE,
        // The bundle's configuration under this deployment's analysis limits; its digest is the Assessment's.
        configuration: detectorConfiguration(config.analysis).configuration,
        profileSchemaVersion: CURRENT_VERSION.repositoryProfile,
        relationshipSchemaVersion: CURRENT_VERSION.relationshipMap,
        sources,
      });
      enqueue(tx, { kind: COORDINATE_ASSESSMENT, payload: { assessment: assessment.publicId }, idempotencyKey: `${COORDINATE_ASSESSMENT}:${assessment.publicId}`, priority: RUN_PRIORITY });
      return { assessment, targets, duplicate: false };
    });
  } catch (error) {
    // A concurrent submission with the same token committed first.
    if (isUniqueViolation(error)) {
      const initiative = getInitiative(db, initiativePublicId);
      const previous = findAssessmentByLaunchToken(db, initiative.id, token);
      if (previous) return { assessment: previous, targets: [], duplicate: true };
    }
    throw error;
  }
}
