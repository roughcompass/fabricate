import { endpointContext, notFound } from "@/lib/prototypes/api";
import { getGeneration, progressVersion } from "@/lib/prototypes/variants";

/** A generation's progress fingerprint, which its variants page polls every 1.5 seconds (design.md, decision 5). */
export async function GET(_request: Request, { params }: { params: Promise<{ generationId: string }> }) {
  const { generationId } = await params;
  const context = await endpointContext(generationId, "gen");
  if (context instanceof Response) return context;
  const view = await getGeneration(context.db, context.workspace.id, generationId).catch(() => null);
  return view ? Response.json({ version: progressVersion(view) }) : notFound();
}
