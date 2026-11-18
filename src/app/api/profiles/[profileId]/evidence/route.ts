import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { loadProfile, rowEvidence } from "@/lib/profiles/evidence";

// A row's evidence panel, loaded when it's opened: ?table= is a category's id or a shared table's kind, and ?row= the row's id.
export async function GET(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  const row = searchParams.get("row");
  const loaded = table && row && isPublicId(profileId, "prf") ? loadProfile(getDb(), profileId) : undefined;
  const evidence = loaded && rowEvidence(loaded, table!, row!);
  if (!evidence) return Response.json({ error: "not_found" }, { status: 404 });
  // A Profile never changes once stored, so a panel opened again within the hour needn't ask again.
  return Response.json(evidence, { headers: { "Cache-Control": "private, max-age=3600" } });
}
