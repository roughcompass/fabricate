import { currentProfileFacts } from "@/lib/profiles/json";
import { getDb } from "@/lib/db/client";

// A Repository's current Profile's fact document, as stored, with its digest (docs: Reference, "The JSON Profile").
export async function GET(_request: Request, { params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  const facts = currentProfileFacts(getDb(), repositoryId);
  if (facts.status !== "found") return Response.json({ error: facts.status, message: facts.message }, { status: 404, headers: { "Cache-Control": "no-store" } });
  // The Profile changes when the Repository's current survey does, so a reader revalidates with the digest.
  return new Response(facts.json, { headers: { "Content-Type": "application/json; charset=utf-8", Digest: facts.digest, ETag: `"${facts.digest}"`, "Cache-Control": "no-cache" } });
}
