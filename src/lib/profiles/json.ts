import { dump, sha256 } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { currentProfile } from "@/lib/profiling/current";
import { findRepository } from "@/lib/repositories/repository-records";
import { profileDocument } from "./profile-records";

/*
 * A Repository's current Profile as JSON (establish-frontend-registry, design
 * decision 13; the product-site requirement "A Repository's current Profile
 * is readable as JSON"): the fact document its current Profile embeds, as
 * stored, which is canonical JSON, and its SHA-256 digest, the one the
 * Profile records as `fact_document_digest`. Reading it verifies the stored
 * Profile against its own digest first.
 */

export type ProfileFacts =
  | { readonly status: "found"; readonly json: string; readonly digest: string; readonly profilePublicId: string }
  | { readonly status: "not_found" | "no_profile"; readonly message: string };

/** The current Profile's fact document of the Repository +repositoryPublicId+. */
export function currentProfileFacts(db: Executor, repositoryPublicId: string): ProfileFacts {
  const repository = isPublicId(repositoryPublicId, "src") ? findRepository(db, repositoryPublicId) : undefined;
  if (!repository) return { status: "not_found", message: "No registered Repository has this id." };
  const current = currentProfile(db, repository.id);
  if (!current) return { status: "no_profile", message: `${repository.name} has no Profile yet.` };
  const json = dump(profileDocument(current.profile).fact_document!);
  return { status: "found", json, digest: sha256(json), profilePublicId: current.profile.publicId };
}
