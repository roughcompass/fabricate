import { dump, sha256 } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import { ASSESSMENT_MACHINE, EVALUATION_MACHINE, EVALUATION_RELEASE_MACHINE, TARGET_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { type Evaluation, evaluationReleasesOf, listEvaluations } from "@/lib/evaluations/evaluation-records";
import { profilesOf } from "@/lib/profiles/profile-records";
import { type Assessment, targetsOf } from "./assessment-records";

/**
 * Compact progress payloads for pages that poll while work is running. They
 * carry identifiers, states, and stable failure codes only: never clone URLs,
 * failure messages, credentials, or repository content. The version changes
 * whenever any state does, so a page refreshes only when something moved.
 */

export interface AssessmentStatus {
  version: string;
  terminal: boolean;
  assessment: { id: string; state: string; cancel_requested: boolean };
  targets: { id: string; name: string; state: string; failure: string | null; profile: boolean }[];
  evaluations: { id: string; state: string }[];
}

export function assessmentStatus(db: Executor, assessment: Assessment): AssessmentStatus {
  const profiles = new Set(profilesOf(db, assessment.id).map(({ target }) => target.id));
  const targets = targetsOf(db, assessment.id).map((target) => ({ id: target.publicId, name: target.sourceName, state: target.state, failure: target.failureCode, profile: profiles.has(target.id), terminal: isTerminal(TARGET_MACHINE, target.state) }));
  const evaluations = listEvaluations(db, { assessmentId: assessment.id }).map((evaluation) => ({ id: evaluation.publicId, state: evaluation.state }));
  const body = {
    terminal: isTerminal(ASSESSMENT_MACHINE, assessment.state) && evaluations.every((evaluation) => isTerminal(EVALUATION_MACHINE, evaluation.state as Evaluation["state"])),
    assessment: { id: assessment.publicId, state: assessment.state, cancel_requested: assessment.cancelRequestedAt !== null },
    targets: targets.map(({ terminal: _terminal, ...target }) => target),
    evaluations,
  };
  return { version: sha256(dump(body)).slice(0, 16), ...body };
}

export interface EvaluationStatus {
  version: string;
  terminal: boolean;
  evaluation: { id: string; state: string };
  releases: { position: number; state: string }[];
}

export function evaluationStatus(db: Executor, evaluation: Evaluation): EvaluationStatus {
  const releases = evaluationReleasesOf(db, evaluation.id).map((release) => ({ position: release.position, state: release.state, terminal: isTerminal(EVALUATION_RELEASE_MACHINE, release.state) }));
  const body = {
    terminal: isTerminal(EVALUATION_MACHINE, evaluation.state),
    evaluation: { id: evaluation.publicId, state: evaluation.state },
    releases: releases.map(({ terminal: _terminal, ...release }) => release),
  };
  return { version: sha256(dump(body)).slice(0, 16), ...body };
}
