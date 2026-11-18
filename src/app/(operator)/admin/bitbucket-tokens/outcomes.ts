import type { Outcome } from "@/components/ui/outcome-toast";
import { findBitbucketToken } from "@/lib/admin/bitbucket-tokens";
import type { Executor } from "@/lib/db/client";

/** The parameters a token outcome travels in, removed once it shows. */
export const TOKEN_OUTCOME_PARAMS = ["notice", "token", "name"] as const;

/**
 * Messages for the outcome codes the token actions redirect with. An added
 * token's message is built from its record; a deleted one's name comes from
 * the address, so it's shown only as the name it was, never as markup.
 */
export function tokenOutcome(db: Executor, code: string | undefined, publicId: string | undefined, name: string | undefined): Outcome | undefined {
  if (code === "added" && publicId) {
    const token = findBitbucketToken(db, publicId);
    return token && { id: `added:${token.publicId}`, tone: "success", title: `${token.name} was saved.`, description: `For ${token.serverUrl}. It's shown only by its last four characters.` };
  }
  if (code === "deleted" && name) return { id: `deleted:${name}`, tone: "success", title: `${name.slice(0, 100)} was deleted.`, description: "Revoke it in Bitbucket too if it's no longer needed." };
  return undefined;
}
