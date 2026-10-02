import crypto from "node:crypto";
import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { type Assessment, LAUNCH_TOKEN, getAssessment, targetsOf } from "@/lib/assessments/assessment-records";
import { type Executor, immediate } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import { DocumentIntegrityError } from "@/lib/documents/digested";
import { readableBy } from "@/lib/documents/schemas";
import { getInitiative, selectedReleases } from "@/lib/initiatives/initiative-records";
import { enqueue } from "@/lib/jobs/queue";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { LIMITS } from "@/lib/standards/document";
import { releaseDocument, releaseLabel } from "@/lib/standards/standard-records";
import { EVALUATOR_VERSION, type EvaluationInputs } from "./controls";
import { type Evaluation, type EvaluationRelease, createEvaluation, findEvaluationByLaunchToken } from "./evaluation-records";

/**
 * Starts an Evaluation of one immutable Assessment against an Initiative's
 * currently selected published Releases.
 *
 * One immediate transaction checks that the Assessment finished with at least
 * one Profile and a Relationship Map, verifies each Release against its
 * published digest and the Assessment's schema versions, records coverage
 * gaps, pins each Release by digest, and enqueues one job per Release. Nothing
 * is reacquired or reanalyzed: Evaluation reads only stored documents. The
 * launch token makes submission idempotent.
 */

export const EVALUATE_RELEASE = "evaluation.release";

export class EvaluationStartError extends Error {
  override name = "EvaluationStartError";
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
  }
}

export interface StartResult {
  evaluation: Evaluation;
  releases: EvaluationRelease[];
  duplicate: boolean;
}

export function startEvaluation(db: Executor, initiativePublicId: string, assessmentPublicId: string, launchToken: string): StartResult {
  const token = LAUNCH_TOKEN.test(launchToken) ? launchToken : crypto.randomUUID();
  try {
    return immediate(db, (tx) => {
      const initiative = getInitiative(tx, initiativePublicId);
      const previous = findEvaluationByLaunchToken(tx, initiative.id, token);
      if (previous) return { evaluation: previous, releases: [], duplicate: true };

      const assessment = getAssessment(tx, assessmentPublicId);
      const problems: string[] = [];
      if (assessment.initiativeId !== initiative.id) problems.push("The Run belongs to a different Assessment.");
      if (assessment.state !== "complete" && assessment.state !== "complete_with_issues") problems.push(`The Run is ${assessment.state.replaceAll("_", " ")}; evaluate a finished Assessment.`);
      if (profilesOf(tx, assessment.id).length === 0) problems.push("The Run has no Repository Profile, so there is no current-state evidence to evaluate.");
      if (!mapOf(tx, assessment.id)) problems.push("The Run has no Relationship Map.");

      const selected = selectedReleases(tx, initiative.id);
      if (selected.length === 0) problems.push("Select at least one published Standard Release for the Assessment.");
      for (const { release, standard } of selected) {
        const label = releaseLabel(standard, release);
        let document: JsonObject;
        try {
          document = releaseDocument(release);
        } catch (error) {
          if (!(error instanceof DocumentIntegrityError)) throw error;
          problems.push(`${label} does not match its published digest.`);
          continue;
        }
        const subjects = new Set((Array.isArray(document.controls) ? document.controls : []).map((control) => (control as JsonObject).subject));
        const profileVersions = JSON.parse(release.profileSchemaVersions) as number[];
        const mapVersions = JSON.parse(release.relationshipSchemaVersions) as number[];
        if (subjects.has("repository") && !readableBy("repositoryProfile", assessment.profileSchemaVersion, profileVersions)) problems.push(`${label} supports Repository Profile v${profileVersions.join(", v") || "none"}, but the Assessment has v${assessment.profileSchemaVersion}.`);
        if (subjects.has("relationship_map") && !readableBy("relationshipMap", assessment.relationshipSchemaVersion, mapVersions)) problems.push(`${label} supports Relationship Map v${mapVersions.join(", v") || "none"}, but the Assessment has v${assessment.relationshipSchemaVersion}.`);
      }
      if (problems.length) throw new EvaluationStartError(problems);

      const { evaluation, releases } = createEvaluation(tx, {
        initiative,
        assessment,
        launchToken: token,
        evaluatorVersion: EVALUATOR_VERSION,
        configuration: { evaluator_version: EVALUATOR_VERSION, limits: { ...LIMITS } },
        profileSchemaVersion: assessment.profileSchemaVersion,
        relationshipSchemaVersion: assessment.relationshipSchemaVersion,
        coverageGaps: coverageGaps(tx, assessment),
        releases: selected.map(({ release }) => release),
      });
      for (const pinned of releases) {
        enqueue(tx, { kind: EVALUATE_RELEASE, payload: { evaluation: evaluation.publicId, position: pinned.position }, idempotencyKey: `${EVALUATE_RELEASE}:${evaluation.publicId}:${pinned.position}` });
      }
      return { evaluation, releases, duplicate: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const initiative = getInitiative(db, initiativePublicId);
      const previous = findEvaluationByLaunchToken(db, initiative.id, token);
      if (previous) return { evaluation: previous, releases: [], duplicate: true };
    }
    throw error;
  }
}

/** Targets without a Profile limit what an Evaluation can conclude. */
function coverageGaps(db: Executor, assessment: Assessment): JsonValue[] {
  return targetsOf(db, assessment.id)
    .filter((target) => target.state !== "complete")
    .map((target) => ({ target: target.publicId, source: { public_id: target.sourcePublicId, name: target.sourceName }, state: target.state, reason: target.failureCode }));
}

/** An Assessment's stored results, verified against their digests: the only inputs an Evaluation reads. */
export function evaluationInputs(db: Executor, assessmentId: number): EvaluationInputs {
  const profiles = new Map(profilesOf(db, assessmentId).map(({ profile, target }) => [target.id, profile]));
  const map = mapOf(db, assessmentId);
  return {
    targets: targetsOf(db, assessmentId).map((target) => {
      const profile = profiles.get(target.id);
      const document = profile ? profileDocument(profile) : null;
      return {
        public_id: target.publicId,
        source: { public_id: target.sourcePublicId, name: target.sourceName },
        state: target.state,
        failure: target.failureCode,
        profile: profile && document ? { public_id: profile.publicId, digest: profile.digest, commit: String(document.commit), factDocument: document.fact_document as JsonObject } : null,
      };
    }),
    map: map ? { public_id: map.publicId, digest: map.digest, document: mapDocument(map) as unknown as MapDocument } : null,
  };
}
