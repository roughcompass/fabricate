import crypto from "node:crypto";
import { DETECTOR_RELEASE, detectorConfiguration } from "@repo-facts/bundle";
import { type JsonObject, type MemoryFile, digestOf } from "@repo-facts/contract";
import { type Assessment, createAssessment, getAssessment, recordSnapshot } from "@/lib/assessments/assessment-records";
import { requestCancellation, transitionAssessment, transitionTarget } from "@/lib/assessments/transitions";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { type Initiative, getInitiative, selectedSources, updateInitiative } from "@/lib/initiatives/initiative-records";
import { insertProfile } from "@/lib/profiles/profile-records";
import { profileProblems } from "@/lib/profiles/schema";
import { finalizeRelationshipMap } from "@/lib/relationships/finalize";
import { publishDraft } from "@/lib/standards/publish";
import { type StandardRelease, createStandard, saveDraft } from "@/lib/standards/standard-records";
import { memoryProfile, sha1 } from "./profiles";
import { CURRENT_VERSION } from "@/lib/documents/schemas";

/** How one target of a seeded Assessment ends. */
export type Outcome = Readonly<Record<string, MemoryFile>> | "failed" | "canceled";

/**
 * A finished Assessment seeded directly: each target is pinned to a synthetic
 * commit and profiled in memory by the pinned bundle, or ends failed or
 * canceled. The map is finalized and the aggregate outcome recorded, exactly
 * as orchestration would. No Git is involved, so evidence excerpts are not
 * available for these snapshots.
 */
export async function seedAssessment(db: Db, initiative: Initiative, sources: readonly RepositorySource[], outcomes: readonly Outcome[], options: { cancel?: boolean; profileVersion1?: boolean } = {}): Promise<Assessment> {
  const { assessment, targets } = createAssessment(db, {
    initiative,
    launchToken: crypto.randomUUID(),
    detectorRelease: DETECTOR_RELEASE,
    configuration: detectorConfiguration(getConfig().analysis).configuration,
    profileSchemaVersion: options.profileVersion1 ? 1 : CURRENT_VERSION.repositoryProfile,
    relationshipSchemaVersion: 1,
    sources,
  });
  if (options.cancel) requestCancellation(db, assessment.id);
  for (const [index, outcome] of outcomes.entries()) {
    const target = targets.find((item) => item.sourcePublicId === sources[index]!.publicId)!;
    if (outcome === "canceled") {
      transitionTarget(db, target, "canceled");
      continue;
    }
    const acquiring = transitionTarget(db, target, "acquiring");
    if (outcome === "failed") {
      transitionTarget(db, acquiring, "failed", { failureCode: "source_unavailable", failureMessage: "The repository could not be reached" });
      continue;
    }
    const snapshot = recordSnapshot(db, acquiring, { commitSha: sha1(`commit:${target.publicId}`), treeSha: sha1(`tree:${target.publicId}`), refKind: "default_branch", resolvedRef: "refs/heads/main", acquisitionMetadata: {} });
    const analyzing = transitionTarget(db, acquiring, "analyzing");
    const { document } = await memoryProfile(outcome, { public_id: target.sourcePublicId, name: target.sourceName }, snapshot.commitSha);
    if (options.profileVersion1) insertProfile(db, { assessment, target: analyzing, snapshot, document: asProfileVersion1(document) });
    else insertProfile(db, { assessment, target: analyzing, snapshot, document, validate: profileProblems });
    transitionTarget(db, analyzing, "complete");
  }
  const finalizing = transitionAssessment(db, getAssessment(db, assessment.publicId), "finalizing");
  finalizeRelationshipMap(db, finalizing);
  const profiles = outcomes.filter((outcome) => typeof outcome === "object").length;
  const state = options.cancel ? "canceled" : profiles === outcomes.length ? "complete" : profiles > 0 ? "complete_with_issues" : "failed";
  return transitionAssessment(db, finalizing, state, state === "failed" ? { failureReason: "No repository could be assessed" } : {});
}

/** Publishes a Standard with +controls+ and returns its Release. */
export function publishStandard(db: Db, name: string, controls: readonly JsonObject[]): StandardRelease {
  const { standard, draft } = createStandard(db, { name, purpose: `${name} expectations` });
  const saved = saveDraft(db, draft, draft.lockVersion, { schema: "fabricate.standard", schema_version: 1, input_schemas: { repository_profile: [1], relationship_map: [1] }, controls: [...controls] });
  return publishDraft(db, standard.publicId, saved.lockVersion);
}

export function selectReleases(db: Db, initiative: Initiative, releases: readonly StandardRelease[]): Initiative {
  const current = getInitiative(db, initiative.publicId);
  return updateInitiative(db, current.publicId, current.lockVersion, {
    name: current.name,
    objective: current.objective,
    selectionMode: current.selectionMode,
    sourcePublicIds: selectedSources(db, current.id).map((source) => source.publicId),
    standardReleasePublicIds: releases.map((release) => release.publicId),
  });
}

/**
 * A Profile as detector release 0.1.0 stored it: a version 1 envelope around
 * fact document version 1, without the design-system categories. Historical
 * Profiles are kept as written, so nothing validates them against the newer
 * contract.
 */
export function asProfileVersion1(document: JsonObject): JsonObject {
  const factDocument = structuredClone(document.fact_document) as JsonObject & { categories: Record<string, unknown> };
  for (const id of ["design_systems", "ui_elements", "style_values"]) delete factDocument.categories[id];
  factDocument.schema_version = 1;
  return { ...document, schema_version: 1, fact_document: factDocument, fact_document_digest: digestOf(factDocument).digest };
}
