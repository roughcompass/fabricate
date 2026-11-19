import { type JsonValue, dump, sha256 } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import { RUN_MACHINE, EVALUATION_MACHINE, EVALUATION_RELEASE_MACHINE, TARGET_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { type Evaluation, evaluationReleasesOf, listEvaluations } from "@/lib/evaluations/evaluation-records";
import { profilesOf } from "@/lib/profiles/profile-records";
import { type Run, targetsOf } from "./run-records";

/** A short digest of +value+ that changes whenever it does, so a page polling for progress knows when to refresh. */
export function statusVersion(value: JsonValue): string {
  return sha256(dump(value)).slice(0, 16);
}

/**
 * Compact progress payloads for pages that poll while work is running. They
 * carry identifiers, states, and stable failure codes only: never clone URLs,
 * failure messages, credentials, or repository content. The version changes
 * whenever any state does, so a page refreshes only when something moved.
 */

export interface RunStatus {
  version: string;
  terminal: boolean;
  run: { id: string; state: string; cancel_requested: boolean };
  targets: { id: string; name: string; state: string; failure: string | null; profile: boolean }[];
  evaluations: { id: string; state: string }[];
}

export function runStatus(db: Executor, run: Run): RunStatus {
  const profiles = new Set(profilesOf(db, run.id).map(({ target }) => target.id));
  const targets = targetsOf(db, run.id).map((target) => ({ id: target.publicId, name: target.repositoryName, state: target.state, failure: target.failureCode, profile: profiles.has(target.id), terminal: isTerminal(TARGET_MACHINE, target.state) }));
  const evaluations = listEvaluations(db, { runId: run.id }).map((evaluation) => ({ id: evaluation.publicId, state: evaluation.state }));
  const body = {
    terminal: isTerminal(RUN_MACHINE, run.state) && evaluations.every((evaluation) => isTerminal(EVALUATION_MACHINE, evaluation.state as Evaluation["state"])),
    run: { id: run.publicId, state: run.state, cancel_requested: run.cancelRequestedAt !== null },
    targets: targets.map(({ terminal: _terminal, ...target }) => target),
    evaluations,
  };
  return { version: statusVersion(body), ...body };
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
  return { version: statusVersion(body), ...body };
}
