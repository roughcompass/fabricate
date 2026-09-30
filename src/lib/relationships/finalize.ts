import { type Assessment, getAssessment, targetsOf } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { type Executor, immediate } from "@/lib/db/client";
import { TARGET_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { type RelationshipMap, insertRelationshipMap, mapOf } from "./map-records";
import { type ResolverTarget, resolveRelationships } from "./resolve";
import { mapProblems } from "./schema";

/**
 * Writes an Assessment's Relationship Map once every target is terminal.
 *
 * One immediate transaction rereads the Assessment and its targets, resolves
 * the Profiles of this Assessment, and stores the immutable map. Catalog
 * sources outside the scope contribute only their identity metadata; their
 * repositories and any Profiles from other Assessments are never read.
 * Finalization is idempotent: a repeated call returns the map already stored.
 */

export class MapNotReadyError extends Error {
  override name = "MapNotReadyError";
}

export function finalizeRelationshipMap(db: Executor, assessment: Pick<Assessment, "publicId">): RelationshipMap {
  return immediate(db, (tx) => {
    const current = getAssessment(tx, assessment.publicId);
    const existing = mapOf(tx, current.id);
    if (existing) return existing;
    if (current.state !== "finalizing") throw new MapNotReadyError(`Assessment ${current.publicId} is ${current.state}; its map is written while finalizing`);

    const targets = targetsOf(tx, current.id);
    const pending = targets.filter((target) => !isTerminal(TARGET_MACHINE, target.state));
    if (pending.length) throw new MapNotReadyError(`Assessment ${current.publicId} has ${pending.length} target(s) still in progress`);

    const profiles = new Map(profilesOf(tx, current.id).map(({ profile, target }) => [target.id, profile]));
    const inputs: ResolverTarget[] = targets.map((target) => {
      const profile = profiles.get(target.id);
      return {
        public_id: target.publicId,
        source: { public_id: target.sourcePublicId, name: target.sourceName },
        state: target.state as ResolverTarget["state"],
        failure: target.failureCode,
        profile: profile ? { digest: profile.digest, document: profileDocument(profile) } : null,
      };
    });
    const scope = new Set(targets.map((target) => target.repositorySourceId));
    const outOfScope = listSources(tx)
      .filter((source) => !scope.has(source.id))
      .map((source) => ({ public_id: source.publicId, name: source.name, canonical_url: source.canonicalUrl }));

    return insertRelationshipMap(tx, { assessment: current, document: resolveRelationships({ targets: inputs, outOfScope }), validate: mapProblems });
  });
}
