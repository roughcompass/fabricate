import { endpointContext, notFound } from "@/lib/prototypes/api";
import { refinementsOf } from "@/lib/prototypes/pipeline/refine";
import { getPrototype } from "@/lib/prototypes/prototypes";

/** A prototype's progress fingerprint, which its page polls while a refinement runs. */
export async function GET(_request: Request, { params }: { params: Promise<{ prototypeId: string }> }) {
  const { prototypeId } = await params;
  const context = await endpointContext(prototypeId, "pro");
  if (context instanceof Response) return context;
  const prototype = await getPrototype(context.db, context.workspace.id, prototypeId).catch(() => null);
  if (!prototype) return notFound();
  const last = (await refinementsOf(context.db, prototype.id)).at(-1);
  return Response.json({ version: [prototype.latestNumber, prototype.refiningGenerationId ?? "", last?.variant?.stage ?? "", last?.variant?.status ?? "", last?.version?.fit ? "fit" : ""].join("|") });
}
