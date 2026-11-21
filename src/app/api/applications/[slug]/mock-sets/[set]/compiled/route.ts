import { getDb } from "@/lib/db/client";
import { NO_STORE, mockSetOf } from "@/lib/mocks/api";
import { compileSet } from "@/lib/mocks/compile";

/*
 * A mock set's rules, compiled for the matching engine (add-mock-sets, design
 * decision 2, task 4.3): what the routing worker fetches before it
 * acknowledges an arm, and again whenever the revision it holds isn't the
 * one armed. `?revision=` names the revision the caller asked for; the answer
 * is always the set as it stands, with its own revision, so a stale request
 * gets the current one. Response bodies up to 16 KB are inline; larger ones
 * are named by digest, at `…/bodies/<digest>`. Not found while previews are
 * off, for an unknown application, and for a set of another application.
 * `Cache-Control: no-store`, so a deleted set never lingers in the browser's
 * cache.
 */

export async function GET(_request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets/[set]/compiled">) {
  const { slug, set: setPublicId } = await ctx.params;
  const found = mockSetOf(slug, setPublicId);
  if (found instanceof Response) return found;
  return Response.json(compileSet(getDb(), found.set), { headers: NO_STORE });
}
