import { endpointContext, parseBody } from "@/lib/prototypes/api";
import { auditSchema, recordAudit } from "@/lib/prototypes/evidence";

/** Records a version's accessibility audit, which the page relays from the frame. */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const context = await endpointContext(versionId, "ver");
  if (context instanceof Response) return context;
  const body = await parseBody(request, auditSchema);
  if (body instanceof Response) return body;
  const recorded = await recordAudit(context.db, context.workspace.id, versionId, body.violations);
  return Response.json({ recorded });
}
