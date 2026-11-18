import crypto from "node:crypto";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import { DETECTOR_RELEASE, detectorConfiguration } from "@repo-facts/bundle";
import { CURRENT_VERSION } from "@/lib/documents/schemas";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { JOB_PRIORITIES } from "@/lib/db/schema";
import { type Initiative, getInitiative, initiativeById } from "@/lib/initiatives/initiative-records";
import { enqueue } from "@/lib/jobs/queue";
import { type Assessment, type AssessmentTarget, LAUNCH_TOKEN, createAssessment, findAssessmentByLaunchToken } from "./assessment-records";
import { ScopeResolutionError, resolveScope } from "./scope-resolver";

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
 *
 * The Repository profiling initiative selects no sources: each launch names
 * its scope, the one repository being profiled, at the reference the catalog
 * sets for it. Its jobs run in the background, behind work people start.
 */

export const COORDINATE_ASSESSMENT = "assessment.coordinate";

export interface LaunchResult {
  assessment: Assessment;
  targets: AssessmentTarget[];
  duplicate: boolean;
}

/** The priority of a Run's jobs: background for the Repository profiling initiative. */
function runPriority(initiative: Pick<Initiative, "profiling">): number {
  return initiative.profiling ? JOB_PRIORITIES.background : JOB_PRIORITIES.normal;
}

/** The priority of the jobs of the Run +assessment+. */
export function priorityOfRun(db: Executor, assessment: { initiativeId: number }): number {
  return runPriority(initiativeById(db, assessment.initiativeId));
}

export function launchAssessment(db: Executor, initiativePublicId: string, launchToken: string, config: FabricateConfig = getConfig(), options: { sources?: readonly RepositorySource[] } = {}): LaunchResult {
  const token = LAUNCH_TOKEN.test(launchToken) ? launchToken : crypto.randomUUID();
  try {
    return immediate(db, (tx) => {
      const initiative = getInitiative(tx, initiativePublicId);
      const previous = findAssessmentByLaunchToken(tx, initiative.id, token);
      if (previous) return { assessment: previous, targets: [], duplicate: true };
      // Its targets are template versions, which DE FabLab adds when one is accepted or re-checked.
      if (initiative.systemOwned) throw new ScopeResolutionError([{ sourcePublicId: null, sourceName: null, message: "Salt Patterns Runs start when a template version is accepted or re-checked." }]);

      if (initiative.profiling !== Boolean(options.sources)) {
        throw new ScopeResolutionError([{ sourcePublicId: null, sourceName: null, message: initiative.profiling ? "Repository profiling Runs start when a repository is profiled." : "Only the Repository profiling initiative takes its scope from the launch." }]);
      }
      // A system-owned initiative assesses its claimed repository's default branch, whatever reference the catalog sets.
      const resolved = options.sources ?? resolveScope(tx, initiative);
      const sources = initiative.claimRepositorySourceId === null ? [...resolved] : resolved.map((source) => ({ ...source, gitRef: null }));
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
      enqueue(tx, { kind: COORDINATE_ASSESSMENT, payload: { assessment: assessment.publicId }, idempotencyKey: `${COORDINATE_ASSESSMENT}:${assessment.publicId}`, priority: runPriority(initiative) });
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
