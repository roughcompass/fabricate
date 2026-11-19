import { findRepository } from "@/lib/repositories/repository-records";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { isEnrolled } from "@/lib/previews/access";
import { previewActivity, settlePreviewWork } from "@/lib/previews/views";

// The state of a Repository's preview work, which its page polls while a preparation or a build is under way
// (docs/previews.md). Not found unless previews are on and the Repository's remote is enrolled.
export async function GET(request: Request, { params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  const db = getDb();
  const repository = isPublicId(repositoryId, "src") ? findRepository(db, repositoryId) : undefined;
  if (!repository || !isEnrolled(db, getConfig(), repository)) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  settlePreviewWork(db);
  const preparation = new URL(request.url).searchParams.get("preparation") ?? undefined;
  return Response.json(previewActivity(db, repository, preparation), { headers: { "Cache-Control": "no-store" } });
}
