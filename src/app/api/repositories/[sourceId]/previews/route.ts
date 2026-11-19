import { findSource } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { isEnrolled } from "@/lib/previews/access";
import { previewActivity, settlePreviewWork } from "@/lib/previews/views";

// The state of a Repository's preview work, which its page polls while a preparation or a build is under way
// (docs/previews.md). Not found unless previews are on and the Repository's remote is enrolled.
export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const db = getDb();
  const source = isPublicId(sourceId, "src") ? findSource(db, sourceId) : undefined;
  if (!source || !isEnrolled(getConfig(), source)) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  settlePreviewWork(db);
  const preparation = new URL(request.url).searchParams.get("preparation") ?? undefined;
  return Response.json(previewActivity(db, source, preparation), { headers: { "Cache-Control": "no-store" } });
}
