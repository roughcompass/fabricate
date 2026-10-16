import crypto from "node:crypto";
import { DETECTOR_RELEASE, detectorConfiguration } from "@repo-facts/bundle";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { CURRENT_VERSION } from "@/lib/documents/schemas";
import { saltPatternsInitiative } from "@/lib/initiatives/initiative-records";
import { enqueue } from "@/lib/jobs/queue";
import type { TemplateFilesRef } from "@/lib/prototypes/template-files";
import { type TemplateTargetInput, createAssessment } from "./assessment-records";

export { evaluateTemplateRun, templateEvaluationToken } from "./template-evaluation";
import { COORDINATE_ASSESSMENT, type LaunchResult } from "./launcher";
import { templateTargetFiles } from "@/lib/prototypes/template-files";

/**
 * Assessing template versions (converge-templates-and-prototypes, design
 * decision 2): a Run under the Salt Patterns initiative whose one target is a
 * template version's exported project, pinned by the Git tree id of its files.
 * When the Run finishes, it's evaluated against the initiative's selected
 * Releases, so acceptance and re-checks read Findings from the same evaluator
 * production repositories get.
 */

/** A template version to assess: before a first acceptance, only its prototype version. */
export type TemplateVersionRef = Omit<TemplateTargetInput, "files">;

export interface TemplateLaunchOptions {
  config?: FabricateConfig;
  /** Loads the version's exported files; the Prototypes database by default. */
  templateFiles?: (ref: TemplateFilesRef) => Promise<Readonly<Record<string, string>>>;
  /** Published Releases, by public id, to evaluate against instead of the initiative's selection: a re-check's acceptance Releases. */
  evaluationReleases?: readonly string[];
}

/** Starts a Run of one template version under Salt Patterns, recording its content digest, and queues the usual jobs. */
export async function launchTemplateAssessment(db: Executor, ref: TemplateVersionRef, options: TemplateLaunchOptions = {}): Promise<LaunchResult> {
  const config = options.config ?? getConfig();
  const files = await (options.templateFiles ?? templateTargetFiles)({ templateVersionPublicId: ref.templateVersionPublicId, prototypeVersionPublicId: ref.prototypeVersionPublicId });
  return immediate(db, (tx) => {
    const { assessment, targets } = createAssessment(tx, {
      initiative: saltPatternsInitiative(tx),
      launchToken: crypto.randomUUID(),
      detectorRelease: DETECTOR_RELEASE,
      configuration: detectorConfiguration(config.analysis).configuration,
      profileSchemaVersion: CURRENT_VERSION.repositoryProfile,
      relationshipSchemaVersion: CURRENT_VERSION.relationshipMap,
      sources: [],
      templates: [{ ...ref, files }],
      ...(options.evaluationReleases && { evaluationReleases: options.evaluationReleases }),
    });
    enqueue(tx, { kind: COORDINATE_ASSESSMENT, payload: { assessment: assessment.publicId }, idempotencyKey: `${COORDINATE_ASSESSMENT}:${assessment.publicId}` });
    return { assessment, targets, duplicate: false };
  });
}
