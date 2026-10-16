import { and, eq } from "drizzle-orm";
import { isPublicId } from "@/lib/db/ids";
import { versions } from "@/lib/prototypes/db/schema";
import { prototypesUnavailable } from "@/lib/prototypes/guard";
import { previewState, renderResponse, requestOrigin } from "@/lib/prototypes/render";
import { existingPrototypesRequest } from "@/lib/prototypes/request";
import { workspaceShell } from "@/lib/prototypes/shell";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * A version's frame (design.md, decision 8): the version renders in the
 * workspace's current shell, authorized by the workspace cookie on the
 * frame's navigation request. The frame's own requests carry no cookies.
 */
export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  const { versionId } = await params;
  if (!isPublicId(versionId, "ver")) return notFound();
  const context = await existingPrototypesRequest();
  if (!context) return notFound();
  const [version] = await context.db
    .select()
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.workspaceId, context.workspace.id)));
  if (!version?.compiled) return notFound();
  const url = new URL(request.url);
  return renderResponse(
    { compiled: version.compiled, scope: version.scope, title: version.title, navItem: version.navItem, personas: version.provenance?.personas ?? [], shell: await workspaceShell(context.db, context.workspace.id) },
    previewState(url.searchParams),
    requestOrigin(request),
  );
}
