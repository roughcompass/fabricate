import { getPrototypesDb } from "@/lib/prototypes/db/client";
import { prototypesUnavailable } from "@/lib/prototypes/guard";
import { previewState, renderResponse, requestOrigin } from "@/lib/prototypes/render";
import { sharedVersion } from "@/lib/prototypes/shares";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * A shared version's frame (design.md, decision 8): authorized by the link's
 * token rather than a workspace, and rendered in the shell as it was when the
 * link was created.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  const shared = await sharedVersion(await getPrototypesDb(), (await params).token);
  const compiled = shared?.version.compiled;
  if (!shared || !compiled) return notFound();
  const { version, share } = shared;
  return renderResponse(
    { compiled, scope: version.scope, title: version.title, navItem: version.navItem, personas: version.provenance?.personas ?? [], shell: share.shell },
    previewState(new URL(request.url).searchParams),
    requestOrigin(request),
  );
}
