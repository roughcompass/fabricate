import { type Run, getRun, targetsOf } from "@/lib/runs/run-records";
import { listRepositories } from "@/lib/repositories/repository-records";
import { type Executor, immediate } from "@/lib/db/client";
import { TARGET_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { type RelationshipMap, insertRelationshipMap, mapOf } from "./map-records";
import { type ResolverTarget, resolveRelationships } from "./resolve";
import type { JsonObject } from "@repo-facts/contract";
import { mapProblems } from "./schema";

/**
 * Writes a Run's Relationship Map once every target is terminal.
 *
 * One immediate transaction rereads the Run and its targets, resolves
 * the Profiles of this Run, and stores the immutable map. Registered
 * Repositories outside the scope contribute only their identity metadata;
 * their repositories and any Profiles from other Runs are never read.
 * Finalization is idempotent: a repeated call returns the map already stored.
 */

export class MapNotReadyError extends Error {
  override name = "MapNotReadyError";
}

export function finalizeRelationshipMap(db: Executor, run: Pick<Run, "publicId">): RelationshipMap {
  return immediate(db, (tx) => {
    const current = getRun(tx, run.publicId);
    const existing = mapOf(tx, current.id);
    if (existing) return existing;
    return insertRelationshipMap(tx, { run: current, document: resolveMapDocument(tx, current), validate: mapProblems });
  });
}

/** The map document a finalizing Run's Profiles resolve to, before it's stored. */
export function resolveMapDocument(db: Executor, current: Run): JsonObject {
  if (current.state !== "finalizing") throw new MapNotReadyError(`Assessment ${current.publicId} is ${current.state}; its map is written while finalizing`);

  const targets = targetsOf(db, current.id);
  const pending = targets.filter((target) => !isTerminal(TARGET_MACHINE, target.state));
  if (pending.length) throw new MapNotReadyError(`Assessment ${current.publicId} has ${pending.length} target(s) still in progress`);

  const profiles = new Map(profilesOf(db, current.id).map(({ profile, target }) => [target.id, profile]));
  const inputs: ResolverTarget[] = targets.map((target) => {
    const profile = profiles.get(target.id);
    return {
      public_id: target.publicId,
      source: { public_id: target.repositoryPublicId, name: target.repositoryName },
      state: target.state as ResolverTarget["state"],
      failure: target.failureCode,
      profile: profile ? { digest: profile.digest, document: profileDocument(profile) } : null,
    };
  });
  const scope = new Set(targets.map((target) => target.repositoryId));
  const outOfScope = (targets.length ? listRepositories(db) : [])
    .filter((repository) => !scope.has(repository.id))
    .map((repository) => ({ public_id: repository.publicId, name: repository.name, canonical_url: repository.canonicalUrl }));

  return resolveRelationships({ targets: inputs, outOfScope });
}
