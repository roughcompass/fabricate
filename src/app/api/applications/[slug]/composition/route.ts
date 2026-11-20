import { applicationsUnavailable } from "@/lib/applications/availability";
import { buildComposition } from "@/lib/applications/composition";
import { microfrontendsOf } from "@/lib/applications/microfrontends";
import { findApplication } from "@/lib/applications/records";
import { findSavedPreview } from "@/lib/applications/saved-previews";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";

/*
 * What a running application's build is composed of, for the toolbar's
 * Microfrontends tool (restore-toolbar-tools-and-branch-previews, design
 * decision 7): GET, with `preview=<key>` for a saved preview. It answers the
 * Profile's composition facts for the build's commit, and each remote and
 * import-map entry with the builds it can be routed to, each saying whether
 * it has the entry's file. Not found while previews are off, for an unknown
 * application or saved preview, and before a build of it has succeeded.
 */

const NOT_FOUND = () => new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: Request, ctx: RouteContext<"/api/applications/[slug]/composition">): Promise<Response> {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const { slug } = await ctx.params;
  const db = getDb();
  const application = findApplication(db, slug);
  if (!application) return NOT_FOUND();
  const key = new URL(request.url).searchParams.get("preview");
  const saved = key ? findSavedPreview(db, application.publicId, key) : null;
  if (key && !saved) return NOT_FOUND();
  const build = saved ? saved.current : application.current;
  if (!build) return NOT_FOUND();
  const composition = buildComposition(db, build.preview, application.packageDir);
  const microfrontends = await microfrontendsOf(db, getConfig(), composition);
  return Response.json(
    {
      application: { slug: application.slug, name: application.name },
      preview: saved ? { key: saved.key, ref: saved.ref, label: saved.label } : null,
      build: { preview: build.preview, commit: build.commitSha },
      composition,
      microfrontends,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
