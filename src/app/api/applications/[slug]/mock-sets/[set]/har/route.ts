import { getDb } from "@/lib/db/client";
import { NO_STORE, mockSetOf } from "@/lib/mocks/api";
import { exportFileName, exportHar } from "@/lib/mocks/export";

/*
 * Export HAR (add-mock-sets, design decision 13, task 4.5): the set's rules
 * with a response, as a HAR 1.2 file to download, named for the application
 * and the set, such as `orders-portal-happy-path.har`. Importing it restores
 * the same rules. Not found as the set's other endpoints are.
 */

export async function GET(_request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets/[set]/har">) {
  const { slug, set: setPublicId } = await ctx.params;
  const found = mockSetOf(slug, setPublicId);
  if (found instanceof Response) return found;
  return new Response(JSON.stringify(exportHar(getDb(), found.set), null, 2), {
    headers: { ...NO_STORE, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${exportFileName(found.application.slug, found.set)}"`, "X-Content-Type-Options": "nosniff" },
  });
}
