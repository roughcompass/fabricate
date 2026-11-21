import { getConfig } from "@/lib/config";
import { NO_STORE, mockSetOf } from "@/lib/mocks/api";
import { notFound } from "@/lib/workspaces/api";
import { readBody, setDirectory } from "@/lib/mocks/storage";

/*
 * One stored body of a mock set, by its SHA-256 digest (add-mock-sets, design
 * decision 2, task 4.3): a response body too large to inline in the compiled
 * set, which the routing worker fetches once when a rule first answers with
 * it. The bytes are answered as stored; the worker gives them the rule's own
 * content type. Not found for an unknown digest, and as the compiled set is.
 */

export async function GET(_request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets/[set]/bodies/[digest]">) {
  const { slug, set: setPublicId, digest } = await ctx.params;
  const found = mockSetOf(slug, setPublicId);
  if (found instanceof Response) return found;
  const bytes = readBody(setDirectory(getConfig(), found.set.publicId), digest);
  if (!bytes) return notFound();
  return new Response(new Uint8Array(bytes), { headers: { ...NO_STORE, "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff" } });
}
