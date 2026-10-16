import { endpointContext, parseBody } from "@/lib/prototypes/api";
import { recordRenderError, renderErrorSchema } from "@/lib/prototypes/evidence";

/** Records a version's render error, which the page relays from the frame. */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const context = await endpointContext(versionId, "ver");
  if (context instanceof Response) return context;
  const body = await parseBody(request, renderErrorSchema);
  if (body instanceof Response) return body;
  const recorded = await recordRenderError(context.db, context.workspace.id, versionId, body.message);
  return Response.json({ recorded });
}
